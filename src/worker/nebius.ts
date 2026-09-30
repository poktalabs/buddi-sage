// Nebius Token Factory from the Worker. Two jobs only. chatText is the non-streaming call the
// Replay's rewrite uses. forwardChatCompletions is the Custom LLM pass-through: ElevenLabs
// cannot send reasoning_effort "none" itself (it nests extras under elevenlabs_extra_body,
// which Nebius ignores), and with reasoning on the coach's first spoken token is 1.5 to 2.5 s
// late. So the proxy injects that one field, pins the coach model, and returns Nebius's
// Response untouched. No prompt logic and no SSE parsing here: parsing per chunk spends the
// Workers Free 10 ms CPU budget.
import type { Env } from "./env";
import { type FetchImpl, UpstreamError, upstreamError } from "./eleven";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatTextArgs = { model: string; messages: ChatMessage[]; temperature?: number; max_tokens?: number };

function completionsUrl(env: Env): string {
  return `${env.NEBIUS_API_BASE.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Removes reasoning the model leaked into content. Defensive: Nebius normally puts it in
 * reasoning_content, but a `<think>` block in content must never reach the Guest's Replay.
 * An unclosed `<think>` (cut off by max_tokens) drops everything after it; a stray `</think>`
 * with no opener drops everything before it.
 */
export function stripThinking(content: string): string {
  let out = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = out.search(/<\/think>/i);
  if (close >= 0) out = out.slice(close + "</think>".length);
  const open = out.search(/<think>/i);
  if (open >= 0) out = out.slice(0, open);
  return out.trim();
}

/**
 * One non-streaming completion, returning the assistant text with thinking removed.
 * Throws UpstreamError on non-2xx and on an empty answer: an empty rewrite would pass the
 * guard rules vacuously, so it must count as a failed attempt, never as a Best-self answer.
 */
export async function chatText(env: Env, args: ChatTextArgs, fetchImpl: FetchImpl = fetch): Promise<string> {
  const body: Record<string, unknown> = { model: args.model, messages: args.messages, stream: false };
  if (args.temperature !== undefined) body.temperature = args.temperature;
  if (args.max_tokens !== undefined) body.max_tokens = args.max_tokens;
  const res = await fetchImpl(completionsUrl(env), {
    method: "POST",
    headers: { authorization: `Bearer ${env.NEBIUS_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await upstreamError("nebius", res, "chat completion", [env.NEBIUS_API_KEY]);
  const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? stripThinking(content) : "";
  if (!text) throw new UpstreamError("nebius", res.status, "empty assistant content", "chat completion");
  return text;
}

/**
 * The Custom LLM pass-through. `body` is the parsed JSON ElevenLabs sent. Throws TypeError if
 * it is not a JSON object (the route answers 400). Any Nebius status, including errors, is
 * returned as is so ElevenLabs sees the real upstream response.
 */
export async function forwardChatCompletions(env: Env, body: unknown, fetchImpl: FetchImpl = fetch): Promise<Response> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new TypeError("chat completions body must be a JSON object");
  }
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete out.elevenlabs_extra_body;
  out.model = env.COACH_MODEL;
  out.reasoning_effort = "none";
  out.stream = true;
  return fetchImpl(completionsUrl(env), {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.NEBIUS_API_KEY}`,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(out),
  });
}
