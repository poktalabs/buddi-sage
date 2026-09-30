# IMPLEMENTATION PLAN: BUDDi Sage Mode, Tier A

Written 2026-09-29 by `/ultraplan-wave`. Source: `workstreams/experiment-buddi-voice-coach-elevenlabs/docs/TIER-A-BUILD-SPEC.md` (task numbers below are that spec's 1 to 9). Repo: `thetokendad/projects/agentcamp-research/code/buddi-sage`, baseline `main` @ `781345a`, no remote.

## The deliverable

**Mel completes one full Round on the deployed `*.workers.dev` URL and hears the Replay in their own Voice clone**, by Wednesday 2026-09-30 night. Owner of that moment: the orchestrator with Mel, in Wave 3. Waves 1 and 2 build the pieces; Wave 3 is where the thing exists. If Wave 3 has not run, Tier A has not shipped, whatever the test count says.

Per wave, what a human can use when it is done:

| Wave | What exists that a human can use |
|---|---|
| 0 | A frozen API contract and content placeholders every agent builds against. |
| 1 | A Worker that boots locally, issues codes and sessions; a clickable client that walks every screen against the contract; drafted content for Mel to approve. |
| 2 | The whole loop running locally against real ElevenLabs and Nebius: record a Voice sample, start a Round, get a Replay (with a hand-created test agent, see Wave 2 notes). |
| 3 | The deployed product and the Sage agent: Mel's Round on the live URL. |

## Survey: what exists, what not to rebuild, what to cut

**Already done, do not rebuild:**

- `src/worker/guards.ts`: `checkBestSelfAnswer(original, rewrite)` and `describeFailures`, the two Tier A rules ("we" turned into "I"; a quantity not in the Answer), with spelled-out and digit numbers normalised. 5/5 tests in `test/guards.test.ts`. Use it as is. Extending the rules is out of scope (the judge-based guardrail waits for the ACR-019 design review).
- `migrations/0001_codes_and_rounds.sql`: `codes` (code, kind guest|gift|owner, allowance, used, contact, voice_id, voice_created_at, note, created_at, last_used_at) and `rounds` (id, code, question_id, conversation_id, status started|replayed|fallback|failed, rewrite_attempts, guard_failures, created_at). Do not edit 0001; add 0002.
- `src/shared/questions.ts`: the three Questions and `findQuestion(id)`.
- `wrangler.jsonc`: D1 binding `DB`, vars, SPA assets with `run_worker_first` for `/api/*`, `/llm/*`, `/admin/*`. `vite.config.ts` uses `@cloudflare/vite-plugin`; `vitest.config.ts` runs `test/**/*.test.ts` in Node.
- `@elevenlabs/client` 1.25.0 is installed (pinned below 1.26 by pnpm `minimumReleaseAge`; that is expected, not a bug).
- Model choice is settled: coach `deepseek-ai/DeepSeek-V4-Pro-0813` with `reasoning_effort: "none"`, rewrite `MiniMaxAI/MiniMax-M3` (DECISIONS grill Q11). Do not re-benchmark in Waves 1 and 2.

**Cut, do not build (with the reason):**

- The ElevenLabs Node SDK (`@elevenlabs/elevenlabs-js`) in the Worker: its deps are `ws`, `node-fetch`, `command-exists`, and clean bundling under Workers without `nodejs_compat` is unconfirmed (ELEVENLABS-FACTS section 7). Five REST calls with `fetch` avoid the question.
- Stripping or rewriting SSE in the LLM proxy: the spec says pass the stream through unchanged, and parsing SSE per chunk spends Workers Free CPU (10 ms per request). If ElevenLabs chokes on `reasoning_content` in the live smoke, that is a Wave 3 finding to report, not a Wave 2 pre-emptive fix.
- A Workers test pool (`@cloudflare/vitest-pool-workers`, miniflare): a dependency change, and Node 22.23 ships `node:sqlite`, which is enough for a D1 fake (see A1).
- Anything in the spec's "Out of scope for Tier A": Spanish, Scribe Hesitation signals, automated agent tests, post-call webhooks, PostHog, the eval suite and judge guardrail, avatar or Text-to-Dialogue, a designed Sage voice, JD/CV Questions, Workers KV Story bank (Tier A keeps the Story bank in browser `localStorage`).
- Voice overrides on the agent. Sage always speaks as Jen; the Voice clone is used only for Replay TTS.

**Platform limits that shape the code (Workers Free, developers.cloudflare.com/workers/platform/limits, cited in DECISIONS):** 10 ms CPU per request and 50 subrequests per request. So: stream audio from ElevenLabs to the browser, never buffer and base64-encode it in the Worker; cap transcript polling; no per-chunk parsing in the proxy.

## Wave structure

```
Wave 0  orchestrator contract commit (no agents)
          │  gate 0→1
Wave 1  A1 access+db   A2 clients+pure   A3 content   A4 client page     (parallel, disjoint)
          │  gate 1→2: needs A1 + A2 merged, content approved, keys in .dev.vars, probe run
Wave 2  A5 voice+cleanup   A6 rounds+llm proxy   A7 replay               (parallel, disjoint)
          │  gate 2→3
Wave 3  orchestrator + Mel: D1, secrets, deploy, Sage agent, AGENT_ID, owner code, live Round
          │  gate 3→done (terminal)
```

Dependencies are derived from what each task asserts against:

- A2 needs the `Env` type: Wave 0 provides it, so A2 does not wait for A1.
- A4 needs the API contract and the content files to import: Wave 0 provides both as a frozen contract and placeholders, so A4 does not wait for A1 or A3.
- A5, A6, A7 each need A1 (route stubs wired into `index.ts`, `db.ts`, session helpers, the D1 fake) **and** A2 (`eleven.ts`, `nebius.ts`, `transcript.ts`, `clean.ts`). Wave 2 starts when A1 and A2 are merged. A3 and A4 may still be running then; nothing in Wave 2 asserts against them, except that A7 imports `content/rewrite-prompt.md`, which exists as a Wave 0 placeholder, so A7 can build before approval.
- If A4 is still running when Wave 2 starts, that is fine: Wave 2 touches no `src/client/**` file, with one declared exception (A5 takes `src/client/recorder.ts` only if the probe says WebM is rejected; if A4 has not merged by then, hold A5's recorder work until it has).
- Wave 3 needs everything merged, plus approved content, plus Mel.

Four agents in Wave 1 and three in Wave 2 because that is the number of disjoint file sets. Do not split further.

## Wave 0: the contract commit (orchestrator, no agents)

The orchestrator transcribes the plan's contract into the repo on the integration branch `tier-a` (cut from `main` @ `781345a`), in one commit, with no feature logic. Exactly these files:

**`src/shared/api.ts`** (verbatim):

```ts
// The browser/Worker contract for Tier A. Frozen at Wave 0: agents build against it and
// report (not edit) any change they need. Error bodies are always ApiError.
export type CodeKind = "guest" | "gift" | "owner";

export type ApiError = { error: string };

export type RedeemRequest = { code: string; contact?: string };
export type Me = {
  kind: CodeKind;
  allowance: number;
  used: number;
  hasContact: boolean;
  hasVoice: boolean;
};

export type VoiceResponse = { hasVoice: boolean };

export type StartRoundRequest = { question_id: string };
export type StartRoundResponse = {
  round_id: string;
  conversation_token: string;
  question: { id: string; text: string };
  allowance_left: number;
};
// Dynamic variables the page passes to Conversation.startSession; the Sage prompt uses them.
export type SageDynamicVariables = { question_id: string; question_text: string };

export type ReplayRequest = { conversation_id: string };
export type ReplayResponse = {
  status: "replayed" | "fallback";
  final_answer: string;
  best_self_text: string;
  audio_url: string; // GET, same origin, cookie-authenticated, audio/mpeg
};

export type AdminCreateCodesRequest = {
  kind: CodeKind;
  count?: number; // default 1
  allowance?: number; // guest default 3, owner default 100, gift required
  note?: string;
};
export type AdminCreateCodesResponse = { codes: string[] };

export const STORY_BANK_KEY = "buddi-sage:story-bank";
export type StoryBankEntry = { question_id: string; final_answer: string; best_self_text: string; saved_at: string };
```

Error codes (`ApiError.error`) are fixed strings: `unauthorized` (401), `bad_request` (400), `invalid_code` (404), `contact_required` (400), `voice_required` (409), `voice_exists` (409), `voice_verification_required` (422), `allowance_used` (403), `unknown_question` (400), `round_not_found` (404), `round_already_replayed` (409), `conversation_failed` (502), `conversation_timeout` (504), `no_save_answer` (422), `empty_answer` (422), `upstream_error` (502).

**Routes** (pinned; A1 wires all of them in Wave 1, Wave 2 fills the bodies):

| Method + path | Auth | Handler (module: export) | Body owner |
|---|---|---|---|
| `POST /api/redeem` | none | `routes/access.ts: redeem` | A1 |
| `GET /api/me` | cookie | `routes/access.ts: me` | A1 |
| `POST /admin/codes` | `Bearer ADMIN_SECRET` | `routes/admin.ts: createCodes` | A1 |
| `POST /api/voice` | cookie | `routes/voice.ts: addVoice` | A5 |
| `DELETE /api/voice` | cookie | `routes/voice.ts: deleteVoice` | A5 |
| `POST /api/rounds` | cookie | `routes/rounds.ts: startRound` | A6 |
| `POST /api/rounds/:id/replay` | cookie | `routes/replay.ts: replay` | A7 |
| `GET /api/rounds/:id/audio` | cookie | `routes/replay.ts: audio` | A7 |
| `POST /llm/v1/chat/completions` and `POST /llm/chat/completions` | `Bearer LLM_PROXY_SECRET` | `routes/llm.ts: chatCompletions` | A6 |
| scheduled (cron) | n/a | `cleanup.ts: cleanupVoices` | A5 |

Handler signatures (pinned): session routes `(req: Request, env: Env, session: Session, params?: { id: string }) => Promise<Response>`; `llm` and `admin` `(req: Request, env: Env) => Promise<Response>`; `cleanupVoices(env: Env, now: Date) => Promise<{ deleted: number; failed: number }>`. `Session = { code: string }` is exported by A1's `src/worker/session.ts`; until then Wave 0 declares it in `env.ts` so A2 compiles.

**`src/worker/env.ts`** (verbatim):

```ts
// Worker bindings: vars from wrangler.jsonc, secrets from .dev.vars / wrangler secret.
export interface Env {
  DB: D1Database;
  ELEVEN_API_BASE: string;
  NEBIUS_API_BASE: string;
  COACH_MODEL: string;
  REWRITE_MODEL: string;
  TTS_MODEL: string;
  AGENT_ID: string;
  ELEVENLABS_API_KEY: string;
  NEBIUS_API_KEY: string;
  LLM_PROXY_SECRET: string;
  SESSION_SECRET: string;
  ADMIN_SECRET: string;
}

export type Session = { code: string };
```

**`src/raw.d.ts`**: `declare module "*.md?raw" { const text: string; export default text; }` so the Worker and the page import approved content as strings via Vite's `?raw`. **Assumption to verify:** `?raw` works in the Worker bundle built by `@cloudflare/vite-plugin` and in Vitest. A1 verifies it with `pnpm build` in Wave 1 (A1's `index.ts` is the first thing that makes `pnpm build` runnable) by importing one content file in a throwaway check, and reports.

**`content/` placeholders**, each containing the single line `PENDING DRAFT (A3, Wave 1). Not approved.`: `content/consent.md`, `content/reading-script.md`, `content/rewrite-prompt.md`, `content/sage-system-prompt.md`, `content/sage-first-message.md`.

After the commit: `pnpm typecheck` exits 0 and `pnpm test` reports 5 passed in 1 file. The orchestrator also declares the Wave 1 worktrees in the workstream BRIEF.

## Collision table

Two agents never hold the same row. `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` and everything in `docs/plans/` belong to the orchestrator alone.

| File / glob | Owner | Wave |
|---|---|---|
| `src/shared/api.ts`, `src/worker/env.ts`, `src/raw.d.ts` | orchestrator (frozen contract) | 0 |
| `content/*.md` (placeholders) | orchestrator creates; A3 fills | 0 → 1 |
| `src/worker/index.ts` (router, `fetch` + `scheduled` exports) | A1 | 1; frozen in 2 (changes via declared report) |
| `src/worker/session.ts`, `src/worker/http.ts`, `src/worker/db.ts` | A1 | 1; read-only in 2 |
| `src/worker/routes/access.ts`, `src/worker/routes/admin.ts` | A1 | 1 |
| `src/worker/routes/voice.ts`, `src/worker/cleanup.ts` | A1 writes 501 stubs → A5 | 1 → 2 |
| `src/worker/routes/rounds.ts`, `src/worker/routes/llm.ts` | A1 writes 501 stubs → A6 | 1 → 2 |
| `src/worker/routes/replay.ts` | A1 writes 501 stub → A7 | 1 → 2 |
| `migrations/0002_*.sql` | A1 | 1 |
| `wrangler.jsonc` `triggers` key only | A1 | 1 |
| `wrangler.jsonc` everything else (`database_id`, `AGENT_ID`, `TTS_MODEL`) | orchestrator | 3 (TTS_MODEL at gate 1→2) |
| `test/support/fakeD1.js`, `test/support/fakeD1.d.ts` | A1 | 1; read-only in 2 |
| `test/session.test.ts`, `test/db.test.ts`, `test/access.test.ts`, `test/admin.test.ts` | A1 | 1 |
| `src/worker/eleven.ts`, `src/worker/nebius.ts` | A2 | 1; read-only in 2 |
| `src/worker/transcript.ts`, `src/worker/clean.ts` | A2 | 1; read-only in 2 |
| `test/eleven.test.ts`, `test/nebius.test.ts`, `test/transcript.test.ts`, `test/clean.test.ts`, `test/fixtures/**` | A2 | 1 |
| `evals/probe-2026-09-30/probe.mjs` | A2 | 1 (run by orchestrator at gate 1→2) |
| `content/*.md` (drafts), `content/README.md` | A3 | 1 |
| `index.html`, `src/client/**` except `recorder.ts`, `public/**` | A4 | 1 |
| `src/client/recorder.ts` | A4 → A5 only if the probe rejects WebM | 1 → 2 (conditional, declared) |
| `test/voice.test.ts`, `test/cleanup.test.ts` | A5 | 2 |
| `test/rounds.test.ts`, `test/llm.test.ts`, `evals/probe-2026-09-30/proxy-ttft.mjs` | A6 | 2 |
| `src/worker/rewrite.ts`, `test/rewrite.test.ts`, `test/replay.test.ts` | A7 | 2 |
| `src/worker/guards.ts`, `test/guards.test.ts`, `migrations/0001_*`, `src/shared/questions.ts` | nobody (done) | n/a |

**Contended: `src/worker/index.ts`.** A1 writes it in Wave 1 with every route above wired to its module and export, so Wave 2 agents never need it. A Wave 2 agent that thinks it does must stop and report the integration point; the orchestrator decides. **Contended: `src/worker/db.ts`.** A1 writes every query Wave 2 needs (list in A1). A Wave 2 agent that needs another query writes it as a local function in its own module and reports it; it does not edit `db.ts`.

**Declared crossings that are acceptable:** an agent adding a new test file under `test/` named after its own module; A4 adding assets under `public/`. Any other file outside the table is an undeclared crossing and a rejected branch.

## Wave 1 assignments

### A1: Worker skeleton, access, data layer (spec task 1)

Owns exclusively: see table (A1 rows). Must not touch: `src/worker/eleven.ts`, `nebius.ts`, `transcript.ts`, `clean.ts` (A2, Wave 1), `src/client/**` and `index.html` (A4), `content/**` (A3), anything orchestrator-owned.

Substance:

- **Router** (`index.ts`): a small hand-written matcher over method + path, no router dependency. Unknown `/api/*`, `/llm/*`, `/admin/*` return `404 {error:"bad_request"}`-shaped JSON (use `not_found` only if you add it to the report; the contract list is fixed, so prefer `bad_request`). All other paths never reach the Worker (assets handle them). Export `default { fetch, scheduled }`; `scheduled` calls `cleanupVoices(env, new Date())` wrapped in `ctx.waitUntil`. Add `"triggers": { "crons": ["17 * * * *"] }` to `wrangler.jsonc` (hourly).
- **Session cookie** (`session.ts`): `sage_session=<code>.<base64url HMAC-SHA256(code, SESSION_SECRET)>`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Web Crypto (`crypto.subtle`, available in Workers and in Node 22). Verify with a constant-time compare. Export `sign`, `verify`, `sessionCookie(code, secret)`, `readSession(req, env): Promise<Session | null>`, and `requireBearer(req, secret): boolean` (constant-time) for `/llm` and `/admin`. Tests: round trip, tampered code, tampered signature, wrong secret, missing cookie, cookie among other cookies.
- **Data layer** (`db.ts`), all functions take `D1Database` first. Codes: `getCode`, `createCodes(db, {kind, count, allowance, note})` (codes like `SAGE-XXXX-XXXX` from an unambiguous uppercase alphabet via `crypto.getRandomValues`; redeem normalises case and whitespace), `setContact`, `setVoice(db, code, voiceId, now)`, `clearVoice(db, code)`, `spendRound(db, code, now): Promise<boolean>` implemented exactly as `UPDATE codes SET used = used + 1, last_used_at = ? WHERE code = ? AND used < allowance` and returning `meta.changes === 1`, `refundRound(db, code)` (`used = used - 1 WHERE used > 0`), `listVoicesToClean(db, now)` returning codes where `kind != 'owner' AND voice_id IS NOT NULL AND ((used >= allowance AND last_used_at <= now - 1 hour) OR voice_created_at <= now - 7 days)`. **The one-hour grace is deliberate:** without it the hourly cron can delete a Voice clone between the last Round's start and its Replay. Rounds: `insertRound(db, {id, code, question_id})`, `getRound(db, id, code)` (scoped to the session's code, so one Guest can never read another's Round), `setConversationId`, `finishRound(db, id, {status, final_answer, best_self_text, rewrite_attempts, guard_failures})`, `failRound(db, id)`.
- **Migration 0002**: `ALTER TABLE rounds ADD COLUMN final_answer TEXT;` and `ALTER TABLE rounds ADD COLUMN best_self_text TEXT;` (A7 needs them for the audio endpoint; putting them here keeps migrations in one lane).
- **D1 fake** (`test/support/fakeD1.js` + `.d.ts`): a minimal `D1Database` over `node:sqlite` `DatabaseSync(":memory:")` that applies `migrations/*.sql` in order and implements `prepare(sql).bind(...).first()/all()/run()` (with `meta.changes`) and `batch`. JavaScript plus a declaration file because the repo has no `@types/node` and adding it is a dependency change. It is shared test infrastructure: Wave 2 imports it read-only.
- **Routes**: `redeem` (400 `bad_request` on missing code; 404 `invalid_code`; if the code has no Contact and none is given, 400 `contact_required`; Contact is an email or an X handle `@name`, validated loosely and stored trimmed; sets the cookie; returns `Me`). `me` returns `Me`. `createCodes` (Bearer `ADMIN_SECRET`; guest default Allowance 3, owner default 100, gift requires `allowance`; `count` 1 to 50). The five Wave 2 modules as stubs returning `501 {error:"bad_request"}` with the pinned exports and signatures, each with a header comment naming its Wave 2 owner.
- **Verify `pnpm build`** exits 0 with your `index.ts`, and that a `?raw` import of a `content/*.md` file bundles (then remove the throwaway import). Report the result either way; it is the assumption Wave 0 flagged.
- Boot check for your report: `pnpm db:migrate:local`, `pnpm dev`, then `curl -i localhost:5173/api/me` (expect 401) and `curl -i -X POST localhost:5173/admin/codes` (expect 401). Use a throwaway `.dev.vars` with random `SESSION_SECRET` and `ADMIN_SECRET` only if one does not exist; never commit it (it is gitignored) and never overwrite an existing `.dev.vars` (Mel's keys go there).

### A2: ElevenLabs and Nebius clients, transcript extraction, answer cleaning (spec tasks 2, 3, 5 support)

Owns exclusively: see table (A2 rows). Must not touch: anything A1, A3, A4 own. Uses `Env` from `src/worker/env.ts` (Wave 0).

Substance:

- **`eleven.ts`**: thin `fetch` wrappers, each taking `(env, args, fetchImpl = fetch)` so tests inject a fake fetch and assert URL, method, `xi-api-key` header and body. `addVoice(env, {name, sample: Blob, filename})` → `POST {ELEVEN_API_BASE}/v1/voices/add` multipart with `name` and `files` (field name `files`, per ELEVENLABS-FACTS section 1), `remove_background_noise` not sent; returns `{voice_id, requires_verification}`. `deleteVoice(env, id)` → `DELETE /v1/voices/{id}`; a 404 counts as already deleted. `getConversationToken(env)` → `GET /v1/convai/conversation/token?agent_id={AGENT_ID}` returns `{token}`. `getConversation(env, id)` → `GET /v1/convai/conversations/{id}` typed as `{status: "initiated"|"in-progress"|"processing"|"done"|"failed", transcript: TranscriptItem[]}`. `textToSpeech(env, voiceId, text)` → `POST /v1/text-to-speech/{voiceId}?output_format=mp3_44100_128` with `{text, model_id: env.TTS_MODEL}`, returning the raw `Response` so the caller streams its body. `listModels(env)`. Non-2xx throws a typed `UpstreamError` carrying status and a short body excerpt, never the key.
- **`nebius.ts`**: `chatText(env, {model, messages, temperature?, max_tokens?})` non-streaming, returns the assistant `content` with any `<think>...</think>` block removed (defensive; test it). `forwardChatCompletions(env, body: unknown): Promise<Response>`: copies the body, sets `model = env.COACH_MODEL`, `reasoning_effort = "none"`, `stream = true`, deletes `elevenlabs_extra_body`, POSTs to `{NEBIUS_API_BASE}/chat/completions` with the Nebius key, and returns Nebius's `Response` untouched (status, `content-type`, body stream). Tests assert the outgoing body and that the returned body is the same stream object, not a re-read copy.
- **`transcript.ts`**: the pure extraction the product's core promise rests on. `export type TranscriptItem = { role: "user" | "agent"; message: string | null; tool_calls?: { tool_name: string; params_as_json?: string; type?: string }[] | null; time_in_call_secs?: number }`. `extractFinalAnswer(items): {ok: true; answer: string; pushback: string} | {ok: false; reason: "no_save_answer" | "empty_answer"}`. Rule: find the **first** agent item whose `tool_calls` contains `tool_name === "save_answer"` (index s). Walk backwards from s - 1: collect user items with a non-blank message; skip agent items whose message is blank (tool-only turns); stop at the first agent item with a non-blank message, which is the Pushback. The final Answer is the collected user messages in original order joined with a single space. Fixtures under `test/fixtures/` are **synthetic** (written by you, no real person's words): happy path; Guest answers in several user turns; a tool-only agent item between the Answer and the save; `save_answer` with a spoken message on the same agent item (that message is not part of the Answer); no `save_answer` at all; `save_answer` straight after the Pushback with no user turn; null messages; `save_answer` called twice (first wins).
- **`clean.ts`**: `cleanAnswer(text)` for the second-failure fallback: removes standalone fillers (`um`, `uh`, `erm`, `er`, `uhm`, `hmm`, `mm`, case-insensitive, with their trailing comma), collapses an immediately repeated word ("I, I added" → "I added"), collapses whitespace, capitalises the first letter and ends with a full stop if there is no terminal punctuation. **Nothing added:** a property test asserts every word in the output (lowercased, punctuation stripped) appears in the input. Do not remove "like" or "you know": they are sometimes content, and removing content is worse than leaving a filler.
- **`evals/probe-2026-09-30/probe.mjs`**: a script the orchestrator runs once at gate 1→2 with Mel's OK, reading keys from `.dev.vars` (parse the file; never print values). `node probe.mjs models` prints model ids with `can_do_text_to_speech` and says whether `eleven_v4` is present. `node probe.mjs upload <file>` POSTs that file to `/v1/voices/add` with name `sage-probe-<timestamp>`, prints status, `voice_id` and `requires_verification`, then deletes **only that voice_id** and prints the delete status. It never lists or deletes any other voice.
- If `/v1/convai/conversations/{id}` fields differ from the shapes above in the current docs, stop and report; do not guess. (Shapes from STATUS 2026-09-29, verified in the docs that day.)

### A3: Content drafts for Mel's approval (spec task 8)

Owns exclusively: `content/*.md`, `content/README.md`. Must not touch any code. Nothing A3 writes is live until Mel approves it at gate 1→2.

Substance (English, glossary words, no em-dashes, one line per paragraph):

- `consent.md`: short, plain. The Guest confirms they are recording **their own voice**, that it makes a Voice clone used only to play their Replay back to them, that they can delete it any time with "Delete my voice", and that Guest Voice clones are deleted automatically after the Allowance is used up or after 7 days. Nothing the product does not do.
- `reading-script.md`: about 90 seconds read aloud (roughly 220 to 240 words), varied sounds (plosives, sibilants, numbers, a question, a list), a neutral topic, no personal data prompts. Include the word count on the last line as `<!-- words: N -->`.
- `rewrite-prompt.md`: the system prompt for MiniMax-M3. Requirements, all stated explicitly: 30 to 45 seconds spoken (about 80 to 115 words); situation, action, result, lesson, in that order; the Guest's register and own phrases; **use only facts the Guest said: no new numbers, tools, names, or outcomes; keep "we" as "we" and "I" as "I" exactly as spoken; keep hedges as hedges ("maybe half" stays approximate)**; a missing part (for example no result) is left out, never invented; first person; plain spoken text, no markdown, no lists, no em-dashes. Placeholders `{{question}}` and `{{answer}}`. A second section `## Retry addendum` with `{{failures}}`, used on the regenerate-once path.
- `sage-system-prompt.md` and `sage-first-message.md`: Sage is a warm, direct senior engineer who asks one sharp question, never lectures, never gushes. Flow: ask `{{question_text}}`; listen to the full Answer; make **exactly one** Pushback that is specific and grounded in something the Guest actually said (quote or paraphrase it); listen to the second attempt; call `save_answer` with `question_id` = `{{question_id}}`; then say exactly one closing line ("Now listen to your best self."). Never a second Pushback, never a model answer, never praise inflation, never mentions being an AI model or tools. Short spoken sentences. The first message greets briefly and asks `{{question_text}}`.
- `content/README.md`: one line per file saying what it is, where it is used (page, Worker, or agent config in Wave 3), and "Status: draft, awaiting Mel's approval".

### A4: Client page (spec task 6)

Owns exclusively: `index.html`, `src/client/**` (including `recorder.ts` in Wave 1), `public/**`. Must not touch Worker code, content files, or orchestrator files.

Substance:

- Vanilla TypeScript, no framework, no new dependency. Build against `src/shared/api.ts` only; the Worker bodies do not exist yet, so add a dev-only mock mode (`?mock=1`) that fakes every endpoint with the contract types, so every screen is clickable in Wave 1. Mock mode must not be reachable by accident in production (query flag only, no stored state).
- Screens in order: code + Contact → Consent (renders `content/consent.md?raw`; one checkbox "This is my own voice and I consent to cloning it", continue disabled until ticked; nothing records before this) → Voice sample (renders `content/reading-script.md?raw`; record, stop, play back, re-record, upload; show elapsed seconds; nudge to at least 60 s) → Question picker (the three Questions from `src/shared/questions.ts`, shows Allowance left) → Round (live) → Replay player → "Next question". A visible "Delete my voice" button whenever a Voice clone exists, with a confirm step.
- `recorder.ts`: `MediaRecorder` with the best supported of `audio/webm;codecs=opus`, `audio/mp4`; exports `startRecording(): Promise<{ stop(): Promise<Blob>; mimeType: string }>`. Uploads go as `multipart/form-data`, field `sample`, filename with the right extension. The probe at gate 1→2 decides whether WebM is accepted; keep this module self-contained so it can be swapped.
- Round screen: `POST /api/rounds` → `Conversation.startSession({ conversationToken, connectionType: "webrtc", dynamicVariables: { question_id, question_text }, clientTools: { save_answer } })`. The `save_answer` client tool returns immediately (`"saved"`), then the page waits for Sage's closing line to finish (the SDK's mode change from speaking to listening, or a 6 s cap, whichever first), calls `endSession()`, and only then `POST /api/rounds/:id/replay` with the `conversation_id` from the session. Show a clear "Building your Replay" state (the Worker may take 10 to 30 s). End the session on `pagehide` and on any error (billing runs while connected).
- Replay screen: fetch `audio_url` once into a Blob and play it from an object URL (each fetch is a paid TTS call); show `best_self_text` and, collapsed, `final_answer` ("What you said"). Show whether it was a `fallback` in plain words ("We kept your own words this time"). Save a `StoryBankEntry` to `localStorage` under `STORY_BANK_KEY`, one per Question, newest wins.
- Style: BUDDi tokens only, copied (not imported) from `code/agentcamp-buddy/apps/web/src/index.css`: the `--color-*` palette (ink `#0a0a0a`, paper `#fff9f5`, paper-dark `#fff0e8`, magenta `#c4177a` accent/CTA, violet `#7c3aed`, gold `#ffb800` as a fill only, danger `#dc2626`), the system font stack, and the neobrutalist primitives (hard 2 to 3 px ink borders, solid offset shadows). Mobile-first; it will be shown on a laptop in a call.
- Copy uses glossary words; never "agent", "credits", "AI coach bot". English only.
- Report: `pnpm build` output size, and screenshots or a written walk of every screen in mock mode.

