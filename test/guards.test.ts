import { describe, expect, it } from "vitest";
import { checkBestSelfAnswer, quantities } from "../src/worker/guards";

const answer =
  "um so at my last job we had this support bot, RAG over the help center docs, and it kept making up refund policies. so I added a reranker and we built a small eval set, maybe 80 questions. hallucinations went down, maybe half?";

describe("checkBestSelfAnswer", () => {
  it("passes a faithful rewrite", () => {
    const rewrite =
      "Our support bot answered from the help center with RAG, and it kept inventing refund policies. I added a reranker, and we built an eval set of about 80 real questions. Hallucinations dropped by roughly half.";
    expect(checkBestSelfAnswer(answer, rewrite)).toEqual([]);
  });

  it("flags a team action claimed as individual (the MiniMax drift)", () => {
    const rewrite = "I built an eval set of 80 questions from real tickets.";
    expect(checkBestSelfAnswer(answer, rewrite)).toContainEqual({ rule: "we-to-i", detail: '"we built" became "I built"' });
  });

  it("keeps what the speaker really did alone", () => {
    expect(checkBestSelfAnswer(answer, "I added a reranker.")).toEqual([]);
  });

  it("flags a number the speaker never said (a hedge made certain)", () => {
    const failures = checkBestSelfAnswer(answer, "Hallucinations dropped 52% across 80 questions.");
    expect(failures.map((f) => f.rule)).toEqual(["new-number", "new-number"]);
  });

  it("treats spelled-out and digit numbers as the same quantity", () => {
    expect(quantities("eighty questions")).toEqual(quantities("80 questions"));
    expect(checkBestSelfAnswer("we had eighty questions", "We had 80 questions.")).toEqual([]);
  });
});
