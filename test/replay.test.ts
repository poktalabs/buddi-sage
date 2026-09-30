import { beforeEach, describe, expect, it } from "vitest";
import type { ApiError, ReplayResponse } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { createCodes, failRound, finishRound, getRound, insertRound, setConversationId, setVoice } from "../src/worker/db";
import type { TranscriptItem } from "../src/worker/transcript";
import { MAX_POLLS, POLL_INTERVAL_MS, audio, replay } from "../src/worker/routes/replay";
import { testEnv } from "./support/fakeD1";

// Synthetic Guest words, written for this test. No real person's Answer.
const FIRST = "We built a support bot for internal tickets.";
const PUSHBACK = "What was your part in it, specifically?";
const FINAL = "Um so we built the support bot and I wrote the the retrieval part in about three weeks.";
const GOOD = "We built the support bot, and I wrote the retrieval part in about three weeks.";
const BAD = "We built the support bot for 200 engineers, and I wrote the retrieval part in about three weeks.";

const TRANSCRIPT: TranscriptItem[] = [
  { role: "agent", message: "Walk me through an AI system you shipped to real users." },
  { role: "user", message: FIRST },
  { role: "agent", message: PUSHBACK },
  { role: "user", message: FINAL },
  { role: "agent", message: null, tool_calls: [{ tool_name: "save_answer" }] },
  { role: "agent", message: "Saved. Here is your Replay." },
];

type Call = { url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response>;

let env: Env;
let code: string;
let other: string;
let roundId: string;

beforeEach(async () => {
  env = testEnv();
  [code, other] = (await createCodes(env.DB, { kind: "guest", count: 2, allowance: 3 })) as [string, string];
  await setVoice(env.DB, code, "voice-abc", new Date());
  roundId = "round-1";
  await insertRound(env.DB, { id: roundId, code, question_id: "shipped-system" });
});

function fakeFetch(opts: { conversation?: Handler; nebius?: Handler; tts?: Handler }) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    if (call.url.startsWith("https://eleven.test/v1/convai/conversations/") && opts.conversation) return opts.conversation(call);
    if (call.url === "https://nebius.test/v1/chat/completions" && opts.nebius) return opts.nebius(call);
    if (call.url.startsWith("https://eleven.test/v1/text-to-speech/") && opts.tts) return opts.tts(call);
    throw new Error(`unexpected fetch ${call.url}`);
  }) as typeof fetch;
  return { impl, calls };
}

const done = (transcript: TranscriptItem[] = TRANSCRIPT) => () => Response.json({ status: "done", transcript });
const completion = (content: string) => Response.json({ choices: [{ message: { content } }] });
function nebiusReplies(...contents: string[]) {
  let i = 0;
  return () => completion(contents[i++] ?? "");
}

function makeSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => void waits.push(ms), waits };
}

