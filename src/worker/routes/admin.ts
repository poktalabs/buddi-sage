// Mel issues codes by hand: with ADMIN_SECRET on /admin/codes, or from the Telegram admin bot
// (routes/telegram.ts), and both go through issueCodes so the limits are the same. Defaults
// follow the Allowance decisions: a Guest code gets 3 Rounds, an owner code 100, and a Gift
// code has no default because its Allowance is chosen for one specific person.
import type { AdminCreateCodesRequest, AdminCreateCodesResponse, CodeKind } from "../../shared/api";
import type { Env } from "../env";
import { createCodes as insertCodes, setContact } from "../db";
import { error, json, readJsonObject } from "../http";
import { requireBearer } from "../session";

export const DEFAULT_ALLOWANCE: Record<CodeKind, number | null> = { guest: 3, owner: 100, gift: null };
export const MAX_COUNT = 50;
export const MAX_ALLOWANCE = 1000;
const MAX_NOTE_LENGTH = 500;

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Validates and inserts codes; null when the arguments break a limit. `contact`, when given,
 * is stored on every new code so its Guest is not asked for one again (approved requests).
 */
export async function issueCodes(
  env: Env,
  args: { kind: unknown; count?: unknown; allowance?: unknown; note?: unknown; contact?: string },
): Promise<string[] | null> {
  const kind = args.kind;
  if (kind !== "guest" && kind !== "gift" && kind !== "owner") return null;
  const count = args.count ?? 1;
  if (!isIntIn(count, 1, MAX_COUNT)) return null;
  const allowance = args.allowance ?? DEFAULT_ALLOWANCE[kind];
  if (!isIntIn(allowance, 1, MAX_ALLOWANCE)) return null;
  const note = args.note;
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) return null;

  const codes = await insertCodes(env.DB, { kind, count, allowance, note: (note as string | undefined) ?? null });
  if (args.contact) for (const c of codes) await setContact(env.DB, c, args.contact);
  return codes;
}

export async function createCodes(req: Request, env: Env): Promise<Response> {
  if (!requireBearer(req, env.ADMIN_SECRET)) return error("unauthorized", 401);
  const body = (await readJsonObject(req)) as Partial<Record<keyof AdminCreateCodesRequest, unknown>> | null;
  if (!body) return error("bad_request", 400);
  const codes = await issueCodes(env, { kind: body.kind, count: body.count, allowance: body.allowance, note: body.note });
  if (!codes) return error("bad_request", 400);
  const res: AdminCreateCodesResponse = { codes };
  return json(res);
}
