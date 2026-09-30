// The coach LLM pass-through for Sage's Custom LLM (spec task 4). Owner from Wave 2: A6. Wave 1
// stub so the router is wired once and Wave 2 never edits index.ts; it answers 501 until A6
// fills the body.
import type { Env } from "../env";
import { error } from "../http";

export async function chatCompletions(_req: Request, _env: Env): Promise<Response> {
  return error("bad_request", 501);
}
