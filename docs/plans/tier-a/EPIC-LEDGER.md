# EPIC buddi-sage Tier A: ledger

Append-only run record for `/ultracode-epic`. The contract below is frozen; it may only change by an `AUTO` → `HUMAN` downgrade or by filling a named blank. Anything else is a new contract and needs Mel.

## Contract: FROZEN 2026-09-29 (Mel: "go")

| Gate | Decision | Mechanical condition | Evidence command |
|---|---|---|---|
| 0 → 1 | `AUTO` | `pnpm typecheck` exits 0 AND `pnpm test` reports 5 passed, 0 failed, 1 test file AND `git diff --name-only 781345a..tier-a` lists exactly the Wave 0 files (`src/shared/api.ts`, `src/worker/env.ts`, `src/raw.d.ts`, `content/consent.md`, `content/reading-script.md`, `content/rewrite-prompt.md`, `content/sage-system-prompt.md`, `content/sage-first-message.md`, plus `docs/plans/tier-a/*`) | `cd code/buddi-sage && pnpm typecheck; echo $?; pnpm test 2>&1 \| tail -5; git diff --name-only 781345a..tier-a` |
| 1 → 2 | `HUMAN` | n/a (content approval, live keys, probe authorisation) | preconditions in IMPLEMENTATION-PLAN "Gate 1 → 2" |
| 2 → 3 | `HUMAN` | n/a (production and spend) | preconditions in IMPLEMENTATION-PLAN "Gate 2 → 3" |
| 3 → done | `HUMAN` | terminal; Mel runs the live Round | Wave 3 step 8 record |

Named blanks (filled at gate 1 → 2, may only narrow): `TTS_MODEL` (`eleven_v4` if listed with `can_do_text_to_speech`, else `eleven_multilingual_v2`); `UPLOAD_FORMAT` (`webm` or `transcode`).

## Circuit breakers

Skill-level (end the epic, override any `AUTO`): sensitive-data or secret hit in any diff or commit message; dependency or lockfile change by any agent; an agent returns `BLOCKED` or `NEEDS_CONTEXT`; test count fell in any file; a merge broke the build (after one redispatch); undeclared lane crossing or two agents on one file; provider spend, deployment, production access or regulated data beyond what the entry point pre-authorises.

Project's own list, verbatim from ENTRY-POINT.md "Where you stop and ask Mel":

- Missing keys. Mel puts the ElevenLabs API key and a dedicated Nebius key in `code/buddi-sage/.dev.vars`. No live call before that. (As of 2026-09-29 `.dev.vars` does not exist.)
- Content approval: Consent text, reading script, rewrite prompt, Sage system prompt and first message, before any of it goes live in the agent or the deployed page.
- Any push to a remote or any PR. The repo has no remote. Never without Mel's explicit go.
- Deleting anything in the ElevenLabs workspace. The MCP login can delete everything, including Mel's own voices and other agents.
- Spending beyond the plan: Creator includes 75 agent minutes per month. Keep test calls short; no background or looping live calls.
- Anything touching production: `wrangler d1 create`, `wrangler secret put`, `wrangler deploy`, remote migrations, creating or updating the ElevenLabs agent.
- A locked decision that looks wrong. Report it; do not re-decide it.

## Pre-flight: 2026-09-29

Gate 0 → 1 (the only `AUTO` row): crossable today. On `main` @ `781345a`: `pnpm typecheck` exit 0; `pnpm test`: `Test Files 1 passed (1)`, `Tests 5 passed (5)`. The evidence command needs no keys, network or production access.

## Baseline

`main` @ `781345a`. Tests: `test/guards.test.ts` 5 passed; 1 test file total. Typecheck clean. `.dev.vars` absent.

## Run record

### Wave 0: 2026-09-29 21:16 (orchestrator contract commit, no agents)

Branch `tier-a` cut from `main` @ `781345a`. Commit `7a6a726` (author `19479678+troopdegen@users.noreply.github.com`): `src/shared/api.ts`, `src/worker/env.ts`, `src/raw.d.ts` verbatim from IMPLEMENTATION-PLAN "Wave 0"; five `content/*.md` placeholders; plan docs.