## Gate 1 → 2

`HUMAN`. Wave 2 makes live calls with Mel's keys and wires content Mel has not yet approved.

Mechanical preconditions the orchestrator checks and reports before asking (each a command and its output in the report):

- `pnpm typecheck` exits 0; `pnpm test` passes with a count above the baseline of 5, stated per file; `pnpm build` exits 0.
- Local boot: `pnpm db:migrate:local && pnpm dev`, then `/api/me` without a cookie returns 401, `/admin/codes` without the bearer returns 401, and creating then redeeming a code with a Contact returns a `Me` and sets `sage_session`.
- `.dev.vars` exists and has non-empty `ELEVENLABS_API_KEY` and `NEBIUS_API_KEY` (check emptiness with `grep -c`; never print values).

What Mel decides at this gate:

1. Approve (or edit) each `content/*.md` file.
2. Authorise the probe: `node evals/probe-2026-09-30/probe.mjs models`, and `upload` with a ~30 s WebM/Opus recording of **Mel's own voice** (for example recorded in the page's mock mode and saved, or with QuickTime then `ffmpeg -i in.m4a -c:a libopus out.webm`). It creates and then deletes exactly one voice.

Named blanks this gate fills (they may only narrow the plan): `TTS_MODEL` (`eleven_v4` if listed with `can_do_text_to_speech`, else `eleven_multilingual_v2`), which the orchestrator writes to `wrangler.jsonc`; and `UPLOAD_FORMAT` (`webm` accepted, or `transcode`, in which case A5 takes `src/client/recorder.ts` and makes the browser produce an accepted format).

