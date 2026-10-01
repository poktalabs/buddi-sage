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

### Named blank filled: UPLOAD_FORMAT (2026-09-30)

Mel recorded the reading script in mock mode (about 90 s; 226 words reads longer than the plan's "about 30 s", which was a driver misstatement, harmless: ElevenLabs recommends at least a minute for instant cloning) and saved it via the mock-mode link. Probe `node evals/probe-2026-09-30/probe.mjs upload ~/Downloads/voice-sample.webm`: `audio/webm, 1362585 bytes`; `POST /v1/voices/add -> 200`, `requires_verification=false`; `DELETE /v1/voices/<the created id> -> 200`; `UPLOAD_FORMAT: webm accepted`. Blank filled: `UPLOAD_FORMAT` = `webm` (no transcode; `src/client/recorder.ts` stays with A4's version, A5 does not take it). Net ElevenLabs change: none (one voice created and deleted). The sample file stays in Mel's Downloads, outside git. Remaining for gate 1 → 2: Jen in My Voices (`GET /v1/voices/QLAlOeRuLwKX0skeTR7R` still 400 `voice_not_found` at this entry).

### Sage voice set (2026-09-30)

Jen `QLAlOeRuLwKX0skeTR7R` could not be found by Mel in the app or by the driver in `GET /v1/shared-voices` (search "Jen" and the full name); treated as unavailable. Mel picked a replacement from the Voice Library: "Jen - Young, Calm & Friendly" `cwHwYupmHH3pk6RciNyG` (professional clone, English with a German accent, en-GB; `rate` 1 so standard credit cost, `notice_period` 730 days, `is_added_by_user` true). `agents_update` on `<agent-id>`: read back shows `tts.voice_id` = `cwHwYupmHH3pk6RciNyG`, prompt, first message, tool, auth and limits unchanged, all overrides still false; version `agtvrsn_5201m3skt2z9ea89c3ap14tgheyc`. All gate 1 → 2 items from WAVE-1-REPORT section 4 are now closed; the gate is `HUMAN` and waits for Mel's go.

### Sage voice changed again (2026-09-30)

Mel: "then use this one: IDHS58OMlK9jZvRdhEVy". Library voice "Jennifer - AI Explainer" (professional clone, American English en-US; `rate` 1, `notice_period` 180 days). Driver added it to My Voices via `POST /v1/voices/add/{public_owner_id}/IDHS58OMlK9jZvRdhEVy` -> 200 (name "Sage - Jennifer AI Explainer"; `GET /v1/voices/IDHS58OMlK9jZvRdhEVy` -> 200). `agents_update`: read back `tts.voice_id` = `IDHS58OMlK9jZvRdhEVy`, everything else unchanged, overrides still false; version `agtvrsn_8201m3sky39xf0wrm2b0sc08aynx`. `cwHwYupmHH3pk6RciNyG` stays in My Voices, unused (removing it is Mel's call). Gate 1 → 2 still waits for Mel's go.

### Gate 1 → 2: CROSSED (2026-09-30)

Contract row: "`HUMAN` | n/a (content approval, live keys, probe authorisation) | preconditions in IMPLEMENTATION-PLAN "Gate 1 → 2"". Decision by Mel: "start wave 2" (after every item in WAVE-1-REPORT section 4 was closed: content approved and applied `cec4535`; keys in `.dev.vars`; probe run; test agent created; Question wording accepted). Evidence re-run by the driver on `tier-a` @ `318771e` just before crossing: `typecheck exit=0`; `Test Files 18 passed (18)`, `Tests 184 passed (184)`; per file access 11, admin 7, clean 9, client/api 8, client/copy 3, client/markdown 6, client/mock 6, client/mockMode 3, client/recorder 4, client/round 16, client/storyBank 5, db 26, eleven 17, guards 5, index 19, nebius 14, session 13, transcript 12. `.dev.vars` presence via `grep -cE '^KEY=.+'`: 1 for each of `ELEVENLABS_API_KEY`, `NEBIUS_API_KEY`, `LLM_PROXY_SECRET`, `SESSION_SECRET`, `ADMIN_SECRET`, `AGENT_ID`. Named blanks: `TTS_MODEL=eleven_v4`, `UPLOAD_FORMAT=webm` (A5 does not take `recorder.ts`). Circuit breakers checked: none fired. Plan correction carried into Wave 2 prompts (a fact, not a re-decision): Sage's voice is `IDHS58OMlK9jZvRdhEVy` (the plan's Jen id is gone from the library; see the two voice entries above). Integration state: `tier-a` @ `318771e` plus this entry and `GATE-2-CHECKLIST.md`, local only, nothing pushed.

