// Voice clone routes (spec task 2). Owner from Wave 2: A5. Wave 1 stub so the router is wired
// once and Wave 2 never edits index.ts; it answers 501 until A5 fills the bodies.
import type { Env, Session } from "../env";
import { error } from "../http";

export async function addVoice(_req: Request, _env: Env, _session: Session, _params?: { id: string }): Promise<Response> {
  return error("bad_request", 501);
}

export async function deleteVoice(_req: Request, _env: Env, _session: Session, _params?: { id: string }): Promise<Response> {
  return error("bad_request", 501);
}
