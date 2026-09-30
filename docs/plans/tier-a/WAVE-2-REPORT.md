# WAVE 2 REPORT: BUDDi Sage Mode Tier A

2026-09-30. Three agents (A5 to A7), workflow run `wf_4ad05762-b55`, about 293k subagent tokens, about 4.5 minutes wall clock. All three returned `DONE`. All merged into `tier-a`, local only, nothing pushed.

## 1. Result

| Measure | Baseline (`0d81d74`) | Now (`290ec31`) |
|---|---|---|
| Test files | 18 | 24 |
| Tests passing | 184 | 261 |
| `test/guards.test.ts` | 5 | 5 |
| `test/index.test.ts` | 19 | 19 (7 stub assertions rewritten, see section 3) |
| `pnpm typecheck` | exit 0 | exit 0 |
| `pnpm build` | exit 0 | exit 0 |

Per agent: A5 +2 files / +26 tests (voice 19, cleanup 7); A6 +2 / +21 (rounds 9, llm 12) plus `proxy-ttft.mjs`; A7 +2 / +30 (replay 20, rewrite 10). All other files unchanged in count.

## 2. Gate conditions (GATE-2-CHECKLIST.md, run by the orchestrator per branch before merge)

| Condition | Result | How checked |
|---|---|---|
| Ownership | PASS | three-dot `git diff --name-only tier-a...HEAD`: A5 exactly its 4 files, A6 its 5, A7 its 4; no overlaps, no crossings |
| Authors | PASS | `git log --format=%ae`: only `19479678+troopdegen@users.noreply.github.com` (36 commits since `781345a`) |
| Secrets | PASS | diff and commit-body pattern greps 0/0 on every branch; tracked `.dev.vars`/`.env` 0; gate 2→3 key grep on `src content evals test` 0 |
| Dependencies | PASS | 0 dependency files in any diff |
| DoD greps | PASS | `console.log` 0, unowned TODO 0, em-dashes 0 in diffs and commit bodies |
| Typecheck and tests per branch | PASS | re-run in each worktree: A5 208 pass + 2 declared, A6 202 + 3, A7 212 + 2; each matches the claim exactly |
| After each merge | PASS | A5 210 (2 declared fail), A6 231 (5), A7 261 (7): the failures were exactly the union of the declared `index.test.ts` stub assertions; typecheck 0 each time |
| Replay guard | PASS | read `bestSelfAnswer`: model text is returned only when `checkBestSelfAnswer` is empty; exceptions, empty and punctuation-only output are failed attempts; fallback is `cleanAnswer` of the Guest's words |
| Audio streaming | PASS | `grep -nE "arrayBuffer|btoa|base64" replay.ts`: 0; `MAX_POLLS = 20`; `REWRITE_MAX_TOKENS = 4000` |
| Local boot smoke on merged `tier-a` | PASS | `pnpm db:migrate:local` 0; `pnpm dev`: `/api/me` 401, `/admin/codes` 401 without bearer, create code 200, redeem 200 with `sage_session`, `POST /api/rounds` (real Question, no Voice clone) 409 `voice_required` with `used` still 0, `POST /llm/v1/chat/completions` without bearer 401, `/` 200 |

## 3. The check that mattered most

