// Mel issues codes by hand with ADMIN_SECRET; there is no admin UI in Tier A. Defaults follow
// the Allowance decisions: a Guest code gets 3 Rounds, an owner code 100, and a Gift code has
// no default because its Allowance is chosen for one specific person.
import type { AdminCreateCodesRequest, AdminCreateCodesResponse, CodeKind } from "../../shared/api";
import type { Env } from "../env";
import { createCodes as insertCodes } from "../db";
import { error, json, readJsonObject } from "../http";
import { requireBearer } from "../session";

const DEFAULT_ALLOWANCE: Record<CodeKind, number | null> = { guest: 3, owner: 100, gift: null };
const MAX_COUNT = 50;
const MAX_ALLOWANCE = 1000;
const MAX_NOTE_LENGTH = 500;

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export async function createCodes(req: Request, env: Env): Promise<Response> {
  if (!requireBearer(req, env.ADMIN_SECRET)) return error("unauthorized", 401);
  const body = (await readJsonObject(req)) as Partial<Record<keyof AdminCreateCodesRequest, unknown>> | null;
  if (!body) return error("bad_request", 400);

  const kind = body.kind;
  if (kind !== "guest" && kind !== "gift" && kind !== "owner") return error("bad_request", 400);

  const count = body.count ?? 1;
  if (!isIntIn(count, 1, MAX_COUNT)) return error("bad_request", 400);

  const allowance = body.allowance ?? DEFAULT_ALLOWANCE[kind];
  if (!isIntIn(allowance, 1, MAX_ALLOWANCE)) return error("bad_request", 400);

  const note = body.note;
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) return error("bad_request", 400);

  const codes = await insertCodes(env.DB, { kind, count, allowance, note: note ?? null });
  const res: AdminCreateCodesResponse = { codes };
  return json(res);
}
