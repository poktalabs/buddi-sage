# GATE 2 CHECKLIST: Wave 2 (A5 to A7)

Written 2026-09-30 before dispatch. Integration branch `tier-a` @ the commit that adds this file (parent `318771e`). Agents are judged by these commands; if a criterion looks wrong or unsatisfiable by your lane, say so in `concerns` rather than working around it.

Worktrees (`code/.worktrees/`) and branches: A5 `sage-a5-voice` / `wave2/a5-voice`; A6 `sage-a6-rounds` / `wave2/a6-rounds`; A7 `sage-a7-replay` / `wave2/a7-replay`.

## Baseline

`tier-a` @ `318771e`: `pnpm typecheck` exit 0; `pnpm test`: 18 files, 184 tests. Per file: access 11, admin 7, clean 9, client/api 8, client/copy 3, client/markdown 6, client/mock 6, client/mockMode 3, client/recorder 4, client/round 16, client/storyBank 5, db 26, eleven 17, guards 5, index 19, nebius 14, session 13, transcript 12. Rule: no existing test file's count may go down. Exception, declared here: `test/index.test.ts` may contain assertions that a Wave 2 route returns the 501 stub; if a Wave 2 agent's real handler makes such an assertion false, the agent reports it by test name and the orchestrator fixes `test/index.test.ts` (A1-owned) at merge, keeping the count.

## Per branch, run in the worktree (three-dot diffs)

```bash
git diff --name-only tier-a...HEAD                 # ownership
git log --format='%h %ae %s' tier-a..HEAD          # author must be 19479678+troopdegen@users.noreply.github.com
pnpm typecheck; echo $?                            # must be 0
pnpm test 2>&1 | tail -6                           # per-file counts vs claim
```

## Ownership (from IMPLEMENTATION-PLAN collision table)

| Agent | Allowed paths | Instant fail |
|---|---|---|
| A5 | `src/worker/routes/voice.ts`, `src/worker/cleanup.ts`, `test/voice.test.ts`, `test/cleanup.test.ts` | `src/client/**` (including `recorder.ts`: `UPLOAD_FORMAT=webm`), any other `src/worker/**` file |
| A6 | `src/worker/routes/rounds.ts`, `src/worker/routes/llm.ts`, `test/rounds.test.ts`, `test/llm.test.ts`, `evals/probe-2026-09-30/proxy-ttft.mjs` | any other `src/worker/**` file, `src/client/**` |
| A7 | `src/worker/routes/replay.ts`, `src/worker/rewrite.ts`, `test/rewrite.test.ts`, `test/replay.test.ts` | any other `src/worker/**` file (`guards.ts`, `transcript.ts`, `clean.ts`, `nebius.ts`, `eleven.ts`, `db.ts`, `index.ts`), `content/**`, `src/client/**` |

All agents: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `docs/plans/**`, `src/shared/**`, `src/worker/env.ts`, `src/worker/index.ts`, `src/worker/db.ts`, `src/worker/session.ts`, `src/worker/http.ts`, `test/support/**`, `migrations/**`, `content/**` are instant fail. A needed `db.ts` query goes in the agent's own module as a local function, reported.

## Secrets and data

```bash
git diff tier-a...HEAD | grep -nEi 'sk_[a-z0-9]{16,}|xi-api-key["'"'"': ]+[a-z0-9]{20,}|bearer [a-z0-9]{24,}|api[_-]?key *[=:] *["'"'"'][a-z0-9]{16,}' | wc -l   # must be 0
git log --format=%B tier-a..HEAD | grep -nEi 'sk_|api[_-]?key *=' | wc -l                                        # must be 0
git ls-files | grep -E '(^|/)\.dev\.vars$|\.env$' | wc -l                                                          # must be 0
```

Report counts only, never matched values.

## Dependencies

```bash
git diff --name-only tier-a...HEAD | grep -E 'package.json|pnpm-lock.yaml|pnpm-workspace.yaml' | wc -l   # must be 0
```

## Definition of done greps

```bash
git diff tier-a...HEAD -- src | grep -E '^\+.*console\.log' | wc -l        # must be 0
git diff tier-a...HEAD | grep -E '^\+.*TODO' | grep -vE 'TODO\((A[0-9]|task [0-9])' | wc -l   # must be 0
git diff tier-a...HEAD | grep -c '—'                                        # em-dash count, must be 0
```

## Domain checks

- A5: `addVoice` returns 409 `voice_exists` before any upstream call when the code has a voice; voice name is `sage-<kind>-<8 hex>` and never contains the code or Contact (`grep -n "sage-" src/worker/routes/voice.ts`); `requires_verification: true` deletes the just-created voice and returns 422; `cleanupVoices` test proves an owner code is never touched and one failing delete does not stop the rest; one-hour grace and 7-day rule both tested. No live calls.
- A6: `startRound` returns 409 `voice_required` with `used` unchanged; the fourth Round of a 3-Round code returns 403 `allowance_used`; a mint failure refunds (`used` back) and fails the Round, returning 502 `upstream_error`. `chatCompletions`: 401 on a bad or missing bearer (constant-time `requireBearer`), 400 on non-JSON or a non-object body (`TypeError` from `forwardChatCompletions`), 502 `upstream_error` on a network rejection, both `/llm/v1/...` and `/llm/...` paths reach it. No message content logged (`grep -n "console" src/worker/routes/llm.ts`). `proxy-ttft.mjs` reads `.dev.vars` without printing values; A6 reports a local median from 5 runs.
- A7: `grep -n "checkBestSelfAnswer" src/worker/rewrite.ts` present; no path returns model text without a passing guard (fallback is `cleanAnswer`); `max_tokens` about 4000 on the MiniMax call; prompt split on `## Retry addendum` with the heading not sent; em-dashes in model output replaced; poll cap 20; `finishRound` returning false is handled (no second write, no double Replay); `audio` streams `textToSpeech(...).body` with `content-type: audio/mpeg`, no `arrayBuffer`/base64 (`grep -nE "arrayBuffer|btoa|base64" src/worker/routes/replay.ts` finds nothing). A7 reports one live rewrite of a synthetic Answer and its guard result.

## Merge order

A5, then A6, then A7, re-running `pnpm typecheck && pnpm test` after each. After A7: `pnpm build` and the local boot smoke (`/api/me` 401, `/admin/codes` 401, redeem 200, `POST /api/rounds` without a Voice clone returns 409 `voice_required`, `POST /llm/v1/chat/completions` without bearer 401).

## What does NOT gate this wave

The deployed URL, the real Sage agent on Custom LLM, D1 remote, secrets in production (all Wave 3); a live Voice clone upload through the Worker and live TTS (Wave 3); the deployed TTFT re-run; ElevenLabs tolerance of `reasoning_content` in SSE (Wave 3 finding); the `pnpm-workspace.yaml` `allowBuilds` placeholders; the Tier B shared-code identity issue; ACR-019; Spanish.

## Failure protocol

Merge breaks the build: revert the merge, send the agent back with the output. Undeclared lane crossing: reject the branch. Two agents on one file: reject both. Secret hit: stop, no merge, escalate to Mel. Dependency change: reject. Test count fell: fail, name the test. `BLOCKED` or `NEEDS_CONTEXT`: answer and redispatch that agent alone.
