// Mel issues codes by hand: with ADMIN_SECRET on /admin/codes, from the Telegram admin bot
// (routes/telegram.ts), or from the owner dashboard (below), and all go through issueCodes so
// the limits are the same. Defaults
// follow the Allowance decisions: a Guest code gets 3 Rounds, an owner code 100, and a Gift
// code has no default because its Allowance is chosen for one specific person.
import type {
  AdminCreateCodesRequest,
  AdminCreateCodesResponse,
  CodeKind,
  DashboardCreateCodesRequest,
  DashboardResponse,
} from "../../shared/api";
import type { Env, Session } from "../env";
import { createCodes as insertCodes, getCode, listCodes, readStats, setContact, setJobSource } from "../db";
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
 * `job`, when given, is the job the request named: it prefills the Guest's job screen.
 */
export async function issueCodes(
  env: Env,
  args: { kind: unknown; count?: unknown; allowance?: unknown; note?: unknown; contact?: string; job?: string | null },
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
  if (args.job) for (const c of codes) await setJobSource(env.DB, c, args.job);
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

// The owner dashboard: the same data and limits, behind an owner code's Session instead of
// ADMIN_SECRET, so Mel can manage codes from the app. A Guest or Gift Session gets 403.
const MAX_DASHBOARD_CODES = 1000;

async function isOwner(env: Env, session: Session): Promise<boolean> {
  return (await getCode(env.DB, session.code))?.kind === "owner";
}

export async function dashboard(_req: Request, env: Env, session: Session): Promise<Response> {
  if (!(await isOwner(env, session))) return error("forbidden", 403);
  const [rows, stats] = await Promise.all([listCodes(env.DB, MAX_DASHBOARD_CODES), readStats(env.DB)]);
  const res: DashboardResponse = {
    codes: rows.map((r) => ({
      code: r.code,
      kind: r.kind,
      allowance: r.allowance,
      used: r.used,
      contact: r.contact,
      hasVoice: r.has_voice === 1,
      note: r.note,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
    rounds: stats.rounds,
    pendingRequests: stats.pendingRequests,
  };
  return json(res);
}

export async function dashboardCreateCodes(req: Request, env: Env, session: Session): Promise<Response> {
  if (!(await isOwner(env, session))) return error("forbidden", 403);
  const body = (await readJsonObject(req)) as Partial<Record<keyof DashboardCreateCodesRequest, unknown>> | null;
  if (!body || (body.kind !== "guest" && body.kind !== "gift")) return error("bad_request", 400);
  const note = typeof body.note === "string" ? body.note.trim() || undefined : body.note;
  const codes = await issueCodes(env, { kind: body.kind, count: body.count, allowance: body.allowance, note });
  if (!codes) return error("bad_request", 400);
  const res: AdminCreateCodesResponse = { codes };
  return json(res);
}
