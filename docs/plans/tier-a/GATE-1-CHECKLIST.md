# GATE 1 CHECKLIST: Wave 1 (A1 to A4)

Written 2026-09-29 before dispatch. Integration branch `tier-a` @ `92c377b`. Agents are judged by these commands; if a criterion looks wrong or unsatisfiable by your lane, say so in `concerns` rather than working around it.

Worktrees (`code/.worktrees/`) and branches: A1 `sage-a1-access` / `wave1/a1-access`; A2 `sage-a2-clients` / `wave1/a2-clients`; A3 `sage-a3-content` / `wave1/a3-content`; A4 `sage-a4-client` / `wave1/a4-client`.

## Baseline

`tier-a` @ `92c377b`: `pnpm typecheck` exit 0; `pnpm test`: 1 test file, 5 tests passed (`test/guards.test.ts` 5). Rule: no test file's count may go down; `test/guards.test.ts` stays at 5 passing.

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
| A1 | `src/worker/index.ts`, `src/worker/session.ts`, `src/worker/http.ts`, `src/worker/db.ts`, `src/worker/routes/{access,admin,voice,rounds,llm,replay}.ts`, `src/worker/cleanup.ts`, `migrations/0002_*.sql`, `wrangler.jsonc` (only the `triggers` key added), `test/support/fakeD1.js`, `test/support/fakeD1.d.ts`, `test/{session,db,access,admin}.test.ts`, other new `test/*.test.ts` named after an A1 module | anything under `src/client/`, `content/`, `src/worker/{eleven,nebius,transcript,clean}.ts`, `src/shared/`, `src/worker/env.ts`, `migrations/0001_*` |
| A2 | `src/worker/{eleven,nebius,transcript,clean}.ts`, `test/{eleven,nebius,transcript,clean}.test.ts`, `test/fixtures/**`, `evals/probe-2026-09-30/probe.mjs` | `src/worker/index.ts`, `db.ts`, `routes/**`, `src/client/**`, `content/**`, `src/shared/**`, `env.ts` |
| A3 | `content/*.md` | any file outside `content/` |
| A4 | `index.html`, `src/client/**`, `public/**` | `src/worker/**`, `content/**`, `src/shared/**`, `test/support/**` |

All agents: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `docs/plans/**`, `src/worker/guards.ts`, `test/guards.test.ts`, `src/shared/questions.ts` are instant fail.

```bash
git diff tier-a...HEAD -- wrangler.jsonc          # A1 only: diff adds a "triggers" key and nothing else
```

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

## Definition of done greps (code agents)

```bash
git diff tier-a...HEAD -- src | grep -E '^\+.*console\.log' | wc -l        # must be 0
git diff tier-a...HEAD | grep -E '^\+.*TODO' | grep -vE 'TODO\((A[0-9]|task [0-9])' | wc -l   # must be 0
git diff tier-a...HEAD | grep -c '—'                                        # em-dash count, must be 0
```

## Domain checks

- A1: `pnpm build` exits 0 (A1 reports whether a `?raw` import of `content/*.md` bundled). `grep -n "used < allowance" src/worker/db.ts` finds the atomic spend. `grep -n "owner" src/worker/db.ts` shows the cleanup query excludes owner codes. Route table in `index.ts` covers all ten routes in the plan, including both `/llm/v1/chat/completions` and `/llm/chat/completions`. Local boot: `pnpm db:migrate:local && pnpm dev`, `curl -s -o /dev/null -w '%{http_code}' localhost:5173/api/me` returns 401, `curl -s -o /dev/null -w '%{http_code}' -X POST localhost:5173/admin/codes` returns 401 (orchestrator re-runs after merge).
- A1: `.dev.vars` untracked (`git status --ignored` shows it ignored if present) and not overwritten if it existed.
- A2: `test/transcript.test.ts` covers the eight fixture cases listed in the plan (happy path, multi-turn Answer, tool-only agent item, spoken message on the save item, no save_answer, save straight after Pushback, null messages, save called twice). `test/clean.test.ts` has the "nothing added" property. `probe.mjs` contains no `GET /v1/voices` list call and deletes only the voice id it created (`grep -n "v1/voices" evals/probe-2026-09-30/probe.mjs`).
- A3: every `content/*.md` no longer contains `PENDING DRAFT`; `content/README.md` exists; reading script word count 200 to 260 (`<!-- words: N -->` matches `wc -w` within 10); rewrite prompt contains `{{question}}`, `{{answer}}`, `## Retry addendum`, `{{failures}}`; Sage prompt contains `{{question_text}}`, `{{question_id}}`, `save_answer`. No em-dashes; no hard-wrapped paragraphs (spot-check).
- A4: `pnpm build` exits 0 on the merged branch (needs A1's `index.ts`; A4 on its own branch cannot build the Worker, so A4 reports `pnpm typecheck` and a client-only check, and the orchestrator runs `pnpm build` after merging both). Mock mode reachable only via `?mock=1`. `Consent` gate: no `getUserMedia` call reachable before the consent checkbox (`grep -n getUserMedia src/client`). Copy grep: `grep -rniE '\b(agent|credits|quota)\b' src/client index.html` hits only code identifiers, never user-facing strings.

## Merge order

A1, then A2, then A3, then A4, re-running `pnpm typecheck && pnpm test` after each. After A4: `pnpm build` and the local boot smoke.

## What does NOT gate this wave

Live calls of any kind (no keys yet); the probe run; content approval (that is gate 1 → 2, Mel's); `TTS_MODEL` and `UPLOAD_FORMAT`; the Sage agent; deployment; the `pnpm-workspace.yaml` `allowBuilds` placeholders (orchestrator item, pre-existing on `main`); ACR-019; the public URL; Spanish.

## Failure protocol

Merge breaks the build: revert the merge, send the agent back with the output. Undeclared lane crossing: reject the branch. Two agents on one file: reject both. Secret hit: stop, no merge, escalate to Mel. Dependency change: reject. Test count fell: fail, name the test. `BLOCKED` or `NEEDS_CONTEXT`: answer and redispatch that agent alone.
