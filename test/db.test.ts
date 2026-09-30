import { beforeEach, describe, expect, it } from "vitest";
import { createFakeD1 } from "./support/fakeD1";
import {
  clearVoice, createCodes, failRound, finishRound, generateCode, getCode, getRound, insertRound,
  listVoicesToClean, normaliseCode, refundRound, setContact, setConversationId, setVoice, spendRound,
} from "../src/worker/db";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (d: number) => minutesAgo(d * 24 * 60);

let db: D1Database;
beforeEach(() => {
  db = createFakeD1();
});

async function oneCode(kind: "guest" | "gift" | "owner" = "guest", allowance = 3): Promise<string> {
  const [code] = await createCodes(db, { kind, count: 1, allowance });
  return code!;
}

describe("the D1 fake", () => {
  it("applies every migration, including 0002's Round texts", async () => {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('rounds')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toEqual(expect.arrayContaining(["final_answer", "best_self_text"]));
  });

  it("rolls a failed batch back", async () => {
    const insert = db.prepare("INSERT INTO codes (code, kind, allowance) VALUES (?, ?, ?)");
    await expect(db.batch([insert.bind("A", "guest", 1), insert.bind("A", "guest", 1)])).rejects.toThrow();
    expect(await getCode(db, "A")).toBeNull();
  });

  it("rejects undefined binds, as D1 does", () => {
    expect(() => db.prepare("SELECT ?").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
  });

  it("enforces foreign keys, as D1 does", async () => {
    await expect(insertRound(db, { id: "r1", code: "NOPE", question_id: "q" })).rejects.toThrow();
  });
});

describe("codes", () => {
  it("generates SAGE-XXXX-XXXX from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^SAGE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("normalises case and whitespace", () => {
    expect(normaliseCode("  sage-abcd -efgh\n")).toBe("SAGE-ABCD-EFGH");
  });

  it("creates distinct codes with kind, Allowance and note", async () => {
    const codes = await createCodes(db, { kind: "gift", count: 5, allowance: 7, note: "for a friend" });
    expect(new Set(codes).size).toBe(5);
    const row = await getCode(db, codes[0]!);
    expect(row).toMatchObject({ kind: "gift", allowance: 7, used: 0, note: "for a friend", contact: null, voice_id: null });
  });

  it("returns null for an unknown code", async () => {
    expect(await getCode(db, "SAGE-NONE-NONE")).toBeNull();
  });

  it("sets the Contact", async () => {
    const code = await oneCode();
    await setContact(db, code, "@mel");
    expect((await getCode(db, code))!.contact).toBe("@mel");
  });

  it("sets and clears the Voice clone", async () => {
    const code = await oneCode();
    await setVoice(db, code, "voice-1", NOW);
    expect(await getCode(db, code)).toMatchObject({ voice_id: "voice-1", voice_created_at: NOW.toISOString() });
    await clearVoice(db, code);
    expect(await getCode(db, code)).toMatchObject({ voice_id: null, voice_created_at: null });
  });
});

describe("spendRound and refundRound", () => {
  it("spends up to the Allowance and no further", async () => {
    const code = await oneCode("guest", 3);
    expect(await spendRound(db, code, NOW)).toBe(true);
    expect(await spendRound(db, code, NOW)).toBe(true);
    expect(await spendRound(db, code, NOW)).toBe(true);
    expect(await spendRound(db, code, NOW)).toBe(false);
    expect(await getCode(db, code)).toMatchObject({ used: 3, last_used_at: NOW.toISOString() });
  });

  it("returns false for an unknown code", async () => {
    expect(await spendRound(db, "SAGE-NONE-NONE", NOW)).toBe(false);
  });

  it("refunds a Round but never below zero", async () => {
    const code = await oneCode("guest", 1);
    await spendRound(db, code, NOW);
    await refundRound(db, code);
    expect((await getCode(db, code))!.used).toBe(0);
    await refundRound(db, code);
    expect((await getCode(db, code))!.used).toBe(0);
    expect(await spendRound(db, code, NOW)).toBe(true);
  });
});

