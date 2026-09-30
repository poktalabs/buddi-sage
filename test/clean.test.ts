import { describe, expect, it } from "vitest";
import { cleanAnswer } from "../src/worker/clean";
import { checkBestSelfAnswer } from "../src/worker/guards";

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/** Small seeded PRNG so the property test is deterministic without a dependency. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = [
  "um", "Uh", "erm", "er", "uhm", "hmm", "mm", "UM", "I", "i", "we", "built", "added", "a", "reranker",
  "like", "you", "know", "80", "eighty", "half", "maybe", "the", "the", "so", "and", "her", "summer",
  "mmm", "user", "don't", "it's", "RAG", "eval", "set", "percent", "%",
];
const SEPS = [" ", " ", " ", ", ", ". ", "? ", "  ", ",", " ,", "\n", "... "];

function randomAnswer(rand: () => number): string {
  const n = 1 + Math.floor(rand() * 30);
  let s = rand() < 0.2 ? SEPS[Math.floor(rand() * SEPS.length)]! : "";
  for (let i = 0; i < n; i++) {
    s += VOCAB[Math.floor(rand() * VOCAB.length)]!;
    s += SEPS[Math.floor(rand() * SEPS.length)]!;
  }
  return s;
}

describe("cleanAnswer", () => {
  it("removes standalone fillers with their trailing comma", () => {
    expect(cleanAnswer("um, so we had a bot, uh, that made things up")).toBe("So we had a bot, that made things up.");
    expect(cleanAnswer("So, Erm, I added a reranker. Hmm. Mm, then we shipped")).toBe("So, I added a reranker. then we shipped.");
    expect(cleanAnswer("uhm er UH we shipped")).toBe("We shipped.");
  });

  it("does not touch words that only contain a filler", () => {
    expect(cleanAnswer("her summer user mmm umbrella")).toBe("Her summer user mmm umbrella.");
  });

  it("collapses an immediately repeated word", () => {
    expect(cleanAnswer("I, I added a reranker")).toBe("I added a reranker.");
    expect(cleanAnswer("we built the the eval set")).toBe("We built the eval set.");
    expect(cleanAnswer("so I I I, I shipped it")).toBe("So I shipped it.");
    expect(cleanAnswer("I, um, I added it")).toBe("I added it.");
  });

  it("does not collapse a word that merely starts like the previous one", () => {
    expect(cleanAnswer("the theory held")).toBe("The theory held.");
  });

  it("keeps like and you know: they can be content", () => {
    expect(cleanAnswer("it was like 80 questions, you know, from tickets")).toBe("It was like 80 questions, you know, from tickets.");
  });

  it("collapses whitespace and keeps existing terminal punctuation", () => {
    expect(cleanAnswer("  we   built\n it?  ")).toBe("We built it?");
    expect(cleanAnswer("we built it!")).toBe("We built it!");
    expect(cleanAnswer("we built it.")).toBe("We built it.");
  });

  it("an answer that is only fillers becomes empty", () => {
    expect(cleanAnswer("um, uh, hmm")).toBe("");
    expect(cleanAnswer("   ")).toBe("");
  });

  it("the fixture Answer from the guard tests stays faithful and passes the guard", () => {
    const answer =
      "um so at my last job we had this support bot, RAG over the help center docs, and it kept making up refund policies. so I, uh, I added a reranker and we built a small eval set, maybe 80 questions. hallucinations went down, maybe half?";
    const cleaned = cleanAnswer(answer);
    expect(cleaned).toBe(
      "So at my last job we had this support bot, RAG over the help center docs, and it kept making up refund policies. so I added a reranker and we built a small eval set, maybe 80 questions. hallucinations went down, maybe half?",
    );
    expect(checkBestSelfAnswer(answer, cleaned)).toEqual([]);
  });

  it("property: nothing added, every output word appears in the input (500 seeded cases)", () => {
    const rand = mulberry32(20260929);
    for (let i = 0; i < 500; i++) {
      const input = randomAnswer(rand);
      const inputWords = new Set(wordsOf(input));
      const out = cleanAnswer(input);
      for (const w of wordsOf(out)) {
        expect(inputWords.has(w), `"${w}" from ${JSON.stringify(out)} not in ${JSON.stringify(input)}`).toBe(true);
      }
      expect(cleanAnswer(out)).toBe(out);
    }
  });
});
