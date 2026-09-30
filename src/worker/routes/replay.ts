// The Replay and its audio (spec task 5). Owner from Wave 2: A7. Wave 1 stub so the router is
// wired once and Wave 2 never edits index.ts; it answers 501 until A7 fills the bodies.
import type { Env, Session } from "../env";
import { error } from "../http";

export async function replay(_req: Request, _env: Env, _session: Session, _params?: { id: string }): Promise<Response> {
  return error("bad_request", 501);
}

export async function audio(_req: Request, _env: Env, _session: Session, _params?: { id: string }): Promise<Response> {
  return error("bad_request", 501);
}