function replayReq(body: unknown = { conversation_id: "conv-1" }): Request {
  return new Request(`https://sage.test/api/rounds/${roundId}/replay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as ApiError).error;
}

async function runReplay(f: { impl: typeof fetch }, opts: { body?: unknown; as?: string; id?: string } = {}) {
  const { sleep, waits } = makeSleep();
  const res = await replay(replayReq(opts.body), env, { code: opts.as ?? code }, { id: opts.id ?? roundId }, { fetchImpl: f.impl, sleep });
  return { res, waits };
}

describe("replay", () => {
  it("builds the Replay from the transcript and records it once", async () => {
    const f = fakeFetch({ conversation: done(), nebius: nebiusReplies(GOOD) });
    const { res } = await runReplay(f);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReplayResponse;
    expect(body).toEqual({
      status: "replayed",
      final_answer: FINAL,
      best_self_text: GOOD,
      audio_url: `/api/rounds/${roundId}/audio`,
    });
    const row = (await getRound(env.DB, roundId, code))!;
    expect(row).toMatchObject({
      status: "replayed",
      conversation_id: "conv-1",
      final_answer: FINAL,
      best_self_text: GOOD,
      rewrite_attempts: 1,
      guard_failures: "[]",
    });
    // The rewrite asked the rewrite model with a generous budget and the Question's text.
    const nebius = f.calls.filter((c) => c.url.includes("nebius"));
    expect(nebius).toHaveLength(1);
    const sent = JSON.parse(String(nebius[0]!.init.body)) as { model: string; max_tokens: number; messages: { content: string }[] };
    expect(sent.model).toBe("rewrite-model");
    expect(sent.max_tokens).toBeGreaterThanOrEqual(4000);
    expect(sent.messages[0]!.content).toContain("What was your part in it?");
    expect(sent.messages[0]!.content).toContain(FINAL);
  });

  it("falls back to the Guest's own words when both rewrites fail the guard, recording every failure", async () => {
    const f = fakeFetch({ conversation: done(), nebius: nebiusReplies(BAD, BAD) });
    const { res } = await runReplay(f);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReplayResponse;
    expect(body.status).toBe("fallback");
    expect(body.best_self_text).toBe("So we built the support bot and I wrote the retrieval part in about three weeks.");
    expect(body.best_self_text).not.toContain("200");
    const row = (await getRound(env.DB, roundId, code))!;
    expect(row.status).toBe("fallback");
    expect(row.rewrite_attempts).toBe(2);
    expect(JSON.parse(row.guard_failures!)).toHaveLength(2);
  });

  it("falls back when Nebius errors on both attempts, never passing model text through", async () => {
    const f = fakeFetch({ conversation: done(), nebius: () => new Response("nope", { status: 500 }) });
    const { res } = await runReplay(f);
    const body = (await res.json()) as ReplayResponse;
    expect(body.status).toBe("fallback");
    expect((await getRound(env.DB, roundId, code))!.status).toBe("fallback");
  });

  it("polls every 1.5 s until the Conversation is done", async () => {
    let n = 0;
    const f = fakeFetch({
      conversation: () => (++n < 3 ? Response.json({ status: n === 1 ? "in-progress" : "processing" }) : Response.json({ status: "done", transcript: TRANSCRIPT })),
      nebius: nebiusReplies(GOOD),
    });
    const { res, waits } = await runReplay(f);
    expect(res.status).toBe(200);
    expect(n).toBe(3);
    expect(waits).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    expect(POLL_INTERVAL_MS).toBe(1500);
  });

  it("504 conversation_timeout after at most 20 polls, leaving the Round started for one retry", async () => {
    const f = fakeFetch({ conversation: () => Response.json({ status: "processing" }) });
    const { res, waits } = await runReplay(f);
    expect(res.status).toBe(504);
    expect(await errorOf(res)).toBe("conversation_timeout");
    expect(MAX_POLLS).toBe(20);
    expect(f.calls).toHaveLength(20);
    expect(waits).toHaveLength(19);
    expect((await getRound(env.DB, roundId, code))!.status).toBe("started");

    // The retry names the same Conversation and succeeds.
    const retry = fakeFetch({ conversation: done(), nebius: nebiusReplies(GOOD) });
    const again = await runReplay(retry);
    expect(again.res.status).toBe(200);
  });

  it("502 conversation_failed and the Round failed when the Conversation failed", async () => {
    const f = fakeFetch({ conversation: () => Response.json({ status: "failed" }) });
    const { res } = await runReplay(f);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe("conversation_failed");
    expect((await getRound(env.DB, roundId, code))!.status).toBe("failed");
  });

  it("502 upstream_error when reading the Conversation fails, Round left started", async () => {
    for (const conversation of [() => new Response("down", { status: 503 }), () => Promise.reject(new TypeError("network"))]) {
      const f = fakeFetch({ conversation });
      const { res } = await runReplay(f);
      expect(res.status).toBe(502);
      expect(await errorOf(res)).toBe("upstream_error");
      expect((await getRound(env.DB, roundId, code))!.status).toBe("started");
    }
  });

  it("422 no_save_answer when Sage never saved, and the Round fails", async () => {
    const f = fakeFetch({ conversation: done(TRANSCRIPT.filter((t) => !t.tool_calls)) });
    const { res } = await runReplay(f);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("no_save_answer");
    expect((await getRound(env.DB, roundId, code))!.status).toBe("failed");
    expect(f.calls.some((c) => c.url.includes("nebius"))).toBe(false);
  });

  it("422 empty_answer when the Guest said nothing before the save, and the Round fails", async () => {
    const f = fakeFetch({
      conversation: done([
        { role: "agent", message: PUSHBACK },
        { role: "user", message: "  " },
        { role: "agent", message: null, tool_calls: [{ tool_name: "save_answer" }] },
      ]),
    });
    const { res } = await runReplay(f);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("empty_answer");
    expect((await getRound(env.DB, roundId, code))!.status).toBe("failed");
  });

  it("404 round_not_found for an unknown id and for another Guest's Round, with no upstream call", async () => {
    const f = fakeFetch({});
    for (const opts of [{ id: "no-such-round" }, { as: other }]) {
      const { res } = await runReplay(f, opts);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toBe("round_not_found");
    }
    expect(f.calls).toHaveLength(0);
    expect((await getRound(env.DB, roundId, code))!.conversation_id).toBeNull();
  });

  it("400 bad_request when conversation_id is missing, blank or not a string", async () => {
    const f = fakeFetch({});
    for (const body of [{}, { conversation_id: "  " }, { conversation_id: 7 }, "{not json"]) {
      const { res } = await runReplay(f, { body });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("bad_request");
    }
    expect(f.calls).toHaveLength(0);
  });

  it("400 bad_request when a retry names a different Conversation", async () => {
    await setConversationId(env.DB, roundId, "conv-1");
    const f = fakeFetch({});
    const { res } = await runReplay(f, { body: { conversation_id: "conv-2" } });
    expect(res.status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  it("409 round_already_replayed for a finished or failed Round, without polling or rewriting", async () => {
    const f = fakeFetch({ conversation: done(), nebius: nebiusReplies(GOOD) });
    expect((await runReplay(f)).res.status).toBe(200);
    const before = f.calls.length;
    const { res } = await runReplay(f);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("round_already_replayed");
    expect(f.calls.length).toBe(before);

    await insertRound(env.DB, { id: "round-2", code, question_id: "why-this-role" });
    await failRound(env.DB, "round-2");
    const failed = await runReplay(f, { id: "round-2" });
    expect(failed.res.status).toBe(409);
  });

  it("409 round_already_replayed when another request finished the Round during the rewrite", async () => {
    const f = fakeFetch({
      conversation: done(),
      nebius: async () => {
        // A second tab wins the race while this request waits on the model.
        await finishRound(env.DB, roundId, {
          status: "replayed",
          final_answer: FINAL,
          best_self_text: "the other tab's Replay",
          rewrite_attempts: 1,
          guard_failures: [],
        });
        return completion(GOOD);
      },
    });
    const { res } = await runReplay(f);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("round_already_replayed");
    expect((await getRound(env.DB, roundId, code))!.best_self_text).toBe("the other tab's Replay");
  });
});

describe("audio", () => {
  async function finish() {
    await finishRound(env.DB, roundId, {
      status: "replayed",
      final_answer: FINAL,
      best_self_text: GOOD,
      rewrite_attempts: 1,
      guard_failures: [],
    });
  }

  function audioCall(f: { impl: typeof fetch }, opts: { as?: string; id?: string } = {}) {
    return audio(new Request(`https://sage.test/api/rounds/${roundId}/audio`), env, { code: opts.as ?? code }, { id: opts.id ?? roundId }, { fetchImpl: f.impl });
  }

  it("streams the TTS body of the Best-self answer in the Guest's Voice clone as audio/mpeg", async () => {
    await finish();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([0x49, 0x44, 0x33]));
        c.close();
      },
    });
    const f = fakeFetch({ tts: () => new Response(stream, { headers: { "content-type": "audio/mpeg" } }) });
    const res = await audioCall(f);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.body).toBe(stream);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toContain("/v1/text-to-speech/voice-abc");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toMatchObject({ text: GOOD });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
  });

  it("also serves a fallback Replay", async () => {
    await finishRound(env.DB, roundId, { status: "fallback", final_answer: FINAL, best_self_text: "Our words.", rewrite_attempts: 2, guard_failures: [] });
    const f = fakeFetch({ tts: () => new Response("mp3") });
    const res = await audioCall(f);
    expect(res.status).toBe(200);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toMatchObject({ text: "Our words." });
  });

  it("404 round_not_found for an unknown id and for another Guest's Round", async () => {
    await finish();
    await setVoice(env.DB, other, "voice-other", new Date());
    const f = fakeFetch({});
    for (const opts of [{ id: "no-such-round" }, { as: other }]) {
      const res = await audioCall(f, opts);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toBe("round_not_found");
    }
    expect(f.calls).toHaveLength(0);
  });

  it("409 bad_request while the Round has no Replay (started or failed)", async () => {
    const f = fakeFetch({});
    const started = await audioCall(f);
    expect(started.status).toBe(409);
    expect(await errorOf(started)).toBe("bad_request");
    await failRound(env.DB, roundId);
    expect((await audioCall(f)).status).toBe(409);
    expect(f.calls).toHaveLength(0);
  });

  it("409 voice_required when the code has no Voice clone", async () => {
    await finish();
    await env.DB.prepare("UPDATE codes SET voice_id = NULL WHERE code = ?").bind(code).run();
    const f = fakeFetch({});
    const res = await audioCall(f);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("voice_required");
    expect(f.calls).toHaveLength(0);
  });

  it("502 upstream_error when TTS fails or the network rejects", async () => {
    await finish();
    for (const tts of [() => new Response("quota", { status: 401 }), () => Promise.reject(new TypeError("network"))]) {
      const res = await audioCall(fakeFetch({ tts }));
      expect(res.status).toBe(502);
      expect(await errorOf(res)).toBe("upstream_error");
    }
  });
});
