// The coach LLM pass-through for Sage's Custom LLM (spec task 4). ElevenLabs calls it with
// the LLM_PROXY_SECRET as a bearer (a workspace secret on the agent); the router does no auth
// for /llm/*, so the check is here and it is constant-time (requireBearer). The handler only
// authenticates, parses and forwards: nebius.forwardChatCompletions injects the one field
// ElevenLabs cannot send and the Response goes back untouched (status, headers, SSE body).
// No prompt logic and no SSE parsing, because Workers Free allows 10 ms CPU per request. The
// messages are the Guest's words, so nothing from the body is ever logged.
import type { Env } from "../env";
import type { FetchImpl } from "../eleven";
import { forwardChatCompletions } from "../nebius";
import { error } from "../http";
import { requireBearer } from "../session";

/**
 * POST /llm/v1/chat/completions and POST /llm/chat/completions. `fetchImpl` is only for
 * tests (the router passes two arguments, so the global fetch is used in the Worker).
 */
export async function chatCompletions(req: Request, env: Env, fetchImpl: FetchImpl = fetch): Promise<Response> {
  if (!requireBearer(req, env.LLM_PROXY_SECRET)) return error("unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("bad_request", 400);
  }

  try {
    return await forwardChatCompletions(env, body, fetchImpl);
  } catch (err) {
    // forwardChatCompletions throws TypeError only for a non-object body; fetch itself
    // rejects with a TypeError too, but only after the body check, so check the shape here.
    if (typeof body !== "object" || body === null || Array.isArray(body)) return error("bad_request", 400);
    console.error("nebius pass-through failed", err instanceof Error ? err.name : typeof err);
    return error("upstream_error", 502);
  }
}