### Wave 2: dispatched 2026-09-30

`/ultracode-wave 2`. Worktrees in `code/.worktrees/`: `sage-a5-voice` (`wave2/a5-voice`), `sage-a6-rounds` (`wave2/a6-rounds`), `sage-a7-replay` (`wave2/a7-replay`), all from `tier-a` @ `0d81d74`; declared in the workstream BRIEF. `pnpm install --frozen-lockfile` exit 1 in each with the known `ERR_PNPM_IGNORED_BUILDS`; A6 worktree baseline typecheck 0, 18 files / 184 tests. `.dev.vars` copied with `cp -n` into A6 and A7 only (gitignored in both; A5 has none). Gate checklist committed first: `0d81d74` `GATE-2-CHECKLIST.md`.

### Wave 2: completed 2026-09-30

Workflow `wf_4ad05762-b55`, about 293k subagent tokens, 4.5 min. A5, A6, A7 returned `DONE`. The driver re-ran GATE-2-CHECKLIST on each worktree: ownership via three-dot diff clean (A5 4 files, A6 5, A7 4; no crossings); authors all `19479678+troopdegen@users.noreply.github.com`; secrets 0/0/0; dependency files 0; `console.log` 0; unowned TODO 0; em-dashes 0 in diffs and commit bodies; typecheck 0; tests A5 208 + 2 declared, A6 202 + 3, A7 212 + 2 (each exactly as claimed). Merged one at a time into `tier-a`: `ae17291` (A5) 210 with 2 declared failures, `1d02fe4` (A6) 231 with 5, `9296a8c` (A7) 261 with 7; failing set equal by name to the union of the declared `test/index.test.ts` 501-stub assertions; typecheck 0 each time. Orchestrator fix `290ec31`: those 7 assertions now check each route's real first check; 24 files / 261 passed, `index` stays 19, `guards` stays 5. `pnpm build` exit 0. Local boot smoke: `/api/me` 401, `/admin/codes` 401, create 200, redeem 200 with cookie, `POST /api/rounds` real Question without a Voice clone 409 `voice_required` with `used` 0, `/llm/v1/chat/completions` without bearer 401, `/` 200. Live calls by agents: A6 5 Nebius calls via local proxy (median TTFT 1085 ms); A7 one MiniMax-M3 rewrite (replayed, 0 guard failures). No ElevenLabs calls. Report: `WAVE-2-REPORT.md`.

### Gate 2 → 3: HELD

Contract row: "`HUMAN` | n/a (production and spend) | preconditions in IMPLEMENTATION-PLAN "Gate 2 → 3"". Preconditions run by the driver on `290ec31`: typecheck 0; tests 24 files / 261 (per file access 11, admin 7, clean 9, cleanup 7, client/api 8, client/copy 3, client/markdown 6, client/mock 6, client/mockMode 3, client/recorder 4, client/round 16, client/storyBank 5, db 26, eleven 17, guards 5, index 19, llm 12, nebius 14, replay 20, rewrite 10, rounds 9, session 13, transcript 12, voice 19; none below gate 1 → 2); build 0; boot smoke passes; key grep on `src content evals test` 0; authors since `781345a` only `19479678+troopdegen@users.noreply.github.com`; A6 local TTFT median 1085 ms. Circuit breakers checked: none fired (no secret hit, no dependency change, no BLOCKED/NEEDS_CONTEXT, no test count fell, no build broke, no undeclared crossing, no spend beyond the listed calls, no deploy, no ElevenLabs change). Held for Mel: start Wave 3, and the Round-refund question (WAVE-2-REPORT section 4). Integration state: `tier-a` @ `290ec31` plus this report and ledger commit, local only, nothing pushed.

