import { describe, expect, it } from "vitest";
import { readSession, requireBearer, sessionCookie, sign, verify } from "../src/worker/session";

const SECRET = "test-session-secret";
const env = { SESSION_SECRET: SECRET };

function withCookie(cookie: string | null): Request {
  return new Request("https://sage.test/api/me", cookie === null ? {} : { headers: { cookie } });
}

/** The name=value part of a Set-Cookie header, as a browser would send it back. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!;
}

describe("sign and verify", () => {
  it("round trips", async () => {
    const sig = await sign("SAGE-ABCD-EFGH", SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await verify("SAGE-ABCD-EFGH", sig, SECRET)).toBe(true);
  });

  it("rejects a signature for another code, another secret or an empty secret", async () => {
    const sig = await sign("SAGE-ABCD-EFGH", SECRET);
    expect(await verify("SAGE-ABCD-EFGJ", sig, SECRET)).toBe(false);
    expect(await verify("SAGE-ABCD-EFGH", sig, "other-secret")).toBe(false);
    expect(await verify("SAGE-ABCD-EFGH", sig, "")).toBe(false);
  });

  it("refuses to sign with an empty secret, so a missing SESSION_SECRET fails closed", async () => {
    await expect(sign("SAGE-ABCD-EFGH", "")).rejects.toThrow(/not set/);
  });
});

describe("sessionCookie", () => {
  it("sets the hardened attributes", async () => {
    const c = await sessionCookie("SAGE-ABCD-EFGH", SECRET);
    expect(c.startsWith("sage_session=SAGE-ABCD-EFGH.")).toBe(true);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) expect(c).toContain(attr);
  });
});

describe("readSession", () => {
  it("round trips a cookie from sessionCookie", async () => {
    const c = cookiePair(await sessionCookie("SAGE-ABCD-EFGH", SECRET));
    expect(await readSession(withCookie(c), env)).toEqual({ code: "SAGE-ABCD-EFGH" });
  });

  it("finds the cookie among other cookies", async () => {
    const c = cookiePair(await sessionCookie("SAGE-ABCD-EFGH", SECRET));
    expect(await readSession(withCookie(`theme=dark; ${c}; other=1`), env)).toEqual({ code: "SAGE-ABCD-EFGH" });
  });

  it("rejects a tampered code", async () => {
    const c = cookiePair(await sessionCookie("SAGE-ABCD-EFGH", SECRET)).replace("EFGH", "EFGJ");
    expect(await readSession(withCookie(c), env)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const c = cookiePair(await sessionCookie("SAGE-ABCD-EFGH", SECRET));
    const last = c.at(-1) === "A" ? "B" : "A";
    expect(await readSession(withCookie(c.slice(0, -1) + last), env)).toBeNull();
  });

  it("rejects a cookie signed with another secret", async () => {
    const c = cookiePair(await sessionCookie("SAGE-ABCD-EFGH", "other-secret"));
    expect(await readSession(withCookie(c), env)).toBeNull();
  });

  it("returns null with no cookie, no session cookie, or a malformed value", async () => {
    expect(await readSession(withCookie(null), env)).toBeNull();
    expect(await readSession(withCookie("theme=dark"), env)).toBeNull();
    expect(await readSession(withCookie("sage_session=SAGE-ABCD-EFGH"), env)).toBeNull();
    expect(await readSession(withCookie("sage_session=.abc"), env)).toBeNull();
    expect(await readSession(withCookie("sage_session=SAGE-ABCD-EFGH."), env)).toBeNull();
  });
});

describe("requireBearer", () => {
  const req = (auth?: string) => new Request("https://sage.test/admin/codes", auth ? { headers: { authorization: auth } } : {});

  it("accepts the exact secret", () => {
    expect(requireBearer(req("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a wrong, missing, prefixed or differently cased scheme", () => {
    expect(requireBearer(req("Bearer s3cres"), "s3cret")).toBe(false);
    expect(requireBearer(req("Bearer s3cret-extra"), "s3cret")).toBe(false);
    expect(requireBearer(req(), "s3cret")).toBe(false);
    expect(requireBearer(req("s3cret"), "s3cret")).toBe(false);
    expect(requireBearer(req("Basic s3cret"), "s3cret")).toBe(false);
  });

  it("never accepts anything when the secret is unset", () => {
    expect(requireBearer(req("Bearer "), "")).toBe(false);
    expect(requireBearer(req("Bearer x"), "")).toBe(false);
  });
});