Does not gate this wave: the Sage agent (Wave 3), the public URL choice, the marketing plan, privacy beyond Tier A, ACR-019.

## Wave 2 assignments

Starts when A1 and A2 are merged and gate 1→2 is crossed. Every Wave 2 agent may use `.dev.vars` keys for **at most the live calls listed in its assignment**, keeps each under a minute, and reports every live call it made. No agent creates, edits or deletes the ElevenLabs agent; no agent deletes any voice it did not create in that same test.

**A local test agent for Wave 2.** A6's and A7's live checks need an agent id. The orchestrator creates, with Mel's OK at gate 1→2, one private test agent via the ElevenLabs MCP (`agents_create`) using the approved Sage prompt and the built-in LLM (Custom LLM needs a public URL, which only exists after Wave 3), puts its id in `.dev.vars` as `AGENT_ID` for local runs, and records it in the ledger. It is replaced by the real agent in Wave 3 and its deletion is a Mel decision.

### A5: Voice clone and cleanup (spec task 2)

Owns exclusively: `src/worker/routes/voice.ts`, `src/worker/cleanup.ts`, `test/voice.test.ts`, `test/cleanup.test.ts`; `src/client/recorder.ts` only if `UPLOAD_FORMAT = transcode`. Must not touch `index.ts`, `db.ts`, `eleven.ts` (A1, A2, merged) or any other Wave 2 file.

