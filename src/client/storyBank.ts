// The Story bank for Tier A lives in the browser's localStorage under STORY_BANK_KEY
// (no server copy until Tier B). Decision: one StoryBankEntry per Question, newest wins,
// and a corrupt or foreign value is replaced rather than crashing the Replay screen.
import { STORY_BANK_KEY, type StoryBankEntry } from "../shared/api";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isEntry(value: unknown): value is StoryBankEntry {
  const v = value as Partial<StoryBankEntry> | null;
  return (
    !!v &&
    typeof v.question_id === "string" &&
    typeof v.final_answer === "string" &&
    typeof v.best_self_text === "string" &&
    typeof v.saved_at === "string"
  );
}

export function readStoryBank(storage: StorageLike): StoryBankEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(STORY_BANK_KEY) ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
}

/** Saves the entry, replacing any earlier entry for the same Question. Never throws. */
export function saveToStoryBank(storage: StorageLike, entry: StoryBankEntry): StoryBankEntry[] {
  const next = [...readStoryBank(storage).filter((e) => e.question_id !== entry.question_id), entry];
  try {
    storage.setItem(STORY_BANK_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private mode): the Replay still plays; only the save is lost.
  }
  return next;
}