### Gate 0 → 1: CROSSED

Contract row: "`AUTO` if `pnpm typecheck` exits 0 AND `pnpm test` reports 5 passed, 0 failed, 1 test file AND `git diff --name-only 781345a..tier-a` lists exactly the Wave 0 files".

Evidence, run by the driver after the commit:

```
typecheck exit=0
 Test Files  1 passed (1)
      Tests  5 passed (5)
git diff --name-only 781345a..tier-a:
content/consent.md
content/reading-script.md
content/rewrite-prompt.md
content/sage-first-message.md
content/sage-system-prompt.md
docs/plans/tier-a/ENTRY-POINT.md
docs/plans/tier-a/EPIC-LEDGER.md
docs/plans/tier-a/IMPLEMENTATION-PLAN.md
src/raw.d.ts
src/shared/api.ts
src/worker/env.ts
```

Circuit breakers checked: no `package.json`/lockfile change (not in diff); no secrets (files are types, placeholders and plan prose; `.dev.vars` absent); no agents ran; no spend, deploy or ElevenLabs change. Integration state: `tier-a` @ `7a6a726` plus this ledger append, local only, no remote.

### Wave 1: dispatched 2026-09-29

`/ultracode-wave 1`. Worktrees in `code/.worktrees/`: `sage-a1-access` (`wave1/a1-access`), `sage-a2-clients` (`wave1/a2-clients`), `sage-a3-content` (`wave1/a3-content`), `sage-a4-client` (`wave1/a4-client`), all from `tier-a` @ `92c377b`; declared in the workstream BRIEF. Branch prefix is `wave1/` because git refuses `tier-a/<x>` while a branch named `tier-a` exists. `pnpm install --frozen-lockfile` exited non-zero in each code worktree with `ERR_PNPM_IGNORED_BUILDS` (esbuild, workerd): the pre-existing `allowBuilds` placeholders in `pnpm-workspace.yaml`; packages and platform binaries are installed and baseline typecheck/test are green in the worktree. Gate checklist committed first: `da09cc1` `GATE-1-CHECKLIST.md`. Workflow run `wf_51ed7ab4-00f`.

### Wave 1: completed 2026-09-29

Four agents returned `DONE_WITH_CONCERNS`. The driver re-ran GATE-1-CHECKLIST on each worktree: ownership via three-dot diff clean (declared crossings only: A1 `test/index.test.ts`, A4 `test/client/*`, `public/favicon.svg`); authors all `19479678+troopdegen@users.noreply.github.com`; secrets 0/0/0; dependency files 0; `console.log` 0; unowned TODO 0; em-dashes 0. Per-branch typecheck 0 and tests A1 6 files/81, A2 5/57, A4 9/56 (A3 is doc-only). Merged one at a time into `tier-a`: `fd3c409` (A1) 6/81, `ddd84fe` (A2) 10/133, `3700146` (A3) 10/133, `b59ffa6` (A4) 18/184; typecheck 0 after each. `pnpm build` on `b59ffa6`: built (Worker plus client). Local boot smoke on `b59ffa6`: `/api/me` 401, `/admin/codes` 401 without bearer, `contact_required` without Contact, redeem with Contact 200 plus `sage_session` cookie, `/api/me` 200 with cookie, `/api/rounds` 501 stub, `/` 200. Report: `WAVE-1-REPORT.md`.

### Gate 1 → 2: HELD

Contract row: "`HUMAN` | n/a (content approval, live keys, probe authorisation)". Circuit breakers checked: none fired (no secret hit, no dependency change, no BLOCKED/NEEDS_CONTEXT, no test count fell, no build broke, no undeclared crossing, no spend or deploy). Held for Mel's five decisions listed in WAVE-1-REPORT section 4. Integration state: `tier-a` @ `b59ffa6` plus report/ledger commit, local only, nothing pushed.

### Gate 1 → 2: Mel's answers, 2026-09-29 (gate still HELD)

