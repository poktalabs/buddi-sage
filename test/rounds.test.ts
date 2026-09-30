import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, StartRoundResponse } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { createCodes, getCode, setVoice, type RoundRow } from "../src/worker/db";
import { startRound } from "../src/worker/routes/rounds";
import { testEnv } from "./support/fakeD1";

let env: Env;
let code: string;
beforeEach(async () => {
  env = testEnv();
  [code] = (await createCodes(env.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
  await setVoice(env.DB, code, "voice-test", new Date());
});

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

const tokenOk = () => fakeFetch(() => Response.json({ token: "conv-token-test" }));

function post(body: unknown): Request {
  return new Request("https://sage.test/api/rounds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as ApiError).error;
}

async function used(): Promise<number> {
  return (await getCode(env.DB, code))!.used;
}

async function rounds(): Promise<RoundRow[]> {
  return (await env.DB.prepare("SELECT * FROM rounds WHERE code = ?").bind(code).all<RoundRow>()).results;
}

describe("startRound", () => {
  it("starts a Round: spends one, inserts it, mints the token and returns the contract shape", async () => {
    const f = tokenOk();
    const res = await startRound(post({ question_id: "why-this-role" }), env, { code }, undefined, f.impl);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StartRoundResponse;
    expect(body).toEqual({
      round_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      conversation_token: "conv-token-test",
      question: { id: "why-this-role", text: "Why this role, and why now?" },
      allowance_left: 2,
    });
    expect(await used()).toBe(1);
    const [round] = await rounds();
    expect(round).toMatchObject({ id: body.round_id, question_id: "why-this-role", status: "started" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://eleven.test/v1/convai/conversation/token?agent_id=agent-test");
  });

  it("the third Round of a 3-Round code succeeds and the fourth fails 403 allowance_used, used stays 3", async () => {
    const f = tokenOk();
    for (const left of [2, 1, 0]) {
      const res = await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, f.impl);
      expect(res.status).toBe(200);
      expect(((await res.json()) as StartRoundResponse).allowance_left).toBe(left);
    }
    const res = await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, f.impl);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("allowance_used");
    expect(await used()).toBe(3);
    expect(await rounds()).toHaveLength(3);
    expect(f.calls).toHaveLength(3);
  });

  it("a mint failure refunds the Round, fails it and answers 502 upstream_error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(() => new Response("nope", { status: 500 }));
    const res = await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, f.impl);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe("upstream_error");
    expect(await used()).toBe(0);
    const [round] = await rounds();
    expect(round!.status).toBe("failed");
    // The log line carries the status only, never the code or a key.
    expect(JSON.stringify(spy.mock.calls)).not.toContain(code);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(env.ELEVENLABS_API_KEY);
    spy.mockRestore();
  });

  it("a network rejection while minting also refunds and fails the Round", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(() => Promise.reject(new TypeError("network down")));
    const res = await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, f.impl);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe("upstream_error");
    expect(await used()).toBe(0);
    expect((await rounds())[0]!.status).toBe("failed");
    spy.mockRestore();
  });

  it("the last Round of the Allowance is refunded on a mint failure and can be started again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = tokenOk();
    for (let i = 0; i < 2; i++) await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, ok.impl);
    const bad = fakeFetch(() => new Response("", { status: 503 }));
    expect((await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, bad.impl)).status).toBe(502);
    expect(await used()).toBe(2);
    const res = await startRound(post({ question_id: "shipped-system" }), env, { code }, undefined, ok.impl);
    expect(res.status).toBe(200);
    expect(((await res.json()) as StartRoundResponse).allowance_left).toBe(0);
    spy.mockRestore();
  });

  it("409 voice_required without a Voice clone, before spending or minting", async () => {
    const [bare] = (await createCodes(env.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
    const f = tokenOk();
    const res = await startRound(post({ question_id: "shipped-system" }), env, { code: bare }, undefined, f.impl);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("voice_required");
    expect((await getCode(env.DB, bare))!.used).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds").first<number>("n"))).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("400 unknown_question for an unknown, missing or non-string question_id, with no spend", async () => {
    const f = tokenOk();
    for (const body of [{ question_id: "nope" }, {}, { question_id: 7 }]) {
      const res = await startRound(post(body), env, { code }, undefined, f.impl);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("unknown_question");
    }
    expect(await used()).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("400 bad_request on malformed JSON or a non-object body, with no spend", async () => {
    const f = tokenOk();
    for (const body of ["{not json", "[1]", "null", '"why-this-role"']) {
      const res = await startRound(post(body), env, { code }, undefined, f.impl);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("bad_request");
    }
    expect(await used()).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("401 unauthorized when the Session's code no longer exists", async () => {
    const f = tokenOk();
    const res = await startRound(post({ question_id: "shipped-system" }), env, { code: "SAGE-GONE-GONE" }, undefined, f.impl);
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("unauthorized");
    expect(f.calls).toHaveLength(0);
  });
});
