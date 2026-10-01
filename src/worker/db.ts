// Every D1 query the Worker runs lives here, so Wave 2 routes share one data layer instead of
// writing SQL of their own. Two decisions are encoded in the SQL itself: a Round is spent with
// one conditional UPDATE, so two tabs cannot both spend the last Round of an Allowance; and a
// Voice clone is only cleaned up an hour after the last Round started, so the hourly cron
// cannot delete it between that Round's start and its Replay. Owner codes are never cleaned.
// Timestamps written here are ISO 8601 UTC strings, which compare correctly as text.
import type { CodeKind, Lang, SocialPlatform } from "../shared/api";
import type { GuardFailure } from "./guards";

export type CodeRow = {
  code: string;
  kind: CodeKind;
  allowance: number;
  used: number;
  contact: string | null;
  voice_id: string | null;
  voice_created_at: string | null;
  note: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type RoundStatus = "started" | "replayed" | "fallback" | "failed";

export type RoundRow = {
  id: string;
  code: string;
  question_id: string;
  conversation_id: string | null;
  status: RoundStatus;
  rewrite_attempts: number;
  guard_failures: string | null;
  created_at: string;
  final_answer: string | null;
  best_self_text: string | null;
};

// Uppercase letters and digits without the look-alikes I, O, 0 and 1. 32 symbols, so a random
// byte modulo 32 has no bias.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function randomBlock(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** A new code, `SAGE-XXXX-XXXX`. */
export function generateCode(): string {
  return `SAGE-${randomBlock(4)}-${randomBlock(4)}`;
}

/** What a Guest typed, in the stored form: no whitespace, uppercase. */
export function normaliseCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

// Codes

export async function getCode(db: D1Database, code: string): Promise<CodeRow | null> {
  return db.prepare("SELECT * FROM codes WHERE code = ?").bind(code).first<CodeRow>();
}

export async function createCodes(
  db: D1Database,
  args: { kind: CodeKind; count: number; allowance: number; note?: string | null },
): Promise<string[]> {
  const codes = Array.from({ length: args.count }, generateCode);
  const insert = db.prepare("INSERT INTO codes (code, kind, allowance, note) VALUES (?, ?, ?, ?)");
  await db.batch(codes.map((c) => insert.bind(c, args.kind, args.allowance, args.note ?? null)));
  return codes;
}

export async function setContact(db: D1Database, code: string, contact: string): Promise<void> {
  await db.prepare("UPDATE codes SET contact = ? WHERE code = ?").bind(contact, code).run();
}

export async function setVoice(db: D1Database, code: string, voiceId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE codes SET voice_id = ?, voice_created_at = ? WHERE code = ?")
    .bind(voiceId, now.toISOString(), code)
    .run();
}

export async function clearVoice(db: D1Database, code: string): Promise<void> {
  await db.prepare("UPDATE codes SET voice_id = NULL, voice_created_at = NULL WHERE code = ?").bind(code).run();
}

/** Spends one Round of the Allowance atomically; false when the Allowance is used up. */
export async function spendRound(db: D1Database, code: string, now: Date): Promise<boolean> {
  const res = await db
    .prepare("UPDATE codes SET used = used + 1, last_used_at = ? WHERE code = ? AND used < allowance")
    .bind(now.toISOString(), code)
    .run();
  return res.meta.changes === 1;
}

/** Gives a Round back after an upstream failure, so the Guest never loses one to our error. */
export async function refundRound(db: D1Database, code: string): Promise<void> {
  await db.prepare("UPDATE codes SET used = used - 1 WHERE code = ? AND used > 0").bind(code).run();
}

/**
 * Codes whose Voice clone the hourly cleanup deletes: never owner codes; either the Allowance
 * is used up and the last Round started at least an hour ago, or the clone is 7 days old.
 */
export async function listVoicesToClean(db: D1Database, now: Date): Promise<{ code: string; voice_id: string }[]> {
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const res = await db
    .prepare(
      `SELECT code, voice_id FROM codes
       WHERE kind != 'owner' AND voice_id IS NOT NULL
         AND ((used >= allowance AND last_used_at <= ?) OR voice_created_at <= ?)
       ORDER BY code`,
    )
    .bind(hourAgo, weekAgo)
    .all<{ code: string; voice_id: string }>();
  return res.results;
}

// Rounds

export async function insertRound(db: D1Database, args: { id: string; code: string; question_id: string }): Promise<void> {
  await db
    .prepare("INSERT INTO rounds (id, code, question_id) VALUES (?, ?, ?)")
    .bind(args.id, args.code, args.question_id)
    .run();
}

/** A Round, only if it belongs to this code: one Guest can never read another Guest's Round. */
export async function getRound(db: D1Database, id: string, code: string): Promise<RoundRow | null> {
  return db.prepare("SELECT * FROM rounds WHERE id = ? AND code = ?").bind(id, code).first<RoundRow>();
}

export async function setConversationId(db: D1Database, id: string, conversationId: string): Promise<void> {
  await db.prepare("UPDATE rounds SET conversation_id = ? WHERE id = ?").bind(conversationId, id).run();
}

/**
 * Records the Replay. Only a Round still `started` can finish, so two concurrent Replay
 * requests cannot both write; false means another request finished (or failed) it first.
 */
export async function finishRound(
  db: D1Database,
  id: string,
  args: {
    status: "replayed" | "fallback";
    final_answer: string;
    best_self_text: string;
    rewrite_attempts: number;
    guard_failures: GuardFailure[];
  },
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE rounds SET status = ?, final_answer = ?, best_self_text = ?, rewrite_attempts = ?, guard_failures = ?
       WHERE id = ? AND status = 'started'`,
    )
    .bind(args.status, args.final_answer, args.best_self_text, args.rewrite_attempts, JSON.stringify(args.guard_failures), id)
    .run();
  return res.meta.changes === 1;
}

/** Marks a started Round failed; false if it had already finished. */
export async function failRound(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("UPDATE rounds SET status = 'failed' WHERE id = ? AND status = 'started'").bind(id).run();
  return res.meta.changes === 1;
}

// Code requests (landing page form, approved from the Telegram admin bot)

export type RequestStatus = "pending" | "approved" | "dismissed";

export type CodeRequestRow = {
  id: number;
  platform: SocialPlatform;
  handle: string;
  job_url: string | null;
  lang: Lang;
  status: RequestStatus;
  code: string | null;
  ip_hash: string | null;
  created_at: string;
};

export async function insertCodeRequest(
  db: D1Database,
  args: { platform: SocialPlatform; handle: string; job_url: string | null; lang: Lang; ip_hash: string | null; now: Date },
): Promise<number> {
  const row = await db
    .prepare("INSERT INTO code_requests (platform, handle, job_url, lang, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(args.platform, args.handle, args.job_url, args.lang, args.ip_hash, args.now.toISOString())
    .first<{ id: number }>();
  return row!.id;
}

/** How many requests this IP hash made since `since`, for the form's rate limit. */
export async function countRequestsSince(db: D1Database, ipHash: string, since: Date): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM code_requests WHERE ip_hash = ? AND created_at >= ?")
    .bind(ipHash, since.toISOString())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A pending request for this handle, so a double submit does not ping Mel twice. */
export async function findPendingRequest(db: D1Database, platform: SocialPlatform, handle: string): Promise<CodeRequestRow | null> {
  return db
    .prepare("SELECT * FROM code_requests WHERE status = 'pending' AND platform = ? AND lower(handle) = lower(?) LIMIT 1")
    .bind(platform, handle)
    .first<CodeRequestRow>();
}

export async function getCodeRequest(db: D1Database, id: number): Promise<CodeRequestRow | null> {
  return db.prepare("SELECT * FROM code_requests WHERE id = ?").bind(id).first<CodeRequestRow>();
}

export async function listPendingRequests(db: D1Database, limit: number): Promise<CodeRequestRow[]> {
  const res = await db
    .prepare("SELECT * FROM code_requests WHERE status = 'pending' ORDER BY id LIMIT ?")
    .bind(limit)
    .all<CodeRequestRow>();
  return res.results;
}

/** Closes a pending request; false if it was already approved or dismissed. */
export async function closeRequest(db: D1Database, id: number, status: "approved" | "dismissed", code: string | null): Promise<boolean> {
  const res = await db
    .prepare("UPDATE code_requests SET status = ?, code = ? WHERE id = ? AND status = 'pending'")
    .bind(status, code, id)
    .run();
  return res.meta.changes === 1;
}

export type Stats = {
  codes: { kind: string; n: number; used: number; allowance: number }[];
  rounds: { status: string; n: number }[];
  pendingRequests: number;
};

export async function readStats(db: D1Database): Promise<Stats> {
  const [codes, rounds, pending] = await Promise.all([
    db.prepare("SELECT kind, COUNT(*) AS n, SUM(used) AS used, SUM(allowance) AS allowance FROM codes GROUP BY kind ORDER BY kind").all<Stats["codes"][number]>(),
    db.prepare("SELECT status, COUNT(*) AS n FROM rounds GROUP BY status ORDER BY status").all<Stats["rounds"][number]>(),
    db.prepare("SELECT COUNT(*) AS n FROM code_requests WHERE status = 'pending'").first<{ n: number }>(),
  ]);
  return { codes: codes.results, rounds: rounds.results, pendingRequests: pending?.n ?? 0 };
}
