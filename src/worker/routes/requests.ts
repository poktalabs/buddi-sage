// The landing page's "Request a code" form. A request is stored and pinged to Mel on Telegram;
// Mel approves it with /approve in the admin bot. Spam controls, all cheap: a honeypot field
// (a filled one gets a fake success and is not stored), 3 requests per IP per hour (the IP is
// kept only as an HMAC under SESSION_SECRET), and a repeat from a Contact that already has a
// pending request answers ok without a second row or ping.
import type { CodeRequestBody, CodeRequestResponse, Lang } from "../../shared/api";
import type { Env } from "../env";
import { countRequestsSince, findPendingRequest, insertCodeRequest } from "../db";
import { error, json, readJsonObject } from "../http";
import { sign } from "../session";
import { notifyOwner } from "../telegram";
import { normaliseContact } from "./access";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const MAX_GOAL_LENGTH = 280;
export const REQUESTS_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

const ok = () => json({ ok: true } satisfies CodeRequestResponse);

export function requestPing(id: number, contact: string, goal: string | null, lang: Lang): string {
  return [
    `New code request #${id}`,
    `Contact: ${contact}`,
    goal ? `For: ${goal}` : "For: (not given)",
    `Language: ${lang}`,
    "",
    `/approve_${id}   /dismiss_${id}`,
  ].join("\n");
}

export async function createCodeRequest(req: Request, env: Env, fetchImpl?: FetchLike, now = new Date()): Promise<Response> {
  const body = (await readJsonObject(req)) as Partial<Record<keyof CodeRequestBody, unknown>> | null;
  if (!body || typeof body.contact !== "string") return error("bad_request", 400);
  if (typeof body.website === "string" && body.website.trim()) return ok(); // honeypot

  const contact = normaliseContact(body.contact);
  if (!contact) return error("bad_request", 400);
  if (body.goal !== undefined && typeof body.goal !== "string") return error("bad_request", 400);
  const goal = typeof body.goal === "string" && body.goal.trim() ? body.goal.trim().replace(/\s+/g, " ") : null;
  if (goal && goal.length > MAX_GOAL_LENGTH) return error("bad_request", 400);
  const lang: Lang = body.lang === "es" ? "es" : "en";

  const ip = req.headers.get("cf-connecting-ip");
  const ipHash = ip ? await sign(`ip:${ip}`, env.SESSION_SECRET) : null;
  if (ipHash && (await countRequestsSince(env.DB, ipHash, new Date(now.getTime() - HOUR_MS))) >= REQUESTS_PER_HOUR) {
    return error("rate_limited", 429);
  }
  if (await findPendingRequest(env.DB, contact)) return ok();

  const id = await insertCodeRequest(env.DB, { contact, goal, lang, ip_hash: ipHash, now });
  await notifyOwner(env, requestPing(id, contact, goal, lang), fetchImpl);
  return ok();
}
