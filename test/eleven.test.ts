import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env";
import {
  UpstreamError,
  addVoice,
  deleteVoice,
  getConversation,
  getConversationToken,
  listModels,
  textToSpeech,
} from "../src/worker/eleven";

// Fake, test-only values. Not real keys.
const KEY = "test-eleven-key-not-real";
const env = {
  ELEVEN_API_BASE: "https://eleven.test/",
  NEBIUS_API_BASE: "https://nebius.test/v1",
  COACH_MODEL: "coach-model",
  REWRITE_MODEL: "rewrite-model",
  TTS_MODEL: "tts-model",
  AGENT_ID: "agent_123",
  ELEVENLABS_API_KEY: KEY,
  NEBIUS_API_KEY: "test-nebius-key-not-real",
  LLM_PROXY_SECRET: "x",
  SESSION_SECRET: "x",
  ADMIN_SECRET: "x",
} as unknown as Env;

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function header(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

async function rejection(p: Promise<unknown>): Promise<UpstreamError> {
  try {
    await p;
  } catch (e) {
    return e as UpstreamError;
  }
  throw new Error("expected a rejection");
}

describe("addVoice", () => {
  it("POSTs multipart name + files with the key header, without remove_background_noise", async () => {
    const f = fakeFetch(() => json({ voice_id: "v1", requires_verification: false }));
    const sample = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const r = await addVoice(env, { name: "sage-guest-abcd1234", sample, filename: "sample.webm" }, f.impl);
    expect(r).toEqual({ voice_id: "v1", requires_verification: false });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://eleven.test/v1/voices/add");
    expect(call.init.method).toBe("POST");
    expect(header(call, "xi-api-key")).toBe(KEY);
    const form = call.init.body as FormData;
    expect(form.get("name")).toBe("sage-guest-abcd1234");
    const file = form.get("files") as File;
    expect(file.name).toBe("sample.webm");
    expect(file.size).toBe(3);
    expect(form.has("remove_background_noise")).toBe(false);
    expect([...form.keys()].sort()).toEqual(["files", "name"]);
  });

  it("reports requires_verification true", async () => {
    const f = fakeFetch(() => json({ voice_id: "v2", requires_verification: true }));
    const r = await addVoice(env, { name: "n", sample: new Blob(["a"]), filename: "a.webm" }, f.impl);
    expect(r.requires_verification).toBe(true);
  });

  it("throws UpstreamError with status and a key-scrubbed excerpt on non-2xx", async () => {
    const f = fakeFetch(() => new Response(`bad audio, key ${KEY} rejected`, { status: 400 }));
    const e = await rejection(addVoice(env, { name: "n", sample: new Blob(["a"]), filename: "a.webm" }, f.impl));
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.status).toBe(400);
    expect(e.service).toBe("elevenlabs");
    expect(e.excerpt).toContain("bad audio");
    expect(e.excerpt).not.toContain(KEY);
    expect(e.message).not.toContain(KEY);
  });

  it("caps the excerpt length", async () => {
    const f = fakeFetch(() => new Response("x".repeat(5000), { status: 500 }));
    const e = await rejection(addVoice(env, { name: "n", sample: new Blob(["a"]), filename: "a.webm" }, f.impl));
    expect(e.excerpt.length).toBeLessThanOrEqual(200);
  });

  it("throws when a 2xx carries no voice_id", async () => {
    const f = fakeFetch(() => json({}));
    const e = await rejection(addVoice(env, { name: "n", sample: new Blob(["a"]), filename: "a.webm" }, f.impl));
    expect(e).toBeInstanceOf(UpstreamError);
  });
});

describe("deleteVoice", () => {
  it("DELETEs the voice by id", async () => {
    const f = fakeFetch(() => json({ status: "ok" }));
    await deleteVoice(env, "v 1", f.impl);
    expect(f.calls[0]!.url).toBe("https://eleven.test/v1/voices/v%201");
    expect(f.calls[0]!.init.method).toBe("DELETE");
    expect(header(f.calls[0]!, "xi-api-key")).toBe(KEY);
  });

  it("treats 404 as already deleted", async () => {
    const f = fakeFetch(() => new Response("not found", { status: 404 }));
    await expect(deleteVoice(env, "v1", f.impl)).resolves.toBeUndefined();
  });

  it("throws on other errors", async () => {
    const f = fakeFetch(() => new Response("oops", { status: 500 }));
    const e = await rejection(deleteVoice(env, "v1", f.impl));
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.status).toBe(500);
  });
});

