// Starting a Round (spec task 3). Owner from Wave 2: A6. Wave 1 stub so the router is wired
// once and Wave 2 never edits index.ts; it answers 501 until A6 fills the body.
import type { Env, Session } from "../env";
import { error } from "../http";

export async function startRound(_req: Request, _env: Env, _session: Session, _params?: { id: string }): Promise<Response> {
  return error("bad_request", 501);
}
