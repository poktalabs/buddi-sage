// The Worker entry: a small hand-written router (no router dependency for ten routes) and the
// hourly cron. Only /api/*, /llm/*, /admin/* and /telegram/* reach it (wrangler.jsonc run_worker_first);
// the static assets serve every other path. Every route is wired here in Wave 1 so Wave 2
// agents fill handler bodies without touching this file. Auth is decided here, not in the
// handlers: session routes get a verified Session or a 401, /llm and /admin check their own
// bearer secret inside the handler.
import type { Env, Session } from "./env";
import { error } from "./http";
import { readSession } from "./session";
import { logout, me, redeem } from "./routes/access";
import { createCodes, dashboard, dashboardCreateCodes } from "./routes/admin";
import { addVoice, deleteVoice } from "./routes/voice";
import { startRound } from "./routes/rounds";
import { chatCompletions } from "./routes/llm";
import { audio, replay } from "./routes/replay";
import { createCodeRequest } from "./routes/requests";
import { telegramWebhook } from "./routes/telegram";
import { setJob } from "./routes/job";
import { cleanupVoices } from "./cleanup";

type Params = { id: string };
type SessionHandler = (req: Request, env: Env, session: Session, params?: Params) => Promise<Response>;
type PublicHandler = (req: Request, env: Env) => Promise<Response>;

type Route =
  | { method: string; pattern: RegExp; auth: "session"; handler: SessionHandler }
  | { method: string; pattern: RegExp; auth: "none"; handler: PublicHandler };

// Round ids are crypto.randomUUID(); the pattern accepts any single path segment and the
// handler's scoped lookup rejects ids that are not the Guest's.
const ROUTES: Route[] = [
  { method: "POST", pattern: /^\/api\/redeem$/, auth: "none", handler: redeem },
  { method: "POST", pattern: /^\/api\/logout$/, auth: "none", handler: logout },
  { method: "GET", pattern: /^\/api\/me$/, auth: "session", handler: me },
  { method: "POST", pattern: /^\/admin\/codes$/, auth: "none", handler: createCodes },
  // The owner dashboard: a Session route; the handler answers 403 unless the code is an owner code.
  { method: "GET", pattern: /^\/api\/dashboard$/, auth: "session", handler: dashboard },
  { method: "POST", pattern: /^\/api\/dashboard\/codes$/, auth: "session", handler: dashboardCreateCodes },
  { method: "POST", pattern: /^\/api\/requests$/, auth: "none", handler: (r, e) => createCodeRequest(r, e) },
  { method: "POST", pattern: /^\/telegram\/webhook$/, auth: "none", handler: telegramWebhook },
  { method: "POST", pattern: /^\/api\/voice$/, auth: "session", handler: addVoice },
  { method: "DELETE", pattern: /^\/api\/voice$/, auth: "session", handler: deleteVoice },
  { method: "POST", pattern: /^\/api\/job$/, auth: "session", handler: setJob },
  { method: "POST", pattern: /^\/api\/rounds$/, auth: "session", handler: startRound },
  { method: "POST", pattern: /^\/api\/rounds\/(?<id>[^/]+)\/replay$/, auth: "session", handler: replay },
  { method: "GET", pattern: /^\/api\/rounds\/(?<id>[^/]+)\/audio$/, auth: "session", handler: audio },
  // ElevenLabs Custom LLM may call the base URL plus /chat/completions or the full /v1 path
  // (ELEVENLABS-FACTS section 5, unconfirmed), so both reach the same handler.
  { method: "POST", pattern: /^\/llm\/v1\/chat\/completions$/, auth: "none", handler: chatCompletions },
  { method: "POST", pattern: /^\/llm\/chat\/completions$/, auth: "none", handler: chatCompletions },
];

export async function handle(req: Request, env: Env): Promise<Response> {
  const path = new URL(req.url).pathname;
  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    if (route.auth === "none") return route.handler(req, env);
    const session = await readSession(req, env);
    if (!session) return error("unauthorized", 401);
    const id = match.groups?.id;
    return route.handler(req, env, session, id === undefined ? undefined : { id });
  }
  // The contract's error list is fixed, so an unknown route is a bad_request with a 404 status.
  return error("bad_request", 404);
}

const worker: ExportedHandler<Env> = {
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (err) {
      // Name only: a message can carry request content, and Guest words never go to logs.
      console.error("unhandled worker error", err instanceof Error ? err.name : typeof err);
      return error("upstream_error", 500);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      cleanupVoices(env, new Date()).then(
        () => undefined,
        (err: unknown) => console.error("voice cleanup failed", err instanceof Error ? err.name : typeof err),
      ),
    );
  },
};

export default worker;
