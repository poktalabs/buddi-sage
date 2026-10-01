// The landing page's "Request a code" form. The requester names the Instagram, X or TikTok
// account they will DM Mel from, plus an optional job link; the request is stored and pinged to
// Mel on Telegram with a profile link, so Mel can match the DM and /approve it in the admin bot.
// Spam controls, all cheap: a honeypot field (a filled one gets a fake success and is not
// stored), 3 requests per IP per hour (the IP is kept only as an HMAC under SESSION_SECRET), and
// a repeat for a handle that already has a pending request answers ok without a second ping.
import type { CodeRequestBody, CodeRequestResponse, Lang, SocialPlatform } from "../../shared/api";
import type { Env } from "../env";
import { countRequestsSince, findPendingRequest, insertCodeRequest } from "../db";
import { error, json, readJsonObject } from "../http";
import { sign } from "../session";
import { handleLabel, isPlatform, normaliseHandle, normaliseJobUrl, profileUrl } from "../social";
import { notifyOwner } from "../telegram";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const REQUESTS_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

const ok = () => json({ ok: true } satisfies CodeRequestResponse);

export function requestPing(id: number, platform: SocialPlatform, handle: string, jobUrl: string | null, lang: Lang): string {
  return [
    `New code request #${id}`,
    `From: ${handleLabel(platform, handle)}`,
    profileUrl(platform, handle),
    `Job: ${jobUrl ?? "(not given)"}`,
    `Language: ${lang}`,
    "",
    "Wait for their DM, then:",
    `/approve_${id}   /dismiss_${id}`,
  ].join("\n");
}

export async function createCodeRequest(req: Request, env: Env, fetchImpl?: FetchLike, now = new Date()): Promise<Response> {
  const body = (await readJsonObject(req)) as Partial<Record<keyof CodeRequestBody, unknown>> | null;
  if (!body || !isPlatform(body.platform) || typeof body.handle !== "string") return error("bad_request", 400);
  if (typeof body.website === "string" && body.website.trim()) return ok(); // honeypot

  const platform = body.platform;
  const handle = normaliseHandle(platform, body.handle);
  if (!handle) return error("bad_request", 400);
  if (body.job_url !== undefined && typeof body.job_url !== "string") return error("bad_request", 400);
  let jobUrl: string | null = null;
  if (typeof body.job_url === "string" && body.job_url.trim()) {
    jobUrl = normaliseJobUrl(body.job_url);
    if (!jobUrl) return error("bad_request", 400);
  }
  const lang: Lang = body.lang === "es" ? "es" : "en";

  const ip = req.headers.get("cf-connecting-ip");
  const ipHash = ip ? await sign(`ip:${ip}`, env.SESSION_SECRET) : null;
  if (ipHash && (await countRequestsSince(env.DB, ipHash, new Date(now.getTime() - HOUR_MS))) >= REQUESTS_PER_HOUR) {
    return error("rate_limited", 429);
  }
  if (await findPendingRequest(env.DB, platform, handle)) return ok();

  const id = await insertCodeRequest(env.DB, { platform, handle, job_url: jobUrl, lang, ip_hash: ipHash, now });
  await notifyOwner(env, requestPing(id, platform, handle, jobUrl, lang), fetchImpl);
  return ok();
}
