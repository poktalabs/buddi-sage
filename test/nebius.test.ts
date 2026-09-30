import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env";
import { UpstreamError } from "../src/worker/eleven";
import { chatText, forwardChatCompletions, stripThinking } from "../src/worker/nebius";

// Fake, test-only values. Not real keys.
const KEY = "test-nebius-key-not-real";
const env = {
  ELEVEN_API_BASE: "https://eleven.test",
  NEBIUS_API_BASE: "https://nebius.test/v1/",
  COACH_MODEL: "deepseek-ai/DeepSeek-V4-Pro-0813",
  REWRITE_MODEL: "MiniMaxAI/MiniMax-M3",
  TTS_MODEL: "tts",
  AGENT_ID: "a",
  ELEVENLABS_API_KEY: "test-eleven-key-not-real",
  NEBIUS_API_KEY: KEY,
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

const completion = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

const messages = [{ role: "user" as const, content: "Rewrite this." }];

describe("stripThinking", () => {
  it("removes a closed think block", () => {
    expect(stripThinking("<think>plan it</think>\n\nI added a reranker.")).toBe("I added a reranker.");
  });
  it("removes several blocks, case-insensitively, across lines", () => {
    expect(stripThinking("<THINK>a\nb</THINK>One. <think>c</think>Two.")).toBe("One. Two.");
  });
  it("drops everything after an unclosed think", () => {
    expect(stripThinking("Answer.<think>cut off by max_tokens")).toBe("Answer.");
    expect(stripThinking("<think>only reasoning, never finished")).toBe("");
  });
  it("drops everything before a stray closing tag", () => {
    expect(stripThinking("reasoning without opener</think>The answer.")).toBe("The answer.");
  });
  it("leaves plain text alone", () => {
    expect(stripThinking("  We built an eval set.  ")).toBe("We built an eval set.");
  });
});

describe("chatText", () => {
  it("POSTs a non-streaming completion with the bearer and returns the content", async () => {
    const f = fakeFetch(() => completion("<think>hmm</think>We built an eval set."));
    const text = await chatText(env, { model: env.REWRITE_MODEL, messages, temperature: 0.4, max_tokens: 4000 }, f.impl);
    expect(text).toBe("We built an eval set.");
    const call = f.calls[0]!;
    expect(call.url).toBe("https://nebius.test/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(call.init.body as string)).toEqual({
      model: "MiniMaxAI/MiniMax-M3",
      messages,
      stream: false,
      temperature: 0.4,
      max_tokens: 4000,
    });
  });

  it("omits temperature and max_tokens when not given", async () => {
    const f = fakeFetch(() => completion("ok"));
    await chatText(env, { model: "m", messages }, f.impl);
    const body = JSON.parse(f.calls[0]!.init.body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("throws UpstreamError on non-2xx, with the key scrubbed", async () => {
    const f = fakeFetch(() => new Response(`invalid key ${KEY}`, { status: 401 }));
    const e = (await rejection(chatText(env, { model: "m", messages }, f.impl))) as UpstreamError;
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.service).toBe("nebius");
    expect(e.status).toBe(401);
    expect(e.excerpt).not.toContain(KEY);
  });

  it("throws on empty content, so an empty rewrite can never pass the guard as a Best-self answer", async () => {
    for (const content of ["", "   ", "<think>only thinking</think>", null, undefined]) {
      const e = await rejection(chatText(env, { model: "m", messages }, fakeFetch(() => completion(content)).impl));
      expect(e).toBeInstanceOf(UpstreamError);
    }
    const noChoices = fakeFetch(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    expect(await rejection(chatText(env, { model: "m", messages }, noChoices.impl))).toBeInstanceOf(UpstreamError);
  });
});

describe("forwardChatCompletions", () => {
  const incoming = {
    model: "whatever-elevenlabs-sent",
    messages: [{ role: "system", content: "You are Sage." }],
    tools: [{ type: "function", function: { name: "end_call" } }],
    temperature: 0.6,
    stream: false,
    elevenlabs_extra_body: { reasoning_effort: "none" },
  };

  it("pins the coach model, injects reasoning_effort none, forces stream, drops elevenlabs_extra_body", async () => {
    const f = fakeFetch(() => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    await forwardChatCompletions(env, incoming, f.impl);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://nebius.test/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(call.init.body as string)).toEqual({
      model: "deepseek-ai/DeepSeek-V4-Pro-0813",
      messages: incoming.messages,
      tools: incoming.tools,
      temperature: 0.6,
      stream: true,
      reasoning_effort: "none",
    });
  });

  it("does not mutate the caller's body", async () => {
    const body = structuredClone(incoming);
    await forwardChatCompletions(env, body, fakeFetch(() => new Response("")).impl);
    expect(body).toEqual(incoming);
  });

  it("returns Nebius's Response untouched: same object, same body stream, status and content-type", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        c.close();
      },
    });
    const upstream = new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    const res = await forwardChatCompletions(env, incoming, fakeFetch(() => upstream).impl);
    expect(res).toBe(upstream);
    const upstreamBody = upstream.body;
    expect(res.body).toBe(upstreamBody);
    expect(res.bodyUsed).toBe(false);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("passes an upstream error status through rather than throwing", async () => {
    const upstream = new Response('{"error":"rate limited"}', { status: 429, headers: { "content-type": "application/json" } });
    const res = await forwardChatCompletions(env, incoming, fakeFetch(() => upstream).impl);
    expect(res).toBe(upstream);
    expect(res.status).toBe(429);
  });

  it("rejects a body that is not a JSON object with TypeError, before any fetch", async () => {
    const f = fakeFetch(() => new Response(""));
    for (const bad of [null, [], "text", 3]) {
      expect(await rejection(forwardChatCompletions(env, bad, f.impl))).toBeInstanceOf(TypeError);
    }
    expect(f.calls).toHaveLength(0);
  });
});