describe("listVoicesToClean", () => {
  async function codeWith(opts: { kind?: "guest" | "gift" | "owner"; allowance: number; used: number; lastUsed?: Date; voiceAt: Date; voice?: string | null }) {
    const code = await oneCode(opts.kind ?? "guest", opts.allowance);
    for (let i = 0; i < opts.used; i++) await spendRound(db, code, opts.lastUsed ?? NOW);
    if (opts.voice !== null) await setVoice(db, code, opts.voice ?? `voice-${code}`, opts.voiceAt);
    return code;
  }

  it("cleans a used-up Allowance whose last Round started more than an hour ago", async () => {
    const code = await codeWith({ allowance: 3, used: 3, lastUsed: minutesAgo(61), voiceAt: daysAgo(1) });
    expect(await listVoicesToClean(db, NOW)).toEqual([{ code, voice_id: `voice-${code}` }]);
  });

  it("cleans exactly at the one-hour mark", async () => {
    await codeWith({ allowance: 1, used: 1, lastUsed: minutesAgo(60), voiceAt: daysAgo(1) });
    expect(await listVoicesToClean(db, NOW)).toHaveLength(1);
  });

  it("keeps a used-up Allowance inside the one-hour grace, so the last Replay still has its voice", async () => {
    await codeWith({ allowance: 3, used: 3, lastUsed: minutesAgo(59), voiceAt: daysAgo(1) });
    expect(await listVoicesToClean(db, NOW)).toEqual([]);
  });

  it("keeps a code with Rounds left", async () => {
    await codeWith({ allowance: 3, used: 2, lastUsed: daysAgo(2), voiceAt: daysAgo(2) });
    expect(await listVoicesToClean(db, NOW)).toEqual([]);
  });

  it("cleans a Voice clone 7 days old even with Rounds left", async () => {
    await codeWith({ allowance: 3, used: 0, voiceAt: daysAgo(7) });
    await codeWith({ kind: "gift", allowance: 9, used: 1, lastUsed: daysAgo(8), voiceAt: daysAgo(8) });
    expect(await listVoicesToClean(db, NOW)).toHaveLength(2);
  });

  it("keeps a Voice clone younger than 7 days", async () => {
    await codeWith({ allowance: 3, used: 0, voiceAt: minutesAgo(7 * 24 * 60 - 1) });
    expect(await listVoicesToClean(db, NOW)).toEqual([]);
  });

  it("never lists an owner code, however old or used up", async () => {
    await codeWith({ kind: "owner", allowance: 1, used: 1, lastUsed: daysAgo(30), voiceAt: daysAgo(30) });
    expect(await listVoicesToClean(db, NOW)).toEqual([]);
  });

  it("never lists a code without a Voice clone", async () => {
    await codeWith({ allowance: 1, used: 1, lastUsed: daysAgo(30), voiceAt: daysAgo(30), voice: null });
    expect(await listVoicesToClean(db, NOW)).toEqual([]);
  });
});

describe("rounds", () => {
  let code: string;
  let other: string;
  beforeEach(async () => {
    code = await oneCode();
    other = await oneCode();
    await insertRound(db, { id: "r1", code, question_id: "shipped-system" });
  });

  it("inserts a started Round", async () => {
    expect(await getRound(db, "r1", code)).toMatchObject({
      id: "r1", code, question_id: "shipped-system", status: "started", conversation_id: null,
      rewrite_attempts: 0, guard_failures: null, final_answer: null, best_self_text: null,
    });
  });

  it("scopes getRound to the session's code", async () => {
    expect(await getRound(db, "r1", other)).toBeNull();
    expect(await getRound(db, "missing", code)).toBeNull();
  });

  it("sets the conversation id", async () => {
    await setConversationId(db, "r1", "conv_1");
    expect((await getRound(db, "r1", code))!.conversation_id).toBe("conv_1");
  });

  it("finishes a started Round once, storing texts and guard failures as JSON", async () => {
    const failures = [{ rule: "new-number" as const, detail: '"52" is not in the Answer' }];
    const args = { status: "replayed" as const, final_answer: "we built it", best_self_text: "We built it.", rewrite_attempts: 2, guard_failures: failures };
    expect(await finishRound(db, "r1", args)).toBe(true);
    const row = (await getRound(db, "r1", code))!;
    expect(row).toMatchObject({ status: "replayed", final_answer: "we built it", best_self_text: "We built it.", rewrite_attempts: 2 });
    expect(JSON.parse(row.guard_failures!)).toEqual(failures);
    expect(await finishRound(db, "r1", { ...args, status: "fallback" })).toBe(false);
    expect((await getRound(db, "r1", code))!.status).toBe("replayed");
  });

  it("fails a started Round, and never a finished one", async () => {
    expect(await failRound(db, "r1")).toBe(true);
    expect((await getRound(db, "r1", code))!.status).toBe("failed");
    expect(await finishRound(db, "r1", { status: "fallback", final_answer: "a", best_self_text: "A.", rewrite_attempts: 2, guard_failures: [] })).toBe(false);
    await insertRound(db, { id: "r2", code, question_id: "why-this-role" });
    await finishRound(db, "r2", { status: "fallback", final_answer: "a", best_self_text: "A.", rewrite_attempts: 2, guard_failures: [] });
    expect(await failRound(db, "r2")).toBe(false);
    expect((await getRound(db, "r2", code))!.status).toBe("fallback");
  });
});
