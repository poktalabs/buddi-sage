# WAVE 1 REPORT: BUDDi Sage Mode Tier A

2026-09-29. Four agents (A1 to A4), workflow run `wf_51ed7ab4-00f`, about 538k subagent tokens, about 12 minutes wall clock. All four returned `DONE_WITH_CONCERNS`. All merged into `tier-a` (now `b59ffa6`), local only.

## 1. Result

| Measure | Baseline (`92c377b`) | Now (`b59ffa6`) |
|---|---|---|
| Test files | 1 | 18 |
| Tests passing | 5 | 184 |
| `test/guards.test.ts` | 5 | 5 (unchanged) |
| `pnpm typecheck` | exit 0 | exit 0 |
| `pnpm build` | not runnable (no Worker entry) | exit 0 (Worker plus client; the lazy SDK chunk is 573 kB, 150 kB gzip) |

Per agent: A1 +5 files / +76 tests (session 13, db 26, access 11, admin 7, index 19); A2 +4 / +52 (eleven 17, nebius 14, transcript 12, clean 9); A3 none (doc-only lane); A4 +8 / +51 (under `test/client/`).

## 2. Gate conditions (from GATE-1-CHECKLIST.md, run by the orchestrator)

| Condition | Result | How checked |
|---|---|---|
| Ownership, per branch | PASS | `git diff --name-only tier-a...HEAD` in each worktree against the collision table; no overlaps; declared crossings only (A1 `test/index.test.ts`, A4 `test/client/*.test.ts`, `public/favicon.svg`) |
| Authors | PASS | `git log --format=%ae`: only `19479678+troopdegen@users.noreply.github.com` |
| Secrets | PASS | pattern greps on diffs and commit bodies: 0 / 0; tracked `.dev.vars`/`.env`: 0 |
| Dependencies | PASS | `package.json`/lockfile/workspace in diffs: 0 |
| DoD greps | PASS | `console.log` in `src`: 0; unowned TODO: 0; em-dashes in diffs and commit bodies: 0 |
| Typecheck and tests per branch | PASS | re-run in each worktree: A1 6/81, A2 5/57, A4 9/56; matches claims |
| After each merge | PASS | 81 → 133 → 133 → 184, typecheck 0 each time |
| `wrangler.jsonc` | PASS | diff adds only `"triggers": { "crons": ["17 * * * *"] }` |
| Atomic spend, owner exclusion | PASS | `db.ts:95` exact `UPDATE ... WHERE code = ? AND used < allowance`; cleanup query `kind != 'owner'` |
| Ten routes, both LLM paths | PASS | read `src/worker/index.ts` route table |
| `?raw` assumption | PASS | A1 bundled a throwaway `?raw` import (content string present in `dist`); merged build bundles the page's `?raw` imports |
| Probe safety | PASS | `probe.mjs` calls only `POST /v1/voices/add` and `DELETE /v1/voices/{the id it created}` |
| A3 content checks | PASS | no `PENDING DRAFT`; word count 226 declared vs 230 `wc -w`; rewrite placeholders 4/4 present |
| Consent before microphone | PASS | `getUserMedia` only in `recorder.ts` (Voice sample screen, after Consent) and `microphone.ts` (Round screen, needs a Voice clone) |
| Mock mode not reachable in production | PASS | `?mock=1` AND a loopback host (stricter than the plan) |
| Local boot smoke on merged `tier-a` | PASS | `pnpm db:migrate:local` exit 0; `pnpm dev`: `/api/me` 401, `/admin/codes` 401 without bearer, create code 200, redeem without Contact `contact_required`, redeem with Contact 200 `Me` plus `sage_session` cookie, `/api/me` with cookie 200, `/api/rounds` stub 501, `/` 200 |

## 3. The check that mattered most

The per-merge test re-run. Each branch was green alone, but the rule that decided safety was that 81 → 133 → 184 grew by exactly each branch's own new tests and `guards.test.ts` stayed at 5, so no merge silently broke or shadowed another lane's tests. A close second: A1 actually proved the `?raw` assumption with a bundled string, rather than assuming it.

## 4. Decisions Mel owns at gate 1 → 2

1. **Approve the content** (read on `tier-a`, `code/buddi-sage/content/`): `consent.md`, `reading-script.md`, `rewrite-prompt.md`, `sage-system-prompt.md`, `sage-first-message.md` (`README.md` says where each is used). Two points to decide as you read: (a) A3 added one true sentence to Consent, "your Voice sample is sent to ElevenLabs to make your Voice clone", arguing informed Consent needs it; (b) Consent says Guest Voice clones are deleted "once your Allowance is used up", while the cleanup waits one hour after the last Round (so the last Replay can still play). Say whether you want "shortly after".
2. **Keys in `code/buddi-sage/.dev.vars`** (the primary checkout; it does not exist yet): `ELEVENLABS_API_KEY`, `NEBIUS_API_KEY` (dedicated), plus `LLM_PROXY_SECRET`, `SESSION_SECRET`, `ADMIN_SECRET` as `openssl rand -hex 32` values. Template: `.dev.vars.example`.
3. **Authorise the probe** (creates one voice from your own recording, then deletes exactly that voice): record about 30 s in the page's mock mode (`pnpm dev`, open `http://localhost:5173/?mock=1`, record, then "save this sample as a file"), then I run `node evals/probe-2026-09-30/probe.mjs models` and `... upload voice-sample.webm`. This fills `TTS_MODEL` and `UPLOAD_FORMAT`.
4. **Authorise the Wave 2 test agent**: one private Sage agent on ElevenLabs' built-in LLM (the Custom LLM needs the deployed URL), used only for local checks, replaced in Wave 3. Its later deletion stays your call.
5. **Question wording** (optional): `src/shared/questions.ts` has "a model or agent you worked on failed in production". A4 flagged "agent" as user-facing copy. It means AI agents as an interview topic, not Sage, so I recommend keeping it.

