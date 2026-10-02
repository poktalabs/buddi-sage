import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import worker, { handle } from "../src/worker/index";
import { createCodes } from "../src/worker/db";
import { sessionCookie } from "../src/worker/session";
import { testEnv } from "./support/fakeD1";

let env: Env;
let cookie: string;
beforeEach(async () => {
  env = testEnv();
  const [code] = (await createCodes(env.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
  cookie = (await sessionCookie(code, env.SESSION_SECRET)).split(";")[0]!;
});

function req(method: string, path: string, opts: { cookie?: string; auth?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.auth) headers.authorization = opts.auth;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`https://sage.test${path}`, init);
}

async function call(r: Request): Promise<{ status: number; error?: string }> {
  const res = await handle(r, env);
  const body = (await res.json()) as Partial<ApiError>;
  return { status: res.status, error: body.error };
}

const SESSION_ROUTES: [string, string][] = [
  ["GET", "/api/me"],
  ["POST", "/api/voice"],
  ["DELETE", "/api/voice"],
  ["POST", "/api/rounds"],
  ["POST", "/api/rounds/r1/replay"],
  ["GET", "/api/rounds/r1/audio"],
  ["GET", "/api/dashboard"],
  ["POST", "/api/dashboard/codes"],
];

describe("router", () => {
  it.each(SESSION_ROUTES)("%s %s requires the session cookie", async (method, path) => {
    expect(await call(req(method, path))).toEqual({ status: 401, error: "unauthorized" });
    expect(await call(req(method, path, { cookie: "sage_session=SAGE-FAKE-FAKE.forged" }))).toEqual({ status: 401, error: "unauthorized" });
  });

  it("POST /api/logout expires the session cookie, with or without a valid one", async () => {
    for (const r of [req("POST", "/api/logout", { cookie }), req("POST", "/api/logout")]) {
      const res = await handle(r, env);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie.startsWith("sage_session=;")).toBe(true);
      for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=0"]) expect(setCookie).toContain(attr);
    }
  });

  it("GET /api/me reaches the access handler with a valid cookie", async () => {
    const res = await handle(req("GET", "/api/me", { cookie }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "guest", allowance: 3 });
  });

  // Each Wave 2 route reaches its real handler: the answer is that handler's own first check
  // for a request with a valid cookie and no body, never the Wave 1 stub's 501.
  const WAVE_2_FIRST_CHECK: [string, string, number, string | undefined][] = [
    ["POST", "/api/voice", 400, "bad_request"],
    ["DELETE", "/api/voice", 200, undefined],
    ["POST", "/api/rounds", 400, "bad_request"],
    ["POST", "/api/rounds/r1/replay", 404, "round_not_found"],
    ["GET", "/api/rounds/r1/audio", 404, "round_not_found"],
  ];
  it.each(WAVE_2_FIRST_CHECK)("%s %s is wired to its Wave 2 handler", async (method, path, status, error) => {
    expect(await call(req(method, path, { cookie }))).toEqual({ status, error });
  });

  it.each([["GET", "/api/dashboard"], ["POST", "/api/dashboard/codes"]])("%s %s is wired to the owner check", async (method, path) => {
    expect(await call(req(method, path, { cookie }))).toEqual({ status: 403, error: "forbidden" });
  });

  it("POST /api/redeem needs no cookie", async () => {
    expect(await call(req("POST", "/api/redeem", { body: { code: "SAGE-NOPE-NOPE" } }))).toEqual({ status: 404, error: "invalid_code" });
  });

  it("POST /admin/codes checks its own bearer, not the cookie", async () => {
    expect(await call(req("POST", "/admin/codes", { cookie, body: { kind: "guest" } }))).toEqual({ status: 401, error: "unauthorized" });
    const res = await handle(req("POST", "/admin/codes", { auth: "Bearer test-admin-secret", body: { kind: "guest" } }), env);
    expect(res.status).toBe(200);
  });

  it.each(["/llm/v1/chat/completions", "/llm/chat/completions"])("POST %s reaches the LLM handler without a cookie", async (path) => {
    // 401 from the handler's own bearer check proves the router asked for no cookie.
    expect(await call(req("POST", path))).toEqual({ status: 401, error: "unauthorized" });
  });

  it("answers 404 bad_request for unknown paths and wrong methods", async () => {
    for (const [method, path] of [
      ["GET", "/api/nope"],
      ["GET", "/api/redeem"],
      ["PUT", "/api/voice"],
      ["GET", "/admin/codes"],
      ["GET", "/llm/v1/chat/completions"],
      ["POST", "/api/rounds/r1"],
      ["POST", "/api/rounds/a/b/replay"],
      ["GET", "/api/me/extra"],
    ] as const) {
      expect(await call(req(method, path, { cookie })), `${method} ${path}`).toEqual({ status: 404, error: "bad_request" });
    }
  });
});

describe("worker export", () => {
  it("turns an unexpected throw into a JSON 500 without leaking the message", async () => {
    const broken = testEnv({ SESSION_SECRET: "" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [code] = (await createCodes(broken.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
    const res = await worker.fetch!(req("POST", "/api/redeem", { body: { code, contact: "@mel" } }) as never, broken, {} as ExecutionContext);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "upstream_error" });
    expect(errSpy).toHaveBeenCalledWith("unhandled worker error", "Error");
    errSpy.mockRestore();
  });

  it("scheduled runs the Voice clone cleanup inside waitUntil", async () => {
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    await worker.scheduled!({ cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} }, env, ctx);
    expect(waited).toHaveLength(1);
    await expect(waited[0]).resolves.toBeUndefined();
  });
});
