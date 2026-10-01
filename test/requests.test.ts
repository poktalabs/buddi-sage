import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/worker/env";
import { getCodeRequest, listPendingRequests } from "../src/worker/db";
import { createCodeRequest, REQUESTS_PER_HOUR } from "../src/worker/routes/requests";
import { MAX_JOB_LENGTH, normaliseHandle, normaliseJob } from "../src/worker/social";
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

describe("request fields", () => {
  it("accepts a bare handle, a leading @ or a profile URL", () => {
    expect(normaliseHandle("@ana.dev_")).toBe("ana.dev_");
    expect(normaliseHandle("https://x.com/ana_dev")).toBe("ana_dev");
    expect(normaliseHandle("tiktok.com/@ana.dev")).toBe("ana.dev");
    expect(normaliseHandle("instagram.com/ana.dev/")).toBe("ana.dev");
    expect(normaliseHandle("ana dev")).toBeNull();
    expect(normaliseHandle("a".repeat(31))).toBeNull();
    expect(normaliseHandle("@")).toBeNull();
  });

  it("takes the job as a link or a title, up to the limit", () => {
    expect(normaliseJob("  Senior   backend engineer ")).toBe("Senior backend engineer");
    expect(normaliseJob("https://jobs.example.com/1")).toBe("https://jobs.example.com/1");
    expect(normaliseJob("   ")).toBeNull();
    expect(normaliseJob("x".repeat(MAX_JOB_LENGTH + 1))).toBeUndefined();
  });
});

describe("createCodeRequest", () => {
  it("stores a request and pings Mel with the profile link and job", async () => {
    const f = okFetch();
    const res = await createCodeRequest(post({ handle: "@ana.dev", platform: "instagram", job: "https://jobs.example.com/1", lang: "es" }), env, f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await listPendingRequests(env.DB, 10);
    expect(row).toMatchObject({ handle: "ana.dev", platform: "instagram", job: "https://jobs.example.com/1", lang: "es", status: "pending" });
    expect(row!.ip_hash).toBeTruthy();
    expect(row!.ip_hash).not.toContain("203.0.113.7");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const sent = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(sent.chat_id).toBe("42");
    expect(sent.text).toContain("From: @ana.dev on Instagram");
    expect(sent.text).toContain("Job: https://jobs.example.com/1");
    expect(sent.text).toContain(`/approve_${row!.id}`);
  });

  it("keeps the platform optional but rejects an unknown one", async () => {
    expect((await createCodeRequest(post({ handle: "no_tap" }), env, okFetch())).status).toBe(200);
    expect((await createCodeRequest(post({ handle: "bad_tap", platform: "myspace" }), env, okFetch())).status).toBe(400);
    const rows = await listPendingRequests(env.DB, 10);
    expect(rows.map((r) => [r.handle, r.platform])).toEqual([["no_tap", null]]);
  });

  it("makes the job optional, takes a title, and defaults the language to English", async () => {
    await createCodeRequest(post({ handle: "ana_dev" }), env, okFetch());
    await createCodeRequest(post({ handle: "bo", job: "Staff engineer at Acme" }), env, okFetch());
    const rows = await listPendingRequests(env.DB, 10);
    expect(rows[0]).toMatchObject({ handle: "ana_dev", lang: "en", job: null });
    expect(rows[1]).toMatchObject({ handle: "bo", job: "Staff engineer at Acme" });
  });

  it("400 on a missing or bad handle, or a bad job", async () => {
    for (const body of [{}, { handle: "not valid" }, { handle: "ana", job: 5 }, { handle: "ana", job: "x".repeat(MAX_JOB_LENGTH + 1) }]) {
      expect((await createCodeRequest(post(body), env, okFetch())).status).toBe(400);
    }
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(0);
  });

  it("answers ok to a filled honeypot without storing or pinging", async () => {
    const f = okFetch();
    const res = await createCodeRequest(post({ handle: "bot", website: "http://spam" }), env, f);
    expect(res.status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("does not store or ping twice for a handle that already has a pending request", async () => {
    const f = okFetch();
    await createCodeRequest(post({ handle: "ana.dev" }), env, f);
    const again = await createCodeRequest(post({ handle: "@ANA.dev" }, "198.51.100.1"), env, f);
    expect(again.status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it(`429 rate_limited after ${REQUESTS_PER_HOUR} requests from one IP in an hour, and lets it through an hour later`, async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    for (let i = 0; i < REQUESTS_PER_HOUR; i++) {
      expect((await createCodeRequest(post({ handle: `p${i}` }), env, okFetch(), now)).status).toBe(200);
    }
    const blocked = await createCodeRequest(post({ handle: "late" }), env, okFetch(), now);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect((await createCodeRequest(post({ handle: "other" }, "198.51.100.9"), env, okFetch(), now)).status).toBe(200);
    const later = new Date(now.getTime() + 61 * 60 * 1000);
    expect((await createCodeRequest(post({ handle: "late" }), env, okFetch(), later)).status).toBe(200);
  });

  it("still stores the request when the bot is off or Telegram fails", async () => {
    const off = testEnv();
    const f = okFetch();
    expect((await createCodeRequest(post({ handle: "a_1" }), off, f)).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    expect(await getCodeRequest(off.DB, 1)).toMatchObject({ handle: "a_1" });

    const failing = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect((await createCodeRequest(post({ handle: "b_2" }), env, failing)).status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(1);
  });
});