- `addVoice`: requires the cookie; 409 `voice_exists` if the code already has a `voice_id` (the Guest deletes first; this prevents leaking voice slots, Creator has 30); reads multipart field `sample`; 400 if missing or larger than 20 MB; calls `eleven.addVoice` with name `sage-<kind>-<first 8 hex of SHA-256(code)>` (never the Contact, never the raw code); on `requires_verification: true` deletes that just-created voice and returns 422 `voice_verification_required`; otherwise `setVoice` and return `{hasVoice: true}`.
- `deleteVoice`: calls `eleven.deleteVoice` then `clearVoice`; allowed for every kind including owner (it is the Guest's explicit action). Returns `{hasVoice: false}`.
- `cleanupVoices(env, now)`: `listVoicesToClean`, delete each via the API, `clearVoice` on success or 404, count failures, never throw for one bad voice. It must never touch an owner code (the query excludes them; a test proves it).
- Tests with the D1 fake and a fake fetch for every branch above, including the one-hour grace window and the 7-day rule.
- Live calls allowed: none beyond what the probe already proved. The end-to-end upload happens in Wave 3.

### A6: Rounds and the LLM pass-through (spec tasks 3, 4)

Owns exclusively: `src/worker/routes/rounds.ts`, `src/worker/routes/llm.ts`, `test/rounds.test.ts`, `test/llm.test.ts`, `evals/probe-2026-09-30/proxy-ttft.mjs`. Must not touch `index.ts`, `db.ts`, `nebius.ts`, `eleven.ts` or other Wave 2 files.

- `startRound`: `findQuestion` or 400 `unknown_question`; no Voice clone → 409 `voice_required` **before** spending; `spendRound` false → 403 `allowance_used`; insert the Round (id `crypto.randomUUID()`); mint the token; if minting fails, `refundRound` + `failRound` and return 502 `upstream_error` (the Guest must not lose a Round to an upstream error). Return `StartRoundResponse`.
- `chatCompletions`: `requireBearer(LLM_PROXY_SECRET)` or 401; parse JSON or 400; return `nebius.forwardChatCompletions(env, body)` as is. No logging of message content.
- Tests: allowance exhaustion (the third Round of a 3-Round code succeeds, the fourth fails), refund on mint failure, no spend when the Voice clone is missing, both proxy paths, bad bearer.
- `proxy-ttft.mjs`: measures time to first SSE content token through a given base URL (default local dev) with the bearer from `.dev.vars`, 5 runs, prints the median. Live calls allowed: run it 5 times against local dev (Nebius spend is negligible). Spec task 4's "measure TTFT through the proxy" is this; the deployed re-run is Wave 3.

### A7: Replay (spec task 5)

Owns exclusively: `src/worker/routes/replay.ts`, `src/worker/rewrite.ts`, `test/rewrite.test.ts`, `test/replay.test.ts`. Must not touch `index.ts`, `db.ts`, `guards.ts`, `transcript.ts`, `clean.ts`, `nebius.ts`, `eleven.ts` or content files.

- `rewrite.ts`: `bestSelfAnswer({question, answer}, deps)` with injectable `chatText`. Load the prompt from `content/rewrite-prompt.md?raw` and fill `{{question}}`, `{{answer}}`. Attempt 1 → `checkBestSelfAnswer(answer, rewrite)`; on failures, attempt 2 with the retry addendum filled with `describeFailures(failures)`; on second failure, `cleanAnswer(answer)` with status `fallback`. Replace any em-dash in model output with a comma and space. Returns `{status, text, attempts, failures}` where `failures` is every failure from every attempt. Tests cover pass first time, pass on retry, fallback after two failures, a `chatText` exception (treat as a failed attempt, never as a pass), and that fallback text passes the "nothing added" property.
- `replay`: `getRound` scoped to the session or 404; status not `started` → 409 `round_already_replayed` (no double spend); `setConversationId`; poll `eleven.getConversation` every 1.5 s, **at most 20 polls** (Workers Free: 50 subrequests per request), until `done` (→ continue) or `failed` (→ `failRound`, 502 `conversation_failed`); exhausted → 504 `conversation_timeout` and leave the Round `started` so the page can retry once. `extractFinalAnswer` → 422 with its reason on failure (and `failRound`). Rewrite, then `finishRound` with status, texts, attempts and `guard_failures` as JSON. Return `ReplayResponse` with `audio_url: /api/rounds/<id>/audio`.
- `audio`: `getRound` scoped to the session; requires status `replayed` or `fallback` and a Voice clone; returns `eleven.textToSpeech(env, voice_id, best_self_text).body` streamed with `content-type: audio/mpeg`. No buffering, no base64 (10 ms CPU).
- Live calls allowed: one rewrite of the synthetic fixture Answer through MiniMax-M3 via `chatText`, reported with its guard result. No live TTS in Wave 2 (it needs a real Voice clone; that is Wave 3).

## Gate 2 → 3

`HUMAN`. Wave 3 is production, spend and ElevenLabs workspace changes; every step is on the stop-and-ask list.

Mechanical preconditions reported first: `pnpm typecheck` exits 0; `pnpm test` passes with per-file counts at least those recorded at gate 1→2 plus the new Wave 2 files; `pnpm build` exits 0; local boot smoke from gate 1→2 still passes; `grep -rn "sk_\|xi-api-key.*[a-z0-9]\{20\}" src content evals test` finds no key material; `git log --format=%ae tier-a` shows only `19479678+troopdegen@users.noreply.github.com` after `781345a`; A6's local TTFT median.

## Wave 3: deploy and the live Round (orchestrator with Mel; spec tasks 7, 9)

Not dispatched to agents: every step touches production, spend or the ElevenLabs workspace. In order, each with Mel's go:

1. Merge `tier-a` into `main` locally (no push; there is no remote).
2. `pnpm wrangler d1 create buddi-sage`, write `database_id` into `wrangler.jsonc`, `pnpm db:migrate:remote`.
3. `pnpm wrangler secret put` for the five secrets (Mel pastes values; `LLM_PROXY_SECRET` freshly generated with `openssl rand -hex 32`).
4. `pnpm deploy`; note the `*.workers.dev` URL.
5. Store `LLM_PROXY_SECRET` as an ElevenLabs workspace secret, then create the Sage agent (MCP `agents_create` or REST): voice Jen `QLAlOeRuLwKX0skeTR7R`; approved system prompt and first message; dynamic variables `question_id`, `question_text`; client tool `save_answer` (param `question_id`, expects response on); LLM `CUSTOM_LLM` with `url` `https://<worker>/llm/v1`, `model_id` the coach model, `api_key` the workspace secret reference; `enable_auth` true; `max_duration_seconds` 300; `agent_concurrency_limit` 1; `daily_limit` 20; `bursting_enabled` false; no overrides enabled; agent TTS model an English-capable option from the allowed enum (ELEVENLABS-FACTS section 8). Verify each field by reading the agent back (`agents_get`).
6. Put the agent id in `wrangler.jsonc` `AGENT_ID`, redeploy.
7. `POST /admin/codes {kind:"owner"}`; Mel redeems it.
8. Mel runs one full Round on the live URL: Consent, Voice sample, Question, Answer, Pushback, second Answer, save, Replay in their own voice. Record conversation id, Replay status, guard failures, and time from save to audio.
9. Re-run `proxy-ttft.mjs` against the deployed URL.

If the Custom LLM URL shape is wrong (ELEVENLABS-FACTS section 5 marks base vs full path as unconfirmed), the router already accepts both `/llm/v1/chat/completions` and `/llm/chat/completions`; check Worker logs (`wrangler tail`) for the path actually hit before changing anything.

## Gate 3 → done

`HUMAN`, terminal. Mel judges the live Round. Done means: step 8 completed on the live URL and Mel heard the Replay in their own voice; the ledger, a `WAVE-3-REPORT.md`, the Builder Journal entry and STATUS are written. What remains open (the test agent's deletion, the public URL, Tier B) goes to Mel as numbered decisions.

## Gate contract (for `/ultracode-epic`)

| Gate | Decision | Mechanical condition | Evidence command |
|---|---|---|---|
| 0 → 1 | `AUTO if` `pnpm typecheck` exits 0 AND `pnpm test` reports 5 passed, 0 failed, 1 file AND `git diff --name-only 781345a..tier-a` lists exactly the Wave 0 files | as stated | `cd code/buddi-sage && pnpm typecheck; echo $?; pnpm test 2>&1 \| tail -5; git diff --name-only 781345a..tier-a` |
| 1 → 2 | `HUMAN` | content approval, live keys and the probe are Mel's | preconditions listed under gate 1→2 |
| 2 → 3 | `HUMAN` | Wave 3 is production and spend | preconditions listed under gate 2→3 |
| 3 → done | `HUMAN` | terminal; Mel runs the live Round | step 8 record |

## Constraints (copy verbatim into every agent prompt)

- **Secrets never land in a tracked file, a test fixture, a log line, a commit message, or your report.** Keys live in `.dev.vars` (gitignored) and `wrangler secret`. Never print a key; check presence with `grep -c`. Why: a leaked ElevenLabs key can clone voices and spend on Mel's account, and a secret in git history is not remediated by a force-push.
- **Never create, overwrite or `cat` `code/buddi-sage/.dev.vars`** except A1 creating it only when absent, with random local-only values and no API keys. Why: Mel puts real keys there; overwriting them silently breaks every later live call and loses them.
- **The Replay never adds a fact the Guest did not say.** Any code path that could put model-generated content in front of the Guest without `checkBestSelfAnswer` is a defect. Why: it is the product's one promise, and it is what Mel will be asked about on the ElevenLabs call.
- **No ElevenLabs workspace changes by agents.** No agent creates, updates or deletes an agent, tool, secret or voice through the MCP or REST, except a voice your own test created in that same run and only where your assignment lists it. Why: the MCP login can delete everything in Mel's workspace, including Mel's own voices; there is no undo.
- **Live calls only where your assignment lists them, each short.** Why: Creator includes 75 agent minutes a month and ElevenLabs credits are real money; an unattended loop can burn the month.
- **Do not change dependencies.** No edits to `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; no `pnpm add`. If you need a package, stop and report. Why: parallel worktrees make lockfile conflicts expensive, and pnpm's `minimumReleaseAge` already bit this repo (`@elevenlabs/client` resolved to 1.25.0).
- **Do not run** `wrangler deploy`, `pnpm deploy`, `wrangler d1 create`, `wrangler d1 ... --remote`, `pnpm db:migrate:remote` or `wrangler secret put`. Why: they change production, which is Wave 3 and Mel's call.
- **Glossary words exactly** (`CONTEXT.md`). No em-dashes anywhere, including code comments and commit messages.
- **Do not re-litigate locked decisions** (models, voice Jen, Rounds as the Allowance unit, D1, Worker on Cloudflare Free, the two Tier A guard rules, English only). If one looks wrong, say so in your report and build to the decision.
- **Git:** commit on your own branch in your worktree, as `19479678+troopdegen@users.noreply.github.com` (`git -c user.email=19479678+troopdegen@users.noreply.github.com -c user.name=Mel commit ...`). Never merge, rebase onto, push, or touch `main` or `tier-a`. Never `git stash` (the stash is shared across worktrees).

## Definition of done (every agent)

- `pnpm typecheck` exits 0.
- `pnpm test` green, with **before and after counts stated per test file** (baseline: 5 tests in `test/guards.test.ts`).
- New behaviour has tests on every branch and error path your assignment lists.
- Each new module starts with a header comment stating the decision it encodes (see `guards.ts` for the style).
- No `console.log` in `src/` (Workers observability is on; use `console.error` only for upstream failures, with no secrets and no Guest words). No `TODO` without an owner and a task number.
- Commits explain why, not only what.
- Nothing deployed, merged or pushed; no ElevenLabs workspace changes beyond your assignment.
- A structured report: `status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`, files touched, test counts before and after, every live call made, every declared crossing, and concerns.
- **If a task turns out to be wrong or already done, say so and stop rather than building it anyway.**

## External dependencies

| Dependency | Status |
|---|---|
| `POST /v1/voices/add` multipart `name` + `files`, returns `voice_id`, `requires_verification` | verified in docs 2026-09-29 |
| WebM/Opus accepted by `/v1/voices/add` | **assumed; the gate 1→2 probe decides** |
| `GET /v1/convai/conversation/token?agent_id=` returns `token` | verified in docs; token lifetime unknown, so mint right before `startSession` |
| `GET /v1/convai/conversations/{id}` status + transcript shape | verified in docs 2026-09-29 (STATUS) |
| `eleven_v4` on plain `/v1/text-to-speech` | **assumed; docs conflict; the probe's `models` decides `TTS_MODEL`** |
| Custom LLM `url` is the base (`.../llm/v1`) vs the full path | **assumed; router accepts both; Wave 3 logs confirm** |
| ElevenLabs tolerates Nebius SSE extras (`reasoning_content`) | **assumed; Wave 3 live Round confirms** |
| Nebius honours `reasoning_effort: "none"` for DeepSeek-V4-Pro-0813 | measured 2026-09-29 (NEBIUS-MODEL-CHOICE) |
| Vite `?raw` imports in the Worker bundle and Vitest | **assumed; A1 verifies with `pnpm build`** |
| `node:sqlite` in the test runtime | verified: Node 22.23.2 loads it (experimental warning only) |
| `@elevenlabs/client` `Conversation.startSession({conversationToken, connectionType: "webrtc", dynamicVariables, clientTools})` | verified in docs; A4 checks the installed 1.25.0 typings match before relying on them |