Mel's reply to the five decisions: (1) content: review it first with a Pi coding agent on `nebius/deepseek-ai/DeepSeek-V4-Pro-0813` under a taste-and-efficiency reviewer persona (`content-review/REVIEWER-PERSONA.md`, brief `content-review/REVIEW-BRIEF.md`, run read-only with `-t read`); approval follows the review. (2) Keys: Mel fills `code/buddi-sage/.dev.vars`. (3) Probe: Mel records and tests. (4) Test agent: "use it/do it". (5) Question wording: accepted as is.

Decision 4 executed: client tool `save_answer` `tool_8901m3r84ac3emfsg8g1vyrtwed7` (client, expects_response true, pre_tool_speech off, `question_id` bound to the `question_id` dynamic variable). Agent `<agent-id>` "Sage (Tier A test, built-in LLM)": draft A3 prompt and first message, tool attached, `enable_auth` true, `max_duration_seconds` 300, `agent_concurrency_limit` 1, `daily_limit` 20, `bursting_enabled` false, every override false (the default `text_only` override was switched off), built-in LLM `qwen35-397b-a17b`. Verified by reading the agent back. Not done: voice Jen `QLAlOeRuLwKX0skeTR7R` returns `voice_not_found`; it must be added to My Voices first (a workspace voice slot, Mel's click). Process note: `agents_create` with a `body` silently dropped the top-level prompt, first message, voice, name and tags; the fix was one `agents_update` with everything inside `body`.

### Content review: 2026-09-29 (gate still HELD)

First Pi run (read tool, all five files) killed at the 30-minute background limit with no output. Diagnosis: DeepSeek-V4-Pro-0813 reasons by default; a direct stream spent a 3,000-token budget entirely on `reasoning_content` (13,115 chars, 0 content). Pi 0.87 then hung on every variant tried (default, `--thinking off`, `--thinking low`, and a scratch `PI_CODING_AGENT_DIR` enabling `supportsReasoningEffort`), each timing out at 280 to 300 s with no output; Mel's `~/.pi` was not modified. The same request direct to Nebius: `reasoning_effort: "none"` 3.2 s, `"low"` 12.4 s. Deviation from Mel's "run it against a Pi Coding Agent": the review ran through `content-review/run-review.mjs` (same persona, model and per-file prompts; `reasoning_effort: "low"`). Results: consent SHIP WITH EDITS (27 s), reading-script SHIP unchanged (17 s), rewrite-prompt SHIP WITH EDITS (43 s), sage-system-prompt SHIP WITH EDITS (57 s), sage-first-message SHIP WITH EDITS (17 s). Driver checks on the revised blocks: em-dashes 0; required placeholders present. Combined: `content-review/REVIEW-DeepSeek-V4-Pro.md`. Not applied; awaiting Mel.

### Content approved and applied: 2026-09-30 (gate still HELD)

Mel: "apply". Commit `cec4535` writes the reviewed versions into `content/` with the two driver changes Mel accepted (Sage step 1 keeps "already asked in your first message"; first message keeps a one-line Round format). Typecheck 0, tests 18 files / 184 after the change. Test agent updated to the approved prompt and first message (version `agtvrsn_8501m3sd2c0ce4zsq73p380ah1py`); Jen still `voice_not_found`, voice unchanged. `AGENT_ID` for the test agent appended to `.dev.vars` (append only, no other line touched). Remaining for gate 1 → 2: `SESSION_SECRET` and `ADMIN_SECRET` (Mel), the probe (Mel records, driver runs), Jen in My Voices (Mel).

### Named blank filled: TTS_MODEL (2026-09-30)

Correction to the entry above: `SESSION_SECRET` and `ADMIN_SECRET` were already set by Mel when checked (`grep -cE '^KEY=.+'` = 1 for all six values). Probe `node evals/probe-2026-09-30/probe.mjs models`: `GET /v1/models -> 200`; `eleven_v4 can_do_text_to_speech=true` (also v4_turbo, v3, v3_conversational, multilingual_v2, flash_v2_5, turbo_v2_5, turbo_v2, flash_v2). Blank filled per the contract rule (`eleven_v4` if listed with TTS, else `eleven_multilingual_v2`): `wrangler.jsonc` `TTS_MODEL` = `eleven_v4`. `UPLOAD_FORMAT` still open (needs Mel's recording for `probe.mjs upload`).