describe("getConversationToken", () => {
  it("GETs a token for AGENT_ID", async () => {
    const f = fakeFetch(() => json({ token: "tok", conversation_id: "c1" }));
    expect(await getConversationToken(env, f.impl)).toEqual({ token: "tok" });
    expect(f.calls[0]!.url).toBe("https://eleven.test/v1/convai/conversation/token?agent_id=agent_123");
    expect(f.calls[0]!.init.method).toBe("GET");
    expect(header(f.calls[0]!, "xi-api-key")).toBe(KEY);
  });

  it("throws on non-2xx and on a missing token", async () => {
    expect(await rejection(getConversationToken(env, fakeFetch(() => new Response("", { status: 401 })).impl))).toBeInstanceOf(
      UpstreamError,
    );
    expect(await rejection(getConversationToken(env, fakeFetch(() => json({})).impl))).toBeInstanceOf(UpstreamError);
  });
});

describe("getConversation", () => {
  it("GETs status and transcript", async () => {
    const transcript = [{ role: "user", message: "hi", time_in_call_secs: 1 }];
    const f = fakeFetch(() => json({ status: "done", transcript, agent_id: "agent_123" }));
    expect(await getConversation(env, "conv_1", f.impl)).toEqual({ status: "done", transcript });
    expect(f.calls[0]!.url).toBe("https://eleven.test/v1/convai/conversations/conv_1");
    expect(f.calls[0]!.init.method).toBe("GET");
    expect(header(f.calls[0]!, "xi-api-key")).toBe(KEY);
  });

  it("returns an empty transcript when it is missing or null", async () => {
    const f = fakeFetch(() => json({ status: "processing", transcript: null }));
    expect(await getConversation(env, "c", f.impl)).toEqual({ status: "processing", transcript: [] });
  });

  it("throws on non-2xx", async () => {
    const e = await rejection(getConversation(env, "c", fakeFetch(() => new Response("", { status: 404 })).impl));
    expect(e.status).toBe(404);
  });
});

describe("textToSpeech", () => {
  it("POSTs text with TTS_MODEL and returns the upstream Response untouched for streaming", async () => {
    const upstream = new Response(new Uint8Array([9, 9]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    const f = fakeFetch(() => upstream);
    const res = await textToSpeech(env, "voice_9", "Hello there.", f.impl);
    expect(res).toBe(upstream);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://eleven.test/v1/text-to-speech/voice_9?output_format=mp3_44100_128");
    expect(call.init.method).toBe("POST");
    expect(header(call, "xi-api-key")).toBe(KEY);
    expect(header(call, "content-type")).toBe("application/json");
    expect(JSON.parse(call.init.body as string)).toEqual({ text: "Hello there.", model_id: "tts-model" });
  });

  it("throws on non-2xx", async () => {
    const e = await rejection(textToSpeech(env, "v", "t", fakeFetch(() => new Response("quota", { status: 429 })).impl));
    expect(e.status).toBe(429);
  });
});

describe("listModels", () => {
  it("GETs /v1/models as an array", async () => {
    const models = [{ model_id: "eleven_v4", can_do_text_to_speech: true }];
    const f = fakeFetch(() => json(models));
    expect(await listModels(env, f.impl)).toEqual(models);
    expect(f.calls[0]!.url).toBe("https://eleven.test/v1/models");
    expect(header(f.calls[0]!, "xi-api-key")).toBe(KEY);
  });

  it("returns [] for a non-array body and throws on non-2xx", async () => {
    expect(await listModels(env, fakeFetch(() => json({ nope: true })).impl)).toEqual([]);
    expect(await rejection(listModels(env, fakeFetch(() => new Response("", { status: 500 })).impl))).toBeInstanceOf(UpstreamError);
  });
});
