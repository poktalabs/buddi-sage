# content

Copy and prompts for BUDDi Sage Mode, Tier A. Nothing here is live until Mel approves it at gate 1 to 2.

- `consent.md`: the Consent text shown before any recording. Used by the page (Consent screen, imported with `?raw`). Plain paragraphs, no markdown syntax, so it reads the same rendered or raw. Status: approved by Mel 2026-09-30 after the DeepSeek-V4-Pro review (docs/plans/tier-a/content-review).
- `reading-script.md`: the roughly 90 second script the Guest reads aloud for the Voice sample. Used by the page (Voice sample screen, imported with `?raw`); the page must strip the last line, the `<!-- words: N -->` comment, before showing it. Status: approved by Mel 2026-09-30 after the DeepSeek-V4-Pro review (docs/plans/tier-a/content-review).
- `rewrite-prompt.md`: the system prompt for the Best-self answer rewrite (MiniMax-M3), with `{{question}}` and `{{answer}}`; the text under `## Retry addendum` (with `{{failures}}`) is appended only on the regenerate-once path, and the heading itself is not sent. Used by the Worker (`src/worker/rewrite.ts`, imported with `?raw`). Status: approved by Mel 2026-09-30 after the DeepSeek-V4-Pro review (docs/plans/tier-a/content-review).
- `sage-system-prompt.md`: Sage's system prompt, with the dynamic variables `{{question_text}}` and `{{question_id}}` and the `save_answer` client tool. Used in the Sage agent config, pasted in Wave 3. Status: approved by Mel 2026-09-30 after the DeepSeek-V4-Pro review (docs/plans/tier-a/content-review).
- `sage-first-message.md`: Sage's first message, greets and asks `{{question_text}}`. Used in the Sage agent config, pasted in Wave 3. Status: approved by Mel 2026-09-30 after the DeepSeek-V4-Pro review (docs/plans/tier-a/content-review).