### Gate 2 → 3: CROSSED (2026-09-30)

Contract row: "`HUMAN` | n/a (production and spend) | preconditions in IMPLEMENTATION-PLAN "Gate 2 → 3"". Decision by Mel: "start wave 3". Evidence: the preconditions recorded in the HELD entry above, on `290ec31`; no code has changed since (`570fa88` adds only docs). Round-refund question (WAVE-2-REPORT section 4, decision 2): not answered by Mel; behaviour stays as built (refund only on token-mint failure), the default recommended for Tier A. Wave 3 runs as IMPLEMENTATION-PLAN steps 1 to 9, one at a time, each production step with Mel's go; step 5 uses voice `IDHS58OMlK9jZvRdhEVy` (the plan's Jen id is gone). Circuit breakers checked: none fired. Integration state: `tier-a` @ `570fa88` plus this entry, local only, nothing pushed.

### Wave 3 step 1: local merge (2026-09-30)

`main` @ `37842aa` = `--no-ff` merge of `tier-a` @ `f03780a`. On `main`: typecheck 0; 24 files / 261 tests; `git log --format=%ae 781345a..main` 40 commits, all `19479678+troopdegen@users.noreply.github.com`. No remote, nothing pushed. Wrangler: OAuth as `<wrangler-account-email>`, account "Frutero", scopes include `d1 (write)` and `workers_scripts (write)`.

### Wave 3 step 2: D1 (2026-09-30)

Mel: "go". `pnpm wrangler d1 create buddi-sage`: created in region WNAM, id `6b099f7f-347e-481b-8966-1d9126be924a` (written into `wrangler.jsonc`; binding stays `DB`). `pnpm db:migrate:remote`: `0001_codes_and_rounds.sql` and `0002_round_texts.sql` both applied.

### Wave 3 step 3: secrets (2026-09-30)

