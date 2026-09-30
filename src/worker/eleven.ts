// ElevenLabs REST from the Worker with plain fetch, not the Node SDK: we need five calls, and
// the SDK's clean bundling under Workers without nodejs_compat is unconfirmed (ELEVENLABS-FACTS
// section 7). Every wrapper takes an injectable fetch so tests assert URL, method, headers and
// body without a network. The API key only ever travels in the xi-api-key header; errors carry
// the upstream status and a short, key-scrubbed body excerpt, never the key.
import type { Env } from "./env";
import type { TranscriptItem } from "./transcript";

export type FetchImpl = typeof fetch;

const EXCERPT_CHARS = 200;

/** A non-2xx from ElevenLabs or Nebius. Safe to log: the excerpt has any key scrubbed out. */
export class UpstreamError extends Error {
  readonly service: "elevenlabs" | "nebius";
  readonly status: number;
  readonly excerpt: string;

  constructor(service: "elevenlabs" | "nebius", status: number, excerpt: string, what: string) {
    super(`${service} ${what} failed with ${status}`);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
    this.excerpt = excerpt;
  }
}

/** Reads a short excerpt of a failed response body, with any secret replaced. */
export async function upstreamError(
  service: "elevenlabs" | "nebius",
  res: Response,
  what: string,
  secrets: string[],
): Promise<UpstreamError> {
  let text = "";
  try {
    text = (await res.text()).slice(0, EXCERPT_CHARS);
  } catch {
    text = "";
  }
  for (const s of secrets) if (s) text = text.split(s).join("[redacted]");
  return new UpstreamError(service, res.status, text, what);
}

function url(env: Env, path: string): string {
  return `${env.ELEVEN_API_BASE.replace(/\/+$/, "")}${path}`;
}

function keyHeader(env: Env): Record<string, string> {
  return { "xi-api-key": env.ELEVENLABS_API_KEY };
}

async function fail(env: Env, res: Response, what: string): Promise<never> {
  throw await upstreamError("elevenlabs", res, what, [env.ELEVENLABS_API_KEY]);
}

export type AddVoiceArgs = { name: string; sample: Blob; filename: string };
export type AddVoiceResult = { voice_id: string; requires_verification: boolean };

/**
 * Instant Voice Clone from one Voice sample. Field names per ELEVENLABS-FACTS section 1
 * (`name`, `files`). `remove_background_noise` is deliberately not sent: the docs warn it can
 * make a clean sample worse.
 */
export async function addVoice(env: Env, args: AddVoiceArgs, fetchImpl: FetchImpl = fetch): Promise<AddVoiceResult> {
  const form = new FormData();
  form.append("name", args.name);
  form.append("files", args.sample, args.filename);
  const res = await fetchImpl(url(env, "/v1/voices/add"), { method: "POST", headers: keyHeader(env), body: form });
  if (!res.ok) return fail(env, res, "add voice");
  const json = (await res.json()) as { voice_id?: unknown; requires_verification?: unknown };
  if (typeof json.voice_id !== "string" || !json.voice_id) {
    throw new UpstreamError("elevenlabs", res.status, "response had no voice_id", "add voice");
  }
  return { voice_id: json.voice_id, requires_verification: json.requires_verification === true };
}

/** Deletes one Voice clone by id. A 404 means it is already gone, which is the goal. */
export async function deleteVoice(env: Env, voiceId: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  const res = await fetchImpl(url(env, `/v1/voices/${encodeURIComponent(voiceId)}`), {
    method: "DELETE",
    headers: keyHeader(env),
  });
  if (res.status === 404) return;
  if (!res.ok) return fail(env, res, "delete voice");
}

/** WebRTC conversation token for the private Sage agent. Lifetime is undocumented: mint right before startSession. */
export async function getConversationToken(env: Env, fetchImpl: FetchImpl = fetch): Promise<{ token: string }> {
  const res = await fetchImpl(url(env, `/v1/convai/conversation/token?agent_id=${encodeURIComponent(env.AGENT_ID)}`), {
    method: "GET",
    headers: keyHeader(env),
  });
  if (!res.ok) return fail(env, res, "conversation token");
  const json = (await res.json()) as { token?: unknown };
  if (typeof json.token !== "string" || !json.token) {
    throw new UpstreamError("elevenlabs", res.status, "response had no token", "conversation token");
  }
  return { token: json.token };
}

export type ConversationStatus = "initiated" | "in-progress" | "processing" | "done" | "failed";
export type Conversation = { status: ConversationStatus; transcript: TranscriptItem[] };

/** One read of a Conversation (status + transcript). The caller owns polling and its cap. */
export async function getConversation(env: Env, conversationId: string, fetchImpl: FetchImpl = fetch): Promise<Conversation> {
  const res = await fetchImpl(url(env, `/v1/convai/conversations/${encodeURIComponent(conversationId)}`), {
    method: "GET",
    headers: keyHeader(env),
  });
  if (!res.ok) return fail(env, res, "get conversation");
  const json = (await res.json()) as { status?: ConversationStatus; transcript?: TranscriptItem[] | null };
  return { status: json.status as ConversationStatus, transcript: Array.isArray(json.transcript) ? json.transcript : [] };
}

/**
 * Replay audio. Returns the raw Response so the route streams its body to the browser:
 * buffering or base64-encoding audio in the Worker would blow the 10 ms CPU budget.
 */
export async function textToSpeech(env: Env, voiceId: string, text: string, fetchImpl: FetchImpl = fetch): Promise<Response> {
  const res = await fetchImpl(url(env, `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`), {
    method: "POST",
    headers: { ...keyHeader(env), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: env.TTS_MODEL }),
  });
  if (!res.ok) return fail(env, res, "text to speech");
  return res;
}

export type Model = { model_id: string; can_do_text_to_speech?: boolean; [k: string]: unknown };

/** GET /v1/models (a top-level array). Used to decide TTS_MODEL at gate 1 to 2. */
export async function listModels(env: Env, fetchImpl: FetchImpl = fetch): Promise<Model[]> {
  const res = await fetchImpl(url(env, "/v1/models"), { method: "GET", headers: keyHeader(env) });
  if (!res.ok) return fail(env, res, "list models");
  const json = (await res.json()) as unknown;
  return Array.isArray(json) ? (json as Model[]) : [];
}
