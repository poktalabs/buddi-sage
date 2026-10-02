import { describe, expect, it } from "vitest";
import type { DashboardCode } from "../../src/shared/api";
import { formatTime, inviteLink, isRedeemed, matchesFilter, summarise } from "../../src/client/dashboard";

const code = (over: Partial<DashboardCode>): DashboardCode => ({
  code: "SAGE-AAAA-AAAA",
  kind: "guest",
  allowance: 3,
  used: 0,
  contact: null,
  hasVoice: false,
  note: null,
  createdAt: "2026-10-01 04:51:03",
  lastUsedAt: null,
  ...over,
});

describe("dashboard helpers", () => {
  it("counts a code as started on a Round or a Voice clone, not on a Contact alone", () => {
    expect(isRedeemed(code({}))).toBe(false);
    expect(isRedeemed(code({ contact: "@ana" }))).toBe(false); // approved request, not yet used
    expect(isRedeemed(code({ hasVoice: true }))).toBe(true);
    expect(isRedeemed(code({ used: 1, lastUsedAt: "2026-10-01T10:00:00.000Z" }))).toBe(true);
  });

  it("filters by not started, in use and used up", () => {
    const fresh = code({});
    const active = code({ used: 1, hasVoice: true });
    const done = code({ used: 3 });
    expect([fresh, active, done].map((c) => matchesFilter(c, "unused"))).toEqual([true, false, false]);
    expect([fresh, active, done].map((c) => matchesFilter(c, "in-use"))).toEqual([false, true, false]);
    expect([fresh, active, done].map((c) => matchesFilter(c, "used-up"))).toEqual([false, false, true]);
    expect([fresh, active, done].every((c) => matchesFilter(c, "all"))).toBe(true);
  });

  it("summarises codes given out, leaving owner codes aside", () => {
    const s = summarise([code({}), code({ kind: "gift", allowance: 10, used: 2 }), code({ kind: "owner", allowance: 100, used: 4 })]);
    expect(s).toEqual({ codes: 2, unused: 1, roundsUsed: 2, roundsIssued: 13 });
  });

  it("formats both stored time shapes the same way", () => {
    expect(formatTime("2026-10-01 04:51:03")).toBe("2026-10-01 04:51 UTC");
    expect(formatTime("2026-10-01T04:51:03.120Z")).toBe("2026-10-01 04:51 UTC");
    expect(formatTime(null)).toBe("");
  });

  it("builds the one-tap invite link", () => {
    expect(inviteLink("https://sage.agentcamp.xyz", "SAGE-AB23-CD45")).toBe("https://sage.agentcamp.xyz/?code=SAGE-AB23-CD45");
  });
});
