import { beforeEach, describe, expect, it } from "vitest";
import type { AdminCreateCodesResponse, ApiError, DashboardResponse } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { createCodes as insertCodes, getCode, setContact, setVoice, spendRound } from "../src/worker/db";
import { createCodes, dashboard, dashboardCreateCodes } from "../src/worker/routes/admin";
import { testEnv } from "./support/fakeD1";

let env: Env;
beforeEach(() => {
  env = testEnv();
});

function post(body: unknown, auth: string | null = `Bearer ${"test-admin-secret"}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  return new Request("https://sage.test/admin/codes", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function created(res: Response): Promise<string[]> {
  expect(res.status).toBe(200);
  return ((await res.json()) as AdminCreateCodesResponse).codes;
}

describe("createCodes", () => {
  it("401 unauthorized without the bearer, with a wrong one, or when ADMIN_SECRET is unset", async () => {
    for (const res of [
      await createCodes(post({ kind: "guest" }, null), env),
      await createCodes(post({ kind: "guest" }, "Bearer wrong"), env),
      await createCodes(post({ kind: "guest" }, "Bearer "), testEnv({ ADMIN_SECRET: "" })),
    ]) {
      expect(res.status).toBe(401);
      expect(((await res.json()) as ApiError).error).toBe("unauthorized");
    }
  });

  it("creates one Guest code with an Allowance of 3 by default", async () => {
    const codes = await created(await createCodes(post({ kind: "guest" }), env));
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatch(/^SAGE-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(await getCode(env.DB, codes[0]!)).toMatchObject({ kind: "guest", allowance: 3, used: 0, note: null });
  });

  it("gives an owner code 100 Rounds by default", async () => {
    const [code] = await created(await createCodes(post({ kind: "owner" }), env));
    expect((await getCode(env.DB, code!))!.allowance).toBe(100);
  });

  it("requires an Allowance for a Gift code and stores the note", async () => {
    const res = await createCodes(post({ kind: "gift" }), env);
    expect(res.status).toBe(400);
    const [code] = await created(await createCodes(post({ kind: "gift", allowance: 5, note: "for Ana" }), env));
    expect(await getCode(env.DB, code!)).toMatchObject({ kind: "gift", allowance: 5, note: "for Ana" });
  });

  it("lets a Guest code override the default Allowance", async () => {
    const [code] = await created(await createCodes(post({ kind: "guest", allowance: 1 }), env));
    expect((await getCode(env.DB, code!))!.allowance).toBe(1);
  });

  it("creates up to 50 distinct codes", async () => {
    const codes = await created(await createCodes(post({ kind: "guest", count: 50 }), env));
    expect(new Set(codes).size).toBe(50);
  });

  it("400 bad_request on bad input", async () => {
    const bad = [
      "{not json",
      [],
      {},
      { kind: "admin" },
      { kind: "guest", count: 0 },
      { kind: "guest", count: 51 },
      { kind: "guest", count: 1.5 },
      { kind: "guest", count: "2" },
      { kind: "guest", allowance: 0 },
      { kind: "guest", allowance: -1 },
      { kind: "gift", allowance: 2.5 },
      { kind: "guest", note: 7 },
      { kind: "guest", note: "x".repeat(501) },
    ];
    for (const body of bad) {
      const res = await createCodes(post(body), env);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ApiError).error).toBe("bad_request");
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM codes").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("owner dashboard", () => {
  let owner: string;
  let guest: string;
  beforeEach(async () => {
    [owner] = (await insertCodes(env.DB, { kind: "owner", count: 1, allowance: 100 })) as [string];
    [guest] = (await insertCodes(env.DB, { kind: "guest", count: 1, allowance: 3, note: "friends" })) as [string];
  });

  const get = () => new Request("https://sage.test/api/dashboard");
  const issue = (body: unknown) =>
    new Request("https://sage.test/api/dashboard/codes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("403 forbidden for a Guest or Gift Session, on both routes", async () => {
    const [gift] = (await insertCodes(env.DB, { kind: "gift", count: 1, allowance: 10 })) as [string];
    for (const code of [guest, gift!]) {
      for (const res of [await dashboard(get(), env, { code }), await dashboardCreateCodes(issue({ kind: "guest" }), env, { code })]) {
        expect(res.status).toBe(403);
        expect(((await res.json()) as ApiError).error).toBe("forbidden");
      }
    }
  });

  it("lists every code with usage, Contact and whether a Voice clone exists, never the Voice id", async () => {
    await setContact(env.DB, guest, "@ana.dev");
    await setVoice(env.DB, guest, "voice_secret_id", new Date());
    await spendRound(env.DB, guest, new Date("2026-10-01T10:00:00.000Z"));
    const res = await dashboard(get(), env, { code: owner });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardResponse;
    expect(body.codes.map((c) => c.code).sort()).toEqual([owner, guest].sort());
    expect(body.codes.find((c) => c.code === guest)).toMatchObject({
      kind: "guest",
      allowance: 3,
      used: 1,
      contact: "@ana.dev",
      hasVoice: true,
      note: "friends",
      lastUsedAt: "2026-10-01T10:00:00.000Z",
    });
    expect(body.codes.find((c) => c.code === owner)).toMatchObject({ kind: "owner", hasVoice: false, contact: null });
    expect(JSON.stringify(body)).not.toContain("voice_secret_id");
    expect(body.pendingRequests).toBe(0);
  });

  it("issues Guest and Gift codes with the same defaults and limits as /admin/codes", async () => {
    const ok = async (body: unknown) => {
      const res = await dashboardCreateCodes(issue(body), env, { code: owner });
      expect(res.status).toBe(200);
      return ((await res.json()) as AdminCreateCodesResponse).codes;
    };
    const guests = await ok({ kind: "guest", count: 3, note: "  recruiter demo  " });
    expect(guests).toHaveLength(3);
    expect(await getCode(env.DB, guests[0]!)).toMatchObject({ kind: "guest", allowance: 3, note: "recruiter demo" });
    const [gift] = await ok({ kind: "gift", allowance: 10, note: "" });
    expect(await getCode(env.DB, gift!)).toMatchObject({ kind: "gift", allowance: 10, note: null });
  });

  it("400 for an owner code, a Gift without Rounds, or a count past the limit", async () => {
    for (const body of [{ kind: "owner" }, { kind: "gift" }, { kind: "guest", count: 51 }, { kind: "guest", note: 5 }]) {
      const res = await dashboardCreateCodes(issue(body), env, { code: owner });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
