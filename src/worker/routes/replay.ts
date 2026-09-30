// The Replay and its audio (spec task 5). replay turns a finished Conversation into the
// Best-self answer: the Guest's final Answer comes from the ElevenLabs transcript (their exact
// words), the rewrite passes the guard rules or falls back to their own words, and finishRound
// writes it once. Polling is capped at 20 reads because Workers Free allows 50 subrequests per
// request; running out answers 504 and leaves the Round started so the page can retry once. A
// Round that is no longer started answers 409, so a retry or a second tab never spends a
// second rewrite or writes a second Replay. audio streams the TTS body straight through:
// buffering or re-encoding the audio would blow the 10 ms CPU budget.
import type { ReplayResponse } from "../../shared/api";
import { findQuestion } from "../../shared/questions";
import { failRound, finishRound, getCode, getRound, setConversationId } from "../db";
import { type FetchImpl, type Conversation, getConversation, textToSpeech } from "../eleven";
import type { Env, Session } from "../env";
import { error, json, readJsonObject } from "../http";
import { chatText } from "../nebius";
import { bestSelfAnswer } from "../rewrite";
import { extractFinalAnswer } from "../transcript";

export const POLL_INTERVAL_MS = 1500;
export const MAX_POLLS = 20;

export type ReplayDeps = {
  fetchImpl?: FetchImpl;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function logUpstream(what: string, err: unknown): void {
  // Name and status only: no Guest words, and UpstreamError messages never carry a key.
  const status = err && typeof err === "object" && "status" in err ? (err as { status: unknown }).status : undefined;
  console.error(what, err instanceof Error ? err.name : typeof err, status ?? "");
}

export async function replay(
  req: Request,
  env: Env,
  session: Session,
  params?: { id: string },
  deps: ReplayDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? realSleep;

  const round = params?.id ? await getRound(env.DB, params.id, session.code) : null;
  if (!round) return error("round_not_found", 404);

  const body = await readJsonObject(req);
  const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id.trim() : "";
  if (!conversationId) return error("bad_request", 400);

  if (round.status !== "started") return error("round_already_replayed", 409);
  // A retry must name the same Conversation: a Round's Replay comes from one Conversation only.
  if (round.conversation_id && round.conversation_id !== conversationId) return error("bad_request", 400);
  if (!round.conversation_id) await setConversationId(env.DB, round.id, conversationId);

  let conversation: Conversation | null = null;
  for (let poll = 1; poll <= MAX_POLLS; poll++) {
    let read: Conversation;
    try {
      read = await getConversation(env, conversationId, fetchImpl);
    } catch (err) {
      logUpstream("replay get conversation failed", err);
      return error("upstream_error", 502);
    }
    if (read.status === "done") {
      conversation = read;
      break;
    }
    if (read.status === "failed") {
      await failRound(env.DB, round.id);
      return error("conversation_failed", 502);
    }
    if (poll < MAX_POLLS) await sleep(POLL_INTERVAL_MS);
  }
  if (!conversation) return error("conversation_timeout", 504);

  const final = extractFinalAnswer(conversation.transcript);
  if (!final.ok) {
    await failRound(env.DB, round.id);
    return error(final.reason, 422);
  }

  const question = findQuestion(round.question_id)?.text ?? "";
  const rewrite = await bestSelfAnswer(
    { question, answer: final.answer },
    { model: env.REWRITE_MODEL, chatText: (args) => chatText(env, args, fetchImpl) },
  );

  const written = await finishRound(env.DB, round.id, {
    status: rewrite.status,
    final_answer: final.answer,
    best_self_text: rewrite.text,
    rewrite_attempts: rewrite.attempts,
    guard_failures: rewrite.failures,
  });
  // Another request finished (or failed) this Round while we worked: its Replay stands.
  if (!written) return error("round_already_replayed", 409);

  const out: ReplayResponse = {
    status: rewrite.status,
    final_answer: final.answer,
    best_self_text: rewrite.text,
    audio_url: `/api/rounds/${encodeURIComponent(round.id)}/audio`,
  };
  return json(out);
}

export async function audio(
  _req: Request,
  env: Env,
  session: Session,
  params?: { id: string },
  deps: ReplayDeps = {},
): Promise<Response> {
  const round = params?.id ? await getRound(env.DB, params.id, session.code) : null;
  if (!round) return error("round_not_found", 404);

  // No Replay yet (started or failed): the contract has no "not ready" code, so 409 with the
  // generic bad_request; round_already_replayed would say the opposite of the truth.
  if ((round.status !== "replayed" && round.status !== "fallback") || !round.best_self_text) {
    return error("bad_request", 409);
  }

  const code = await getCode(env.DB, session.code);
  if (!code?.voice_id) return error("voice_required", 409);

  let upstream: Response;
  try {
    upstream = await textToSpeech(env, code.voice_id, round.best_self_text, deps.fetchImpl ?? fetch);
  } catch (err) {
    logUpstream("replay text to speech failed", err);
    return error("upstream_error", 502);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}
