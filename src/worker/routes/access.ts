// Access is by code, not account (CONTEXT.md: Guest). Redeeming a code asks for a Contact the
// first time, because the Contact is how Mel asks a Guest for feedback, then starts a Session
// with a signed cookie. A Contact already on the code is never overwritten, so a later
// redeemer of the same code cannot replace the first Guest's Contact.
import type { Me, RedeemRequest } from "../../shared/api";
import type { Env, Session } from "../env";
import { getCode, normaliseCode, setContact, type CodeRow } from "../db";
import { error, json, readJsonObject } from "../http";
import { sessionCookie } from "../session";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const X_HANDLE = /^@[A-Za-z0-9_]{1,15}$/;
const MAX_CONTACT_LENGTH = 254;

/** A trimmed Contact if it looks like an email or an X handle (`@name`), else null. Loose on purpose. */
export function normaliseContact(input: string): string | null {
  const c = input.trim();
  if (!c || c.length > MAX_CONTACT_LENGTH) return null;
  return EMAIL.test(c) || X_HANDLE.test(c) ? c : null;
}

export function toMe(row: CodeRow): Me {
  return {
    kind: row.kind,
    allowance: row.allowance,
    used: row.used,
    hasContact: row.contact !== null,
    hasVoice: row.voice_id !== null,
  };
}

export async function redeem(req: Request, env: Env): Promise<Response> {
  const body = (await readJsonObject(req)) as Partial<Record<keyof RedeemRequest, unknown>> | null;
  if (!body || typeof body.code !== "string" || !body.code.trim()) return error("bad_request", 400);
  if (body.contact !== undefined && typeof body.contact !== "string") return error("bad_request", 400);

  const row = await getCode(env.DB, normaliseCode(body.code));
  if (!row) return error("invalid_code", 404);

  const given = typeof body.contact === "string" && body.contact.trim() ? body.contact : null;
  if (given !== null) {
    const contact = normaliseContact(given);
    if (!contact) return error("bad_request", 400);
    if (row.contact === null) {
      await setContact(env.DB, row.code, contact);
      row.contact = contact;
    }
  } else if (row.contact === null) {
    return error("contact_required", 400);
  }

  return json(toMe(row), 200, { "set-cookie": await sessionCookie(row.code, env.SESSION_SECRET) });
}

export async function me(_req: Request, env: Env, session: Session): Promise<Response> {
  const row = await getCode(env.DB, session.code);
  if (!row) return error("unauthorized", 401);
  return json(toMe(row));
}
