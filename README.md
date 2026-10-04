# Buddi Sage Mode

A voice interview coach that replays your answer in your own voice. You answer a hard interview question out loud, Sage (the coach) pushes back once, you try again, and then you hear your final answer rewritten as your best self, spoken by a clone of your own voice.

Live at [sage.agentcamp.xyz](https://sage.agentcamp.xyz) (access by code).

## How a Round works

1. **Code.** A Guest redeems a code; the Worker answers with an HMAC-signed session cookie. No accounts.
2. **Voice sample.** After explicit Consent, the browser records a reading script and uploads it to the Worker, which creates an ElevenLabs Instant Voice Clone. The API key never reaches the browser. An hourly cron deletes clones that are no longer needed.
3. **Start.** The Worker spends one Round of the code's Allowance, then mints a single-use WebRTC conversation token for the private ElevenAgents agent (refunding the Round if minting fails).
4. **Coaching.** The browser talks to Sage through `@elevenlabs/client`. The question and the target job reach the agent as dynamic variables. Sage asks, pushes back once, listens to the second attempt and calls the `save_answer` client tool.
5. **Replay.** The Worker reads the finished conversation from ElevenLabs, takes the Guest's final Answer from the transcript (never from tool parameters), rewrites it with an LLM under deterministic guardrails (no new numbers, no "we" turned into "I"; falls back to the Guest's own words), and streams it back as text to speech in the Guest's voice clone.

Optional: a Guest can paste a job post, and the Worker turns it into a job brief with three job-specific Questions that also ground Sage's Pushback.

## Stack

- **Cloudflare Workers** for the API and static assets, **D1** (SQLite) for codes and Rounds, a cron trigger for voice cleanup.
- **ElevenLabs**: ElevenAgents (private agent, built-in LLM, `save_answer` client tool), Instant Voice Cloning, and text to speech with `eleven_v4` for the Replay.
- **Nebius Token Factory** for the Best-self rewrite (`MiniMaxAI/MiniMax-M3`) and the job brief (`deepseek-ai/DeepSeek-V4-Pro-0813`).
- **Vite** + TypeScript, no framework on the page. **Vitest** for tests.
- A Telegram bot for the owner to approve code requests, and an owner dashboard at `/dashboard`.

The Worker also ships an OpenAI-compatible Custom LLM pass-through at `/llm/v1/chat/completions` (bearer-protected, Nebius behind it). The production agent uses an ElevenAgents built-in LLM instead, so the proxy is deployed but unused.

## Layout

| Path | What it holds |
|---|---|
| `src/worker/` | The Worker: router (`index.ts`), routes, ElevenLabs and Nebius clients, D1 queries |
| `src/client/` | The page: screens, recorder, the Round state machine, the ElevenLabs browser SDK |
| `src/shared/` | The API contract and the Question set, imported by both sides |
| `content/` | Prompts and copy as markdown (Sage's system prompt and first message, consent, rewrite prompt) |
| `migrations/` | D1 schema, applied in order |
| `test/` | Vitest suites; network calls are injected fakes, so tests never hit ElevenLabs or Nebius |
| `docs/plans/tier-a/` | The multi-agent build plan, gate checklists, wave reports and ledger |
| `CONTEXT.md` | The domain glossary (Round, Pushback, Replay, Allowance, ...) |

## Run it locally

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in the keys and secrets
pnpm db:migrate:local
pnpm dev
```

Then create a code with `POST /admin/codes` (bearer `ADMIN_SECRET`). For UI work without any keys, open `http://localhost:5173/?mock=1`: mock mode fakes the Worker and the voice session, and only works on localhost.

Checks: `pnpm typecheck` and `pnpm test`.

## The ElevenLabs agent

The agent lives in the ElevenLabs workspace, not in this repo. To recreate it: paste `content/sage-system-prompt.md` and `content/sage-first-message.md`; add a client tool `save_answer` with "wait for response" on and a `question_id` parameter; turn on authentication (`enable_auth`) so conversations need a token; leave every override off; set a max duration and low concurrency and daily limits, with bursting off. Put its ID in the `AGENT_ID` secret.

## Deploy

```bash
pnpm db:migrate:remote
pnpm run deploy        # vite build && wrangler deploy (bare `pnpm deploy` is pnpm's own command)
```

Secrets are set once with `wrangler secret put` (see `.dev.vars.example` for the list).
