import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/worker/env";
import { getCodeRequest, listPendingRequests } from "../src/worker/db";
import { createCodeRequest, REQUESTS_PER_HOUR } from "../src/worker/routes/requests";
import { normaliseHandle, normaliseJobUrl, profileUrl } from "../src/worker/social";
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

describe("social handles", () => {
  it("accepts a bare handle, a leading @ or a profile URL, per platform rules", () => {
    expect(normaliseHandle("instagram", "@ana.dev_")).toBe("ana.dev_");
    expect(normaliseHandle("x", "https://x.com/ana_dev")).toBe("ana_dev");
    expect(normaliseHandle("tiktok", "tiktok.com/@ana.dev")).toBe("ana.dev");
    expect(normaliseHandle("x", "ana.dev")).toBeNull(); // X has no dots
    expect(normaliseHandle("x", "a".repeat(16))).toBeNull();
    expect(normaliseHandle("instagram", "ana dev")).toBeNull();
    expect(normaliseHandle("tiktok", "a")).toBeNull();
  });

  it("links to the profile", () => {
    expect(profileUrl("instagram", "ana")).toBe("https://instagram.com/ana");
    expect(profileUrl("x", "ana")).toBe("https://x.com/ana");
    expect(profileUrl("tiktok", "ana")).toBe("https://www.tiktok.com/@ana");
  });

  it("accepts http(s) job links, adding https:// when missing", () => {
    expect(normaliseJobUrl("jobs.example.com/123")).toBe("https://jobs.example.com/123");
    expect(normaliseJobUrl("http://x.test/a")).toBe("http://x.test/a");
    expect(normaliseJobUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseJobUrl("https://x.test/" + "a".repeat(500))).toBeNull();
  });
});

describe("createCodeRequest", () => {
  it("stores a request and pings Mel with the profile link and job", async () => {
    const f = okFetch();
    const res = await createCodeRequest(post({ platform: "instagram", handle: "@ana.dev", job_url: "https://jobs.example.com/1", lang: "es" }), env, f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await listPendingRequests(env.DB, 10);
    expect(row).toMatchObject({ platform: "instagram", handle: "ana.dev", job_url: "https://jobs.example.com/1", lang: "es", status: "pending" });
    expect(row!.ip_hash).toBeTruthy();
    expect(row!.ip_hash).not.toContain("203.0.113.7");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const sent = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(sent.chat_id).toBe("42");
    expect(sent.text).toContain("@ana.dev (Instagram)");
    expect(sent.text).toContain("https://instagram.com/ana.dev");
    expect(sent.text).toContain("Job: https://jobs.example.com/1");
    expect(sent.text).toContain(`/approve_${row!.id}`);
  });

  it("makes the job link optional and defaults the language to English", async () => {
    await createCodeRequest(post({ platform: "x", handle: "ana_dev" }), env, okFetch());
    expect((await listPendingRequests(env.DB, 10))[0]).toMatchObject({ platform: "x", handle: "ana_dev", lang: "en", job_url: null });
  });

  it("400 on an unknown platform, a bad handle, or a bad job link", async () => {
    for (const body of [
      {},
      { platform: "facebook", handle: "ana" },
      { platform: "x", handle: "not valid" },
      { platform: "x", handle: "ana", job_url: 5 },
      { platform: "x", handle: "ana", job_url: "javascript:alert(1)" },
    ]) {
      expect((await createCodeRequest(post(body), env, okFetch())).status).toBe(400);
    }
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(0);
  });

  it("answers ok to a filled honeypot without storing or pinging", async () => {
    const f = okFetch();
    const res = await createCodeRequest(post({ platform: "x", handle: "bot", website: "http://spam" }), env, f);
    expect(res.status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("does not store or ping twice for a handle that already has a pending request", async () => {
    const f = okFetch();
    await createCodeRequest(post({ platform: "tiktok", handle: "ana.dev" }), env, f);
    const again = await createCodeRequest(post({ platform: "tiktok", handle: "@ANA.dev" }, "198.51.100.1"), env, f);
    expect(again.status).toBe(200);
    await createCodeRequest(post({ platform: "instagram", handle: "ana.dev" }, "198.51.100.2"), env, f);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it(`429 rate_limited after ${REQUESTS_PER_HOUR} requests from one IP in an hour, and lets it through an hour later`, async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    for (let i = 0; i < REQUESTS_PER_HOUR; i++) {
      expect((await createCodeRequest(post({ platform: "x", handle: `p${i}` }), env, okFetch(), now)).status).toBe(200);
    }
    const blocked = await createCodeRequest(post({ platform: "x", handle: "late" }), env, okFetch(), now);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect((await createCodeRequest(post({ platform: "x", handle: "other" }, "198.51.100.9"), env, okFetch(), now)).status).toBe(200);
    const later = new Date(now.getTime() + 61 * 60 * 1000);
    expect((await createCodeRequest(post({ platform: "x", handle: "late" }), env, okFetch(), later)).status).toBe(200);
  });

  it("still stores the request when the bot is off or Telegram fails", async () => {
    const off = testEnv();
    const f = okFetch();
    expect((await createCodeRequest(post({ platform: "x", handle: "a_1" }), off, f)).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    expect(await getCodeRequest(off.DB, 1)).toMatchObject({ handle: "a_1" });

    const failing = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect((await createCodeRequest(post({ platform: "x", handle: "b_2" }), env, failing)).status).toBe(200);
    expect(await listPendingRequests(env.DB, 10)).toHaveLength(1);
  });
});
