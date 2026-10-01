import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env";
import { getCode, getCodeRequest, insertCodeRequest } from "../src/worker/db";
import { handle } from "../src/worker/index";
import { inviteText, parseCommand, telegramWebhook } from "../src/worker/routes/telegram";
import { testEnv } from "./support/fakeD1";

const OWNER = 42;
let env: Env;
beforeEach(() => {
  env = testEnv({ TELEGRAM_BOT_TOKEN: "test-bot-token", TELEGRAM_WEBHOOK_SECRET: "test-hook-secret", TELEGRAM_OWNER_ID: String(OWNER) });
});

function update(text: string, opts: { from?: number; chat?: number; type?: string; secret?: string | null } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = opts.secret === undefined ? "test-hook-secret" : opts.secret;
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("https://sage.test/telegram/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify({ update_id: 1, message: { text, from: { id: opts.from ?? OWNER }, chat: { id: opts.chat ?? OWNER, type: opts.type ?? "private" } } }),
  });
}

async function say(text: string): Promise<string> {
  const res = await telegramWebhook(update(text), env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { method: string; chat_id: number; text: string };
  expect(body.method).toBe("sendMessage");
  expect(body.chat_id).toBe(OWNER);
  return body.text;
}

const codesIn = (text: string) => text.match(/SAGE-[A-Z0-9]{4}-[A-Z0-9]{4}/g) ?? [];

describe("telegram webhook access", () => {
  it("401 without or with a wrong secret header", async () => {
    expect((await telegramWebhook(update("/stats", { secret: null }), env)).status).toBe(401);
    expect((await telegramWebhook(update("/stats", { secret: "wrong" }), env)).status).toBe(401);
  });

  it("404 when the bot is not configured", async () => {
    expect((await telegramWebhook(update("/stats"), testEnv())).status).toBe(404);
  });

  it("ignores anyone but the owner, and the owner outside a private chat, with an empty 200", async () => {
    for (const r of [update("/guest", { from: 7, chat: 7 }), update("/guest", { chat: -100, type: "group" }), update("/guest", { from: 7 })]) {
      const res = await telegramWebhook(r, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    }
    expect(codesIn(await say("/stats"))).toHaveLength(0);
    expect(await say("/stats")).toContain("Codes:\n  none");
  });

  it("is routed at POST /telegram/webhook", async () => {
    expect((await handle(update("/help"), env)).status).toBe(200);
  });
});

describe("telegram commands", () => {
  it("parses spaced and glued commands and strips the bot name", () => {
    expect(parseCommand("/approve 12 5")).toEqual({ cmd: "approve", args: ["12", "5"] });
    expect(parseCommand("/approve_12@SageBot")).toEqual({ cmd: "approve", args: ["12"] });
    expect(parseCommand("hello")).toBeNull();
  });

  it("/guest issues Guest codes with 3 Rounds and an optional note", async () => {
    const one = codesIn(await say("/guest"));
    expect(one).toHaveLength(1);
    expect(await getCode(env.DB, one[0]!)).toMatchObject({ kind: "guest", allowance: 3, note: null });

    const many = codesIn(await say("/guest 3 meetup in CDMX"));
    expect(many).toHaveLength(3);
    expect(await getCode(env.DB, many[2]!)).toMatchObject({ note: "meetup in CDMX" });

    const noted = codesIn(await say("/guest for Ana"));
    expect(await getCode(env.DB, noted[0]!)).toMatchObject({ note: "for Ana" });

    expect(codesIn(await say("/guest 51"))).toHaveLength(0);
  });

  it("/gift needs a Round count", async () => {
    const [code] = codesIn(await say("/gift 10 Ana interview prep"));
    expect(await getCode(env.DB, code!)).toMatchObject({ kind: "gift", allowance: 10, note: "Ana interview prep" });
    expect(await say("/gift")).toMatch(/^Usage/);
    expect(await say("/gift 0")).toMatch(/^Usage/);
  });

  it("/requests lists pending requests; /approve issues a code with the Contact set and a ready message", async () => {
    expect(await say("/requests")).toBe("No pending requests.");
    const id = await insertCodeRequest(env.DB, { handle: "ana.dev", job: "https://jobs.test/1", lang: "es", ip_hash: null, now: new Date() });
    const list = await say("/requests");
    expect(list).toContain(`#${id} @ana.dev [es]`);
    expect(list).toContain("Job: https://jobs.test/1");

    const text = await say(`/approve_${id}`);
    const [code] = codesIn(text);
    expect(text).toContain("Reply to @ana.dev's DM with:");
    expect(text).toContain("La práctica es en inglés");
    expect(text).toContain("https://sage.test");
    expect(await getCode(env.DB, code!)).toMatchObject({ kind: "guest", allowance: 3, contact: "@ana.dev", note: `request #${id}` });
    expect(await getCodeRequest(env.DB, id)).toMatchObject({ status: "approved", code });

    expect(await say(`/approve ${id}`)).toContain("already approved");
    expect(await say("/requests")).toBe("No pending requests.");
  });

  it("/approve with a Round count issues a Gift code", async () => {
    const id = await insertCodeRequest(env.DB, { handle: "ana", job: null, lang: "en", ip_hash: null, now: new Date() });
    const [code] = codesIn(await say(`/approve ${id} 8`));
    expect(await getCode(env.DB, code!)).toMatchObject({ kind: "gift", allowance: 8 });
    expect(await say("/approve 999")).toBe("No request #999.");
  });

  it("/dismiss closes a request without a code", async () => {
    const id = await insertCodeRequest(env.DB, { handle: "spam.bot", job: null, lang: "en", ip_hash: null, now: new Date() });
    expect(await say(`/dismiss_${id}`)).toBe(`Dismissed #${id}.`);
    expect(await getCodeRequest(env.DB, id)).toMatchObject({ status: "dismissed", code: null });
    expect(await say(`/dismiss_${id}`)).toContain("not pending");
  });

  it("/code looks a code up; /stats sums codes and Rounds", async () => {
    const [code] = codesIn(await say("/gift 5 Ana"));
    const info = await say(`/code ${code!.toLowerCase()}`);
    expect(info).toContain(`${code} (gift)`);
    expect(info).toContain("Rounds: 0 of 5 used");
    expect(await say("/code SAGE-NOPE-NOPE")).toBe("No such code.");
    const stats = await say("/stats");
    expect(stats).toContain("gift: 1 codes, 0 of 5 Rounds used");
    expect(stats).toContain("Estimated ElevenLabs credits: about 0");
  });

  it("answers help to /start, plain text and unknown commands", async () => {
    expect(await say("/start")).toContain("/guest");
    expect(await say("hi")).toContain("/approve");
    expect(await say("/nope")).toMatch(/^Unknown command/);
  });

  it("writes the invite in English or Spanish", () => {
    expect(inviteText("SAGE-AAAA-BBBB", 1, "https://x.test", "en")).toContain("1 Round (one");
    expect(inviteText("SAGE-AAAA-BBBB", 3, "https://x.test", "es")).toContain("3 Rondas");
  });
});