## 5. Deviations accepted

| Agent | Deviation | Why accepted |
|---|---|---|
| A1 | Badly formed Contact → 400 `bad_request`; `contact_required` only when missing | Contract list is fixed; distinct and correct |
| A1 | Unhandled throw → 500 `upstream_error` JSON | Keeps "error bodies are always ApiError"; logs name only |
| A1 | `finishRound`/`failRound` return boolean and act only on `started` Rounds | Prevents a double Replay write; A7 must honour the boolean |
| A1 | Extra exports (`normaliseCode`, `testEnv`, types) | Additive, inside A1 files |
| A2 | `chatText` throws on empty content after stripping thinking | An empty rewrite would pass the guards vacuously |
| A2 | `forwardChatCompletions` throws `TypeError` for a non-object body | A6 maps it to 400 |
| A2 | Positional args on some client functions; fixtures as a `.ts` module | tsconfig has no `resolveJsonModule` (orchestrator-owned) |
| A3 | Consent names ElevenLabs as the processor | True; Mel decides at approval (decision 1a) |
| A3 | Rewrite prompt bans casual number words ("one thing") | Matches `guards.ts` NUMBER_WORDS, avoids false retries |
| A4 | Microphone check before `POST /api/rounds` | A blocked mic never spends a Round |
| A4 | Mock mode needs a loopback host too | Stricter than the plan; never reachable on workers.dev |
| A4 | "Delete my voice" disabled (still visible) during a live Round and while the Replay builds | Deleting then would break the Replay |
| A4 | Consent shown again after "Delete my voice" | The contract stores no Consent; showing it again is the safe side |

## 6. Carried into Wave 2

- A6: wrap `forwardChatCompletions`: `TypeError` → 400 `bad_request`, network rejection → 502 `upstream_error`; the router does no auth for `/llm/*`, call `requireBearer` in the handler.
- A7: pass a generous `max_tokens` (about 4000) to MiniMax-M3: it thinks by default and Nebius ignores the toggle, so a small budget returns empty content and every Replay would fall back. Split `content/rewrite-prompt.md` on `## Retry addendum` (do not send the heading) and send a short user message. `finishRound(..., guard_failures: GuardFailure[])` stringifies itself and returns false if the Round is no longer `started`.
- A5: `listVoicesToClean` returns `[{code, voice_id}]`, owner codes already excluded.
- All: tests use `import { createFakeD1, testEnv } from './support/fakeD1'`.
- Wave 2 worktrees each need their own `.dev.vars` (Wrangler reads it from the working dir). The orchestrator copies Mel's file into each Wave 2 worktree only for lanes with listed live calls (A6, A7), never into git.
- Wave 3 checks (from concerns): the live transcript, because `extractFinalAnswer` treats any Sage backchannel ("mm-hmm") during the second attempt as the Pushback and would cut the Answer short (A3); time from `save_answer` to `endSession` (A4's 6 s cap); Safari may drop the `Secure` cookie on plain-http localhost, so test locally in Chrome (A1).

## 7. Human-track items (not blockers)

- **Tier B design issue (A1):** Allowance, Contact and the Voice clone are all per code. If a Guest code is shared widely, as CONTEXT.md intends, the second person could hear a Replay in the first person's Voice clone or delete it. Harmless for Tier A (Mel only). Tier B must pick one code per person or per-redeemer identity before opening to testers.
- `pnpm-workspace.yaml` still has the `allowBuilds` placeholders for esbuild and workerd, so `pnpm install` exits non-zero (packages and binaries install fine). Pre-existing on `main`; worth answering before deploy tooling depends on a clean install exit.
- `created_at` uses SQLite `datetime('now')` while `db.ts` writes ISO timestamps; nothing compares them today.

## 8. Where the work is

- Integration branch `tier-a` @ `b59ffa6` in `code/buddi-sage` (no remote; nothing pushed). `main` is untouched at `781345a`.
- Agent branches (merged): `wave1/a1-access`, `wave1/a2-clients`, `wave1/a3-content`, `wave1/a4-client`.
- Worktrees kept for diagnosis until the epic ends: `code/.worktrees/sage-a1-access` (now detached at `b59ffa6`, used for the smoke; holds a keyless local `.dev.vars`), `sage-a2-clients`, `sage-a3-content`, `sage-a4-client`.

Unverified: no live call of any kind has run (no keys). The recorder was never exercised with a real microphone (the headless browser had none); record once in mock mode on the laptop, which is also the probe sample. The `@elevenlabs/client` session code is checked against the 1.25.0 typings only.
