// The Guest's session is a signed cookie holding their code, not a server-side session row:
// a code is the Guest's identity (CONTEXT.md), and an HMAC with SESSION_SECRET is enough to
// stop a Guest from forging another code. /llm and /admin use their own bearer secrets
// instead. Every comparison of a secret-derived value is constant-time.
import type { Env, Session } from "./env";

export type { Session };

export const COOKIE_NAME = "sage_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time for equal lengths; a length mismatch returns false without early exit on content. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** base64url HMAC-SHA256 of the code under the secret. Throws on an empty secret: fail closed. */
export async function sign(code: string, secret: string): Promise<string> {
  if (!secret) throw new Error("session secret is not set");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(code)));
}

export async function verify(code: string, signature: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  return timingSafeEqual(await sign(code, secret), signature);
}

/** The Set-Cookie header value that starts a Session for this code. */
export async function sessionCookie(code: string, secret: string): Promise<string> {
  const value = `${code}.${await sign(code, secret)}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The Session from a valid signed cookie, or null (missing, malformed, tampered, wrong secret). */
export async function readSession(req: Request, env: Pick<Env, "SESSION_SECRET">): Promise<Session | null> {
  const value = cookieValue(req, COOKIE_NAME);
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const code = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  return (await verify(code, signature, env.SESSION_SECRET)) ? { code } : null;
}

/** True only for `Authorization: Bearer <secret>` with a non-empty secret. */
export function requireBearer(req: Request, secret: string): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(match[1]!, secret);
}
