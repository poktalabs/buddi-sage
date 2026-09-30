// The Guest's final Answer comes from the ElevenLabs transcript (their exact words), never from
// the parameters Sage passes to save_answer: the model could paraphrase or embellish there, and
// the Replay must never add a fact the Guest did not say. Rule: take the first agent item that
// calls save_answer; walk back collecting the Guest's non-blank messages, skipping tool-only
// agent items, until the first agent item that spoke, which is the Pushback.

export type TranscriptItem = {
  role: "user" | "agent";
  message: string | null;
  tool_calls?: { tool_name: string; params_as_json?: string; type?: string }[] | null;
  time_in_call_secs?: number;
};

export type FinalAnswer =
  | { ok: true; answer: string; pushback: string }
  | { ok: false; reason: "no_save_answer" | "empty_answer" };

export const SAVE_ANSWER_TOOL = "save_answer";

function spoken(item: TranscriptItem): string {
  return typeof item.message === "string" ? item.message.trim() : "";
}

function callsSaveAnswer(item: TranscriptItem): boolean {
  return item.role === "agent" && Array.isArray(item.tool_calls) && item.tool_calls.some((t) => t?.tool_name === SAVE_ANSWER_TOOL);
}

export function extractFinalAnswer(items: TranscriptItem[]): FinalAnswer {
  const s = items.findIndex(callsSaveAnswer);
  if (s < 0) return { ok: false, reason: "no_save_answer" };

  const parts: string[] = [];
  let pushback = "";
  for (let i = s - 1; i >= 0; i--) {
    const item = items[i]!;
    const text = spoken(item);
    if (item.role === "user") {
      if (text) parts.unshift(text);
      continue;
    }
    if (text) {
      pushback = text;
      break;
    }
  }

  if (parts.length === 0) return { ok: false, reason: "empty_answer" };
  return { ok: true, answer: parts.join(" "), pushback };
}