The per-merge failure accounting. `test/index.test.ts` (A1's) asserted that every Wave 2 route returned the 501 stub, so each correct merge was bound to turn some of it red. The rule that kept that from hiding a real break: after each merge the failing set had to equal, by name, the union of what the agents declared (2, then 5, then 7), with every other file green. Only then did the orchestrator rewrite those 7 assertions to each route's real first check (`290ec31`), keeping the count at 19.

## 4. Decisions Mel owns at gate 2 → 3

1. **Start Wave 3** (production and spend; each step with your go, from IMPLEMENTATION-PLAN "Wave 3"): merge `tier-a` into `main` locally; `wrangler d1 create` + remote migrations; `wrangler secret put` for five secrets (you paste; `LLM_PROXY_SECRET` fresh); `pnpm deploy`; the real Sage agent on Custom LLM `https://<worker>/llm/v1` with voice `IDHS58OMlK9jZvRdhEVy`; `AGENT_ID` into `wrangler.jsonc` and redeploy; an owner code; your live Round; the deployed TTFT re-run.
2. **Refund a Round when the Conversation fails on our side?** (A7's concern.) Today a Round is refunded only when minting the token fails. If the Conversation ends `failed`, or Sage never calls `save_answer`, or the Answer is empty, the Round is marked failed and the Allowance is spent. Recommendation: leave it for Tier A (your owner code has 100 Rounds) and fix it in Tier B before testers get 3-Round Guest codes, refunding at least `conversation_failed` and `no_save_answer`.

## 5. Deviations accepted

| Agent | Deviation | Why accepted |
|---|---|---|
| A5, A6, A7 | Optional trailing `fetchImpl` / `deps` argument on handlers | Tests inject fakes; the router passes the pinned arity, `index.ts` unchanged |
| A5 | Local conditional UPDATEs (`setVoiceIfNone`, `clearVoiceIfSame`) instead of editing `db.ts` | The plan's rule for extra queries; closes a two-tab double-upload slot leak and a cleanup-vs-new-upload race |
| A5 | Early 400 on `Content-Length` over 20 MB plus 64 KB; only allowlisted extensions go upstream | Refuses oversize without reading the body; the Guest's filename never leaves the Worker |
| A5, A6 | 401 when a signed cookie's code row no longer exists | Matches `access.ts` `me` |
| A6 | Missing or non-string `question_id` → 400 `unknown_question` | Closest contract code |
| A6 | `TypeError` vs network rejection told apart by re-checking the body shape | `fetch` also rejects with `TypeError`; catching by type alone would misreport a network failure as 400 |
| A7 | `audio` on a Round with no Replay yet → 409 `bad_request` | The contract has no "not ready" code; the others would state something false |
| A7 | `replay` rejects a different `conversation_id` than the one already stored (400) | A retry after 504 must use the same Conversation; stops swapping in another transcript |
| A7 | After a model error, attempt 2 retries the base prompt without the addendum | There are no guard failures to name |
| A7 | Punctuation-only output counts as empty; all-filler Answers fall back to the trimmed Answer | A test found an empty rewrite passing the guard vacuously; TTS never gets empty text; nothing is added |

## 6. Carried into Wave 3

- A6 local TTFT through the proxy (5 runs, local dev, DeepSeek-V4-Pro with `reasoning_effort: "none"`): 3109, 1085, 1135, 708, 1040 ms; **median 1085 ms** (run 1 includes cold start). Deployed re-run: `node evals/probe-2026-09-30/proxy-ttft.mjs https://<worker>.workers.dev/llm/v1` (reads `LLM_PROXY_SECRET` from `.dev.vars`, which must match the production secret).
- A7 live rewrite of a synthetic Answer through MiniMax-M3: status `replayed`, 1 attempt, 0 guard failures, 10.6 s. "we" stayed "we", "maybe half" stayed a hedge, no number added.
- Replay worst case is about 30 s of polling plus two rewrites (about 10 s each), roughly 50 s. The page sets no timeout on the Replay request, so it will wait; watch the time from save to audio in the live Round.
- Worker log lines to watch with `wrangler tail`: `voice add failed <status>`; `voice discard failed for <id>` (a clone that needs manual deletion); `rewrite attempt failed`.
- Still open from Wave 1: `extractFinalAnswer` treats a Sage backchannel during the second attempt as the Pushback (check the live transcript); A4's 6 s closing-line cap; test in Chrome (Safari may drop the `Secure` cookie on http localhost).
- The ElevenLabs agent config for Wave 3 uses voice `IDHS58OMlK9jZvRdhEVy` (plan step 5 still names the old Jen id).

## 7. Human-track items (not blockers)

- The Round-refund rule (decision 2).
- The Tier B shared-code identity issue (WAVE-1-REPORT section 7) now has one more face: a shared Guest code lets one redeemer delete another's Voice clone via "Delete my voice".
- `pnpm install` still exits 1 on the `allowBuilds` placeholders.

## 8. Where the work is

- `tier-a` @ `290ec31` plus this report and the ledger, local, no remote. `main` untouched at `781345a`.
- Agent branches (merged): `wave2/a5-voice`, `wave2/a6-rounds`, `wave2/a7-replay`.
- Worktrees kept until the epic ends: `code/.worktrees/sage-a{1..4}-*` and `sage-a5-voice`, `sage-a6-rounds`, `sage-a7-replay` (A6 and A7 hold a gitignored copy of `.dev.vars`).

Unverified: no live Voice clone through the Worker, no live TTS, no live Conversation token or transcript (all Wave 3 by design). The ElevenLabs side of the Custom LLM stream (tolerating `reasoning_content`) is untested until the live Round.
