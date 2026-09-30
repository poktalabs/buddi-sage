import { describe, expect, it } from "vitest";
import { STORY_BANK_KEY, type StoryBankEntry } from "../../src/shared/api";
import { readStoryBank, saveToStoryBank } from "../../src/client/storyBank";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORY_BANK_KEY, initial);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const entry = (question_id: string, saved_at: string): StoryBankEntry => ({ question_id, final_answer: "f", best_self_text: "b", saved_at });

describe("Story bank", () => {
  it("is empty when nothing is stored", () => {
    expect(readStoryBank(memoryStorage())).toEqual([]);
  });

  it("saves under STORY_BANK_KEY", () => {
    const s = memoryStorage();
    saveToStoryBank(s, entry("a", "1"));
    expect(JSON.parse(s.data.get(STORY_BANK_KEY)!)).toEqual([entry("a", "1")]);
  });

  it("keeps one entry per Question, newest wins", () => {
    const s = memoryStorage();
    saveToStoryBank(s, entry("a", "1"));
    saveToStoryBank(s, entry("b", "2"));
    saveToStoryBank(s, entry("a", "3"));
    expect(readStoryBank(s)).toEqual([entry("b", "2"), entry("a", "3")]);
  });

  it("replaces a corrupt or foreign value instead of throwing", () => {
    expect(readStoryBank(memoryStorage("{not json"))).toEqual([]);
    expect(readStoryBank(memoryStorage('{"a":1}'))).toEqual([]);
    expect(readStoryBank(memoryStorage('[{"question_id":1}, null]'))).toEqual([]);
    const s = memoryStorage("{not json");
    expect(saveToStoryBank(s, entry("a", "1"))).toEqual([entry("a", "1")]);
  });

  it("does not throw when storage is full or blocked", () => {
    const s = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => saveToStoryBank(s, entry("a", "1"))).not.toThrow();
  });
});
