import { beforeEach, describe, expect, it } from "vitest";
import type { ApiError, Me } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { createCodes, getCode, setContact, setVoice, spendRound } from "../src/worker/db";
import { me, normaliseContact, redeem } from "../src/worker/routes/access";
import { readSession } from "../src/worker/session";
import { testEnv } from "./support/fakeD1";

let env: Env;
let code: string;
beforeEach(async () => {
  env = testEnv();
  [code] = (await createCodes(env.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
});

function post(body: unknown): Request {
  return new Request("https://sage.test/api/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as ApiError).error;
}

describe("normaliseContact", () => {
  it("accepts an email or an X handle, trimmed", () => {
    expect(normaliseContact("  mel@example.com ")).toBe("mel@example.com");
    expect(normaliseContact("@troop_degen")).toBe("@troop_degen");
  });

  it("rejects anything else", () => {
    for (const bad of ["", "   ", "mel", "mel@", "@", "@has space", "@this_handle_is_too_long", "a b@c.d", `${"a".repeat(250)}@x.io`]) {
      expect(normaliseContact(bad)).toBeNull();
    }
  });
});

describe("redeem", () => {
  it("400 bad_request on malformed JSON, a missing or blank code, or a non-string Contact", async () => {
    for (const body of ["{not json", {}, { code: "  " }, { code: 42 }, [code], { code, contact: 7 }]) {
      const res = await redeem(post(body), env);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("bad_request");
    }
  });

  it("404 invalid_code for an unknown code", async () => {
    const res = await redeem(post({ code: "SAGE-NOPE-NOPE", contact: "@mel" }), env);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("invalid_code");
  });

  it("400 contact_required when neither the code nor the request has a Contact", async () => {
    for (const body of [{ code }, { code, contact: "  " }]) {
      const res = await redeem(post(body), env);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("contact_required");
    }
    expect(setCookieOf(await redeem(post({ code }), env))).toBeNull();
  });

  it("400 bad_request for a Contact that is neither an email nor an X handle", async () => {
    const res = await redeem(post({ code, contact: "not a contact" }), env);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("bad_request");
    expect((await getCode(env.DB, code))!.contact).toBeNull();
  });

  it("stores the Contact, sets a valid session cookie and returns Me", async () => {
    const res = await redeem(post({ code: ` ${code.toLowerCase()} `, contact: " mel@example.com " }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Me;
    expect(body).toEqual({ kind: "guest", allowance: 3, used: 0, hasContact: true, hasVoice: false });
    expect((await getCode(env.DB, code))!.contact).toBe("mel@example.com");

    const cookie = setCookieOf(res)!;
    expect(cookie).toContain("HttpOnly");
    const back = new Request("https://sage.test/api/me", { headers: { cookie: cookie.split(";")[0]! } });
    expect(await readSession(back, env)).toEqual({ code });
  });

  it("does not ask again once the code has a Contact, and never overwrites it", async () => {
    await setContact(env.DB, code, "@first");
    expect((await redeem(post({ code }), env)).status).toBe(200);
    expect((await redeem(post({ code, contact: "@second" }), env)).status).toBe(200);
    expect((await getCode(env.DB, code))!.contact).toBe("@first");
  });

  it("reports the spent Allowance and the Voice clone in Me", async () => {
    await setContact(env.DB, code, "@mel");
    await spendRound(env.DB, code, new Date());
    await setVoice(env.DB, code, "voice-1", new Date());
    const body = (await (await redeem(post({ code }), env)).json()) as Me;
    expect(body).toMatchObject({ used: 1, hasVoice: true, hasContact: true });
  });
});

function setCookieOf(res: Response): string | null {
  return res.headers.get("set-cookie");
}

describe("me", () => {
  const req = new Request("https://sage.test/api/me");

  it("returns Me for the session's code", async () => {
    await setContact(env.DB, code, "@mel");
    const res = await me(req, env, { code });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "guest", allowance: 3, used: 0, hasContact: true, hasVoice: false });
  });

  it("401 unauthorized when the signed code no longer exists", async () => {
    const res = await me(req, env, { code: "SAGE-GONE-GONE" });
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("unauthorized");
  });
});
