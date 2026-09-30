// The Best-self answer: the Guest's final Answer rewritten by the rewrite model, and never
// shown or spoken unless it passes checkBestSelfAnswer. The product promises that the Replay
// never adds a fact the Guest did not say, so the flow is: attempt 1; if the guard rules fail,
// attempt 2 with the prompt's retry addendum naming the failures; if that fails too, the
// Guest's own words tidied by cleanAnswer (which only removes). A model error or an empty
// answer is a failed attempt, never a pass. Em-dashes in model output become ", " before the
// guard runs, so the text the guard checks is exactly the text the Guest hears.
//
// MiniMax-M3 thinks by default and Nebius ignores the toggle, so the call gets a generous
// max_tokens: with a small budget the thinking eats it all, content comes back empty and
// every Replay would fall back.
import promptFile from "../../content/rewrite-prompt.md?raw";
import { cleanAnswer } from "./clean";
import { type GuardFailure, checkBestSelfAnswer, describeFailures } from "./guards";
import type { ChatTextArgs } from "./nebius";

export const REWRITE_MAX_TOKENS = 4000;
export const RETRY_HEADING = "## Retry addendum";
const USER_MESSAGE = "Write the Best-self answer now.";

export type RewriteDeps = {
  /** nebius.chatText bound to the Env: returns the assistant text or throws. */
  chatText: (args: ChatTextArgs) => Promise<string>;
  /** Env.REWRITE_MODEL. */
  model: string;
  /** The prompt file's text; defaults to content/rewrite-prompt.md. Tests may override. */
  prompt?: string;
};

export type RewriteResult = {
  status: "replayed" | "fallback";
  text: string;
  attempts: number;
  failures: GuardFailure[];
};

/** Splits the prompt file into the system prompt and the retry addendum (heading dropped). */
export function splitPrompt(file: string): { system: string; addendum: string } {
  const at = file.indexOf(RETRY_HEADING);
  if (at < 0) return { system: file.trim(), addendum: "" };
  return {
    system: file.slice(0, at).trim(),
    addendum: file.slice(at + RETRY_HEADING.length).trim(),
  };
}

/** Fills {{name}} placeholders in one pass, so inserted Guest words are never re-scanned. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (name in vars ? vars[name]! : whole));
}

/** Every em-dash (with the spaces around it) becomes a comma and a space. */
export function replaceEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ", ").trim();
}

export async function bestSelfAnswer(input: { question: string; answer: string }, deps: RewriteDeps): Promise<RewriteResult> {
  const { system, addendum } = splitPrompt(deps.prompt ?? promptFile);
  const vars = { question: input.question, answer: input.answer };
  const failures: GuardFailure[] = [];
  let lastFailures: GuardFailure[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    // The addendum only makes sense with guard failures to name; after a model error the
    // second attempt is a plain retry of the base prompt.
    let content = fill(system, vars);
    if (attempt === 2 && lastFailures.length > 0 && addendum) {
      content += `\n\n${fill(addendum, { ...vars, failures: describeFailures(lastFailures) })}`;
    }

    let text = "";
    try {
      text = replaceEmDashes(
        await deps.chatText({
          model: deps.model,
          max_tokens: REWRITE_MAX_TOKENS,
          messages: [
            { role: "system", content },
            { role: "user", content: USER_MESSAGE },
          ],
        }),
      );
    } catch (err) {
      // Name only: the message could echo the request, and Guest words never go to logs.
      console.error("rewrite attempt failed", attempt, err instanceof Error ? err.name : typeof err);
      lastFailures = [];
      continue;
    }
    // Nothing speakable (empty, or only punctuation left after the em-dash swap) would pass
    // the guard vacuously, so it counts as a failed attempt.
    if (!/[\p{L}\p{N}]/u.test(text)) {
      lastFailures = [];
      continue;
    }

    lastFailures = checkBestSelfAnswer(input.answer, text);
    if (lastFailures.length === 0) return { status: "replayed", text, attempts: attempt, failures };
    failures.push(...lastFailures);
  }

  // cleanAnswer only removes; if it removes everything (an Answer of fillers), keep the words.
  const fallback = cleanAnswer(input.answer) || input.answer.trim();
  return { status: "fallback", text: fallback, attempts: 2, failures };
}
