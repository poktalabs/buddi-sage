// Starting a Round (spec task 3). The order of checks is the decision this module encodes:
// everything that can fail without spending (bad body, unknown Question, no Voice clone) is
// checked before spendRound, and the Round is spent before the conversation token is minted,
// so a Guest cannot mint tokens without paying a Round. If minting then fails, the Round is
// refunded and marked failed: the Guest never loses a Round of the Allowance to an upstream
// error. Nothing here logs the Guest's code, Contact or any key.
import type { StartRoundResponse } from "../../shared/api";
import { findQuestion } from "../../shared/questions";
import { failRound, getCode, insertRound, refundRound, spendRound } from "../db";
import { type FetchImpl, UpstreamError, getConversationToken } from "../eleven";
import type { Env, Session } from "../env";
import { error, json, readJsonObject } from "../http";

/**
 * POST /api/rounds. `fetchImpl` is only for tests (the router passes four arguments, so the
 * global fetch is used in the Worker).
 */
export async function startRound(
  req: Request,
  env: Env,
  session: Session,
  _params?: { id: string },
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const body = await readJsonObject(req);
  if (!body) return error("bad_request", 400);
  if (typeof body.question_id !== "string") return error("unknown_question", 400);
  const question = findQuestion(body.question_id);
  if (!question) return error("unknown_question", 400);

  const row = await getCode(env.DB, session.code);
  if (!row) return error("unauthorized", 401);
  // Before spending: a Round without a Voice clone could never reach its Replay.
  if (!row.voice_id) return error("voice_required", 409);

  const now = new Date();
  if (!(await spendRound(env.DB, session.code, now))) return error("allowance_used", 403);

  const roundId = crypto.randomUUID();
  await insertRound(env.DB, { id: roundId, code: session.code, question_id: question.id });

  let token: string;
  try {
    token = (await getConversationToken(env, fetchImpl)).token;
  } catch (err) {
    // Status and error name only: the excerpt is key-scrubbed but still not needed here.
    console.error("conversation token failed", err instanceof UpstreamError ? err.status : err instanceof Error ? err.name : typeof err);
    await refundRound(env.DB, session.code);
    await failRound(env.DB, roundId);
    return error("upstream_error", 502);
  }

  // Read back after the atomic spend, so a concurrent Round in another tab is counted too.
  const after = await getCode(env.DB, session.code);
  const allowanceLeft = after ? Math.max(0, after.allowance - after.used) : Math.max(0, row.allowance - row.used - 1);
  const res: StartRoundResponse = {
    round_id: roundId,
    conversation_token: token,
    question: { id: question.id, text: question.text },
    allowance_left: allowanceLeft,
  };
  return json(res);
}
