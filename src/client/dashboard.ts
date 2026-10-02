// Pure helpers for the owner dashboard screen (main.ts showDashboard): the summary line, the
// filter, times and invite links. Kept out of main.ts so they are testable without a DOM.
import type { DashboardCode } from "../shared/api";

export type CodeFilter = "all" | "unused" | "in-use" | "used-up";

export const FILTERS: { value: CodeFilter; label: string }[] = [
  { value: "all", label: "All codes" },
  { value: "unused", label: "Not started" },
  { value: "in-use", label: "In use" },
  { value: "used-up", label: "Used up" },
];

/**
 * Started means a Voice clone or a Round on the code. A Contact is no sign: an approved
 * request's code carries one before anyone redeems it.
 */
export function isRedeemed(c: DashboardCode): boolean {
  return c.used > 0 || c.hasVoice || c.lastUsedAt !== null;
}

export function matchesFilter(c: DashboardCode, filter: CodeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unused") return !isRedeemed(c);
  if (filter === "used-up") return c.used >= c.allowance;
  return isRedeemed(c) && c.used < c.allowance;
}

export type Summary = { codes: number; unused: number; roundsUsed: number; roundsIssued: number };

/** Owner codes are left out: they are Mel's own, not codes given out. */
export function summarise(codes: DashboardCode[]): Summary {
  const given = codes.filter((c) => c.kind !== "owner");
  return {
    codes: given.length,
    unused: given.filter((c) => !isRedeemed(c)).length,
    roundsUsed: given.reduce((n, c) => n + c.used, 0),
    roundsIssued: given.reduce((n, c) => n + c.allowance, 0),
  };
}

/** D1 stores `2026-10-01 04:51:03` (SQLite default) or ISO 8601; both read as `2026-10-01 04:51 UTC`. */
export function formatTime(t: string | null): string {
  if (!t) return "";
  return `${t.replace("T", " ").slice(0, 16)} UTC`;
}

/** Same as the Telegram bot's codeLink: opens the landing page with the code filled in. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/?code=${encodeURIComponent(code)}`;
}