Mel: "go" to reusing the `.dev.vars` values (deviation from the plan's fresh `LLM_PROXY_SECRET`: the local value never left gitignored files, and steps 5 and 9 need it where `.dev.vars` is append-only). A node script read the five keys from `.dev.vars` and piped JSON to `pnpm wrangler secret bulk`; no value printed. Wrangler created the Worker "buddi-sage" (no code yet) to hold them; 5 secrets created. `wrangler secret list` names: ELEVENLABS_API_KEY, NEBIUS_API_KEY, LLM_PROXY_SECRET, SESSION_SECRET, ADMIN_SECRET.

### Local end-to-end validation, before step 4 (2026-09-30)

Mel asked to test locally before any deploy ("why are you going all the way to deploy if I haven't validated the work so far"). Driver's miss: the plan had no local end-to-end Round before production. Production state at that point was inert (empty D1, a code-less Worker holding 5 secrets). Local run on `main` @ `e825e08`, `pnpm dev --port 5180` (5173 was held by buddi-growth-api), local owner code via `/admin/codes`, test agent `<agent-id>` (built-in LLM; the Custom LLM proxy is not exercised locally because ElevenLabs cannot reach localhost). Two findings: (1) the ElevenLabs key lacked `convai_write` (token mint 401 `missing_permissions`); Mel raised ElevenAgents from read to write on the same key, so the production secret needs no change; direct token mint then 200. (2) `.dev.vars` had been rewritten at 17:08 without the `AGENT_ID` line (worktree copies from 11:59 still had it, same ElevenLabs key hash); driver appended it. The failed first Round was refunded by the mint-failure path (`used` stayed 0). Result: Mel's Voice clone uploaded; 3 Rounds (why-this-role, shipped-system, production-failure) all `replayed`, 1 rewrite attempt each, `guard_failures` `[]`, final Answers 322/451/393 chars, Best-self 304/483/356 chars; save to audio request 8, 9 and 7 s; `used` 3 of 100. Mel heard all three Replays: "very fun". No Worker errors logged beyond the pre-fix 401.

### Design system fix, before step 4 (2026-09-30)

Mel: "the design system is not 100% implemented as per https://buddi.agentcamp.xyz/brandkit/llms.txt, we need to fix the design system before deployment". Driver audit against the port kit, then branch `wave3/design-system` (`550fe53`, orchestrator-written at Mel's request; files `src/client/style.css`, `src/client/main.ts`, `index.html`, `public/favicon.svg`): kit tokens, base, `.nb*` and `ds-` recipes copied verbatim; gold header band, 48rem column, footer; radii; uppercase buttons; 800/500 scale; red only for errors, magenta only for the CTA; status notes as fills. Checked in mock mode with the gstack headless browser at 1280 and 375 px, every screen. Typecheck 0, 24 files / 261 tests, build 0. Mel: "approved, merge and deploy". Merged into `main` as `606b5fb`.

### Wave 3 step 4: deploy (2026-09-30)

`pnpm run deploy` (`pnpm deploy` is pnpm's own command and errors). URL `https://buddi-sage.mel-19b.workers.dev`, version `ae20d937-65a6-4cdb-85ee-14d27e4a75ca`, cron `17 * * * *`, bindings DB + 6 vars (`AGENT_ID` empty until step 6). Wrangler defaulted `workers_dev` and preview URLs to on (not set in `wrangler.jsonc`). Smoke: `GET /` 200 (title "BUDDi Sage Mode"); `/api/me` 401; `/admin/codes` 401; `/llm/v1/chat/completions` and `/llm/chat/completions` without bearer 401; `/llm/v1/chat/completions` with the bearer 200 `text/event-stream`, 5 content chunks from Nebius (one tiny call).

### Custom domain: sage.agentcamp.xyz (2026-09-30)

Mel: "can you deploy it to sage.agentcamp.xyz?". `agentcamp.xyz` is an active full zone on the same Frutero account (nameservers hattie/nicolas match the .xyz delegation). Added `"routes": [{ "pattern": "sage.agentcamp.xyz", "custom_domain": true }]` to `wrangler.jsonc` and redeployed: version `d1fea012-fffe-48da-802a-8e66997911c8`. With a route present and `workers_dev` unset, Wrangler disabled the `workers.dev` URL and preview URLs (`buddi-sage.mel-19b.workers.dev` now 404). The DNS record did not appear for about 8 minutes; a re-`PUT` of the same Workers domain via the API (200, idempotent) was followed by resolution (DoH: 104.21.11.13, 172.67.147.138); cause not established. Smoke over HTTPS with the IP pinned (this laptop's resolver still holds a negative cache from an earlier lookup): `/` 200 "BUDDi Sage Mode"; `GET /api/me` 401; `/admin/codes` 401; `/llm/v1/chat/completions` 401 without bearer, 200 with it (5 content chunks). Step 5 uses `https://sage.agentcamp.xyz/llm/v1`.

### Wave 3 steps 5 to 7, simplified (2026-09-30)

Mel decided the coach runs on an ElevenAgents built-in LLM, not Custom LLM on Nebius ("it doesn't make sense to use Nebius if there are reasonable alternatives built-in on ElevenLabs"; "we just want the demo to work, the simplest way possible"; recorded in the workstream DECISIONS.md). Evidence offered first: ElevenLabs' `agents_calculate_llm_usage` for the Sage prompt priced `custom-llm` at $0/min and built-ins from $0.002/min (gemini-2.5-flash) to $0.045/min (claude-sonnet-4-5); the test agent's `qwen35-397b-a17b` $0.013/min. Plan deviation: no new agent and no ElevenLabs workspace secret. Production uses the existing test agent `<agent-id>` (read back with `agents_get`: llm `qwen35-397b-a17b`, voice `IDHS58OMlK9jZvRdhEVy`, approved prompt, `save_answer` client tool, `enable_auth` true, `max_duration_seconds` 300, concurrency 1, daily 20, bursting false, all overrides false), the same agent behind Mel's three local Rounds. `AGENT_ID` set in `wrangler.jsonc`; redeployed, version `8575e262-dd7a-471e-8502-bc4ea7c45787`. The `/llm` proxy stays deployed, unused and bearer-protected. Owner code created on production via `/admin/codes` (200). Remaining: Mel's live Round (step 8). Step 9 (deployed proxy TTFT) no longer applies.
