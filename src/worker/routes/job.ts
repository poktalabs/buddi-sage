// POST /api/job: the Guest sets their target job (a link or the pasted post) and gets back
// their Me with the new brief. Each brief is a model call, so a code may build at most
// MAX_JOB_SETS of them; the cap is checked before the call and enforced again in the write.
// Nothing here logs the job text: a pasted post can carry the Guest's own notes.
import type { SetJobRequest } from "../../shared/api";
import { getCode, setJobBrief } from "../db";
import type { FetchImpl } from "../eleven";
import type { Env, Session } from "../env";
import { error, json, readJsonObject } from "../http";
import { buildBrief, MAX_JOB_SETS, MAX_SOURCE_CHARS } from "../job";
import { chatText } from "../nebius";
import { toMe } from "./access";

export async function setJob(
  req: Request,
  env: Env,
  session: Session,
  _params?: { id: string },
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const body = (await readJsonObject(req)) as Partial<Record<keyof SetJobRequest, unknown>> | null;
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  if (!source || source.length > MAX_SOURCE_CHARS) return error("bad_request", 400);

  const row = await getCode(env.DB, session.code);
  if (!row) return error("unauthorized", 401);
  if (row.job_sets >= MAX_JOB_SETS) return error("job_limit", 429);

  const result = await buildBrief(source, {
    model: env.JOB_MODEL,
    chatText: (args) => chatText(env, args, fetchImpl),
    fetchImpl,
  });
  if (!result.ok) return error(result.code, result.code === "upstream_error" ? 502 : 422);

  if (!(await setJobBrief(env.DB, row.code, source, JSON.stringify(result.brief), MAX_JOB_SETS))) return error("job_limit", 429);
  const after = await getCode(env.DB, row.code);
  return json(toMe(after!));
}
