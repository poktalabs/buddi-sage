import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import worker from "../src/worker/index";
import { chatCompletions } from "../src/worker/routes/llm";
import { testEnv } from "./support/fakeD1";

let env: Env;
beforeEach(() => {
  env = testEnv();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

const SSE = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
const sseResponse = () =>
  new Response(SSE, { status: 200, headers: { "content-type": "text/event-stream", "x-upstream": "nebius" } });

const BODY = { model: "whatever", messages: [{ role: "user", content: "secret guest words" }], stream: true };

function req(path: string, opts: { auth?: string | null; body?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = opts.auth === undefined ? "Bearer test-llm-secret" : opts.auth;
  if (auth !== null) headers.authorization = auth;
  return new Request(`https://sage.test${path}`, { method: "POST", headers, body: opts.body ?? JSON.stringify(BODY) });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as ApiError).error;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
async function viaRouter(r: Request): Promise<Response> {
  return worker.fetch!(r as Request<unknown, IncomingRequestCfProperties>, env, ctx);
}

describe("chatCompletions", () => {
  it("returns Nebius's Response untouched: status, headers and the SSE body", async () => {
    const upstream = sseResponse();
    const f = fakeFetch(() => upstream);
    const res = await chatCompletions(req("/llm/v1/chat/completions"), env, f.impl);
    expect(res).toBe(upstream);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-upstream")).toBe("nebius");
    expect(await res.text()).toBe(SSE);
  });

  it("forwards to Nebius with the Nebius key, the coach model and reasoning off", async () => {
    const f = fakeFetch(sseResponse);
    await chatCompletions(req("/llm/chat/completions"), env, f.impl);
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://nebius.test/v1/chat/completions");
    expect(new Headers(call.init.headers).get("authorization")).toBe("Bearer test-nebius-key");
    const sent = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: "coach-model", reasoning_effort: "none", stream: true, messages: BODY.messages });
  });

  it("passes a Nebius error status through as is", async () => {
    const upstream = new Response('{"error":"rate"}', { status: 429 });
    const res = await chatCompletions(req("/llm/v1/chat/completions"), env, fakeFetch(() => upstream).impl);
    expect(res).toBe(upstream);
    expect(res.status).toBe(429);
  });

  it("401 unauthorized on a missing, wrong or malformed bearer, before any upstream call", async () => {
    const f = fakeFetch(sseResponse);
    for (const auth of [null, "Bearer wrong", "Bearer test-llm-secretX", "test-llm-secret", "Basic test-llm-secret", "Bearer "]) {
      const res = await chatCompletions(req("/llm/v1/chat/completions", { auth }), env, f.impl);
      expect(res.status).toBe(401);
      expect(await errorOf(res)).toBe("unauthorized");
    }
    expect(f.calls).toHaveLength(0);
  });

  it("401 when LLM_PROXY_SECRET is unset, even with an empty bearer: fail closed", async () => {
    env = testEnv({ LLM_PROXY_SECRET: "" });
    const f = fakeFetch(sseResponse);
    const res = await chatCompletions(req("/llm/v1/chat/completions", { auth: "Bearer " }), env, f.impl);
    expect(res.status).toBe(401);
    expect(f.calls).toHaveLength(0);
  });

  it("400 bad_request on a non-JSON body", async () => {
    const f = fakeFetch(sseResponse);
    const res = await chatCompletions(req("/llm/v1/chat/completions", { body: "{not json" }), env, f.impl);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("bad_request");
    expect(f.calls).toHaveLength(0);
  });

  it("400 bad_request on a JSON body that is not an object (TypeError from the forwarder)", async () => {
    const f = fakeFetch(sseResponse);
    for (const body of ["[1,2]", "null", "42", '"text"']) {
      const res = await chatCompletions(req("/llm/v1/chat/completions", { body }), env, f.impl);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("bad_request");
    }
    expect(f.calls).toHaveLength(0);
  });

  it("502 upstream_error on a network rejection, logging no message content", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(() => Promise.reject(new TypeError("fetch failed: secret guest words")));
    const res = await chatCompletions(req("/llm/v1/chat/completions"), env, f.impl);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe("upstream_error");
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("secret guest words");
    expect(logged).not.toContain("test-llm-secret");
    expect(logged).not.toContain("test-nebius-key");
  });

  describe("through the router", () => {
    it.each(["/llm/v1/chat/completions", "/llm/chat/completions"])("POST %s reaches the handler and streams Nebius back", async (path) => {
      const f = fakeFetch(sseResponse);
      vi.stubGlobal("fetch", f.impl);
      const res = await viaRouter(req(path));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SSE);
      expect(f.calls).toHaveLength(1);
    });

    it.each(["/llm/v1/chat/completions", "/llm/chat/completions"])("POST %s answers 401 without the bearer", async (path) => {
      const f = fakeFetch(sseResponse);
      vi.stubGlobal("fetch", f.impl);
      const res = await viaRouter(req(path, { auth: null }));
      expect(res.status).toBe(401);
      expect(await errorOf(res)).toBe("unauthorized");
      expect(f.calls).toHaveLength(0);
    });
  });
});
