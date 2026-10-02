// JSON helpers for every Worker response. The contract (src/shared/api.ts) says error bodies
// are always ApiError with a fixed error string, so every handler builds errors through here.
import type { ApiError } from "../shared/api";

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "invalid_code"
  | "contact_required"
  | "voice_required"
  | "voice_exists"
  | "voice_verification_required"
  | "allowance_used"
  | "unknown_question"
  | "round_not_found"
  | "round_already_replayed"
  | "conversation_failed"
  | "conversation_timeout"
  | "no_save_answer"
  | "empty_answer"
  | "upstream_error"
  | "rate_limited"
  | "job_fetch_failed"
  | "job_unreadable"
  | "job_limit";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function error(code: ErrorCode, status: number): Response {
  const body: ApiError = { error: code };
  return json(body, status);
}

/** Parses a JSON object body; null on malformed JSON or a non-object (the caller answers 400). */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
