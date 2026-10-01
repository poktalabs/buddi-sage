import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/worker/env";
import { getCodeRequest, listPendingRequests } from "../src/worker/db";
import { createCodeRequest, REQUESTS_PER_HOUR } from "../src/worker/routes/requests";
import { testEnv } from "./support/fakeD1";

let env: Env;
beforeEach(() => {
  env = testEnv({ TELEGRAM_BOT_TOKEN: "test-bot-token", TELEGRAM_OWNER_ID: "42" });
});

function post(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("https://sage.test/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

describe("createCodeRequest", () => {
  it("stores a request and pings Mel on Telegram", async () => {
    const f = okFetch();
    const res = await createCodeRequest(post({ contact: "ana@example.com", goal: "  backend   interview ", lang: "es" }), env, f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await listPendingRequests(env.DB, 10);
    expect(row).toMatchObject({ contact: "ana@example.com", goal: "backend interview", lang: "es", status: "pending" });
    expect(row!.ip_hash).toBeTruthy();
    expect(row!.ip_hash).not.toContain("203.0.113.7");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const sent = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(sent.chat_id).toBe("42");
    expect(sent.text).toContain(`/approve_${row!.id}`);
    expect(sent.text).toContain("ana@example.com");
  });

  it("accepts an X handle and defaults the language to English", async () => {
    await createCodeRequest(post({ contact: "@ana_dev" }), env, okFetch());
    expect((await listPendingRequests(env.DB, 10))[0]).toMatchObject({ contact: "@ana_dev", lang: "en", goal: null });
  });

  it("400 on a missing or malformed Contact, a non-string goal, or a goal over 280 characters", async () => {
    for (const body of [{}, { contact: "nope" }, { contact: "a@b.co", goal: 5 }, { contact: "a@b.co", goal: "x".repeat(281) }]) {
      expect((await createCodeRequest(post(body), env, okFetch())).status).toBe(400);
    }
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(0);
  });

  it("answers ok to a filled honeypot without storing or pinging", async () => {
    const f = okFetch();
    const res = await createCodeRequest(post({ contact: "bot@example.com", website: "http://spam" }), env, f);
    expect(res.status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("does not store or ping twice for a Contact that already has a pending request", async () => {
    const f = okFetch();
    await createCodeRequest(post({ contact: "ana@example.com" }), env, f);
    const again = await createCodeRequest(post({ contact: "ANA@example.com" }, "198.51.100.1"), env, f);
    expect(again.status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it(`429 rate_limited after ${REQUESTS_PER_HOUR} requests from one IP in an hour, and lets it through an hour later`, async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    for (let i = 0; i < REQUESTS_PER_HOUR; i++) {
      expect((await createCodeRequest(post({ contact: `p${i}@example.com` }), env, okFetch(), now)).status).toBe(200);
    }
    const blocked = await createCodeRequest(post({ contact: "late@example.com" }), env, okFetch(), now);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    const other = await createCodeRequest(post({ contact: "other@example.com" }, "198.51.100.9"), env, okFetch(), now);
    expect(other.status).toBe(200);
    const later = new Date(now.getTime() + 61 * 60 * 1000);
    expect((await createCodeRequest(post({ contact: "late@example.com" }), env, okFetch(), later)).status).toBe(200);
  });

  it("still stores the request when the bot is off or Telegram fails", async () => {
    const off = testEnv();
    const f = okFetch();
    expect((await createCodeRequest(post({ contact: "a@example.com" }), off, f)).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    expect(await getCodeRequest(off.DB, 1)).toMatchObject({ contact: "a@example.com" });

    const failing = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect((await createCodeRequest(post({ contact: "b@example.com" }), env, failing)).status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(1);
  });
});
