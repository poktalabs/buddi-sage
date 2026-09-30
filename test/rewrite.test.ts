import { describe, expect, it } from "vitest";
import promptFile from "../content/rewrite-prompt.md?raw";
import { checkBestSelfAnswer } from "../src/worker/guards";
import type { ChatTextArgs } from "../src/worker/nebius";
import { REWRITE_MAX_TOKENS, RETRY_HEADING, bestSelfAnswer, fill, replaceEmDashes, splitPrompt } from "../src/worker/rewrite";

const QUESTION = "Walk me through an AI system you shipped to real users. What was your part in it?";
const ANSWER = "Um so we built a support bot, uh, we built it in about three months and I wrote the the retrieval part.";
const GOOD = "We built a support bot in about three months, and I wrote the retrieval part.";
const BAD_NUMBER = "We built a support bot in three months for 500 users, and I wrote the retrieval part.";
const BAD_WE = "I built a support bot in about three months and I wrote the retrieval part.";

function fakeChat(replies: (string | Error)[]) {
  const calls: ChatTextArgs[] = [];
  const chatText = async (args: ChatTextArgs) => {
    calls.push(args);
    const next = replies[calls.length - 1];
    if (next === undefined) throw new Error("unexpected extra call");
    if (next instanceof Error) throw next;
    return next;
  };
  return { chatText, calls };
}

const deps = (chatText: (args: ChatTextArgs) => Promise<string>) => ({ chatText, model: "rewrite-model" });

function systemOf(args: ChatTextArgs): string {
  return args.messages.find((m) => m.role === "system")!.content;
}

describe("the prompt file", () => {
  it("loads through ?raw and has the placeholders and the retry section", () => {
    expect(promptFile).toContain("{{question}}");
    expect(promptFile).toContain("{{answer}}");
    expect(promptFile).toContain(RETRY_HEADING);
    const { system, addendum } = splitPrompt(promptFile);
    expect(system).not.toContain(RETRY_HEADING);
    expect(system).not.toContain("{{failures}}");
    expect(addendum).toContain("{{failures}}");
    expect(addendum).not.toContain(RETRY_HEADING);
  });

  it("fill replaces every placeholder in one pass and never re-scans inserted text", () => {
    expect(fill("{{a}} and {{b}} {{c}}", { a: "{{b}}", b: "$& x" })).toBe("{{b}} and $& x {{c}}");
  });

  it("replaceEmDashes turns each em-dash into a comma and a space", () => {
    expect(replaceEmDashes("We shipped it — then we fixed it—fast")).toBe("We shipped it, then we fixed it, fast");
  });
});

describe("bestSelfAnswer", () => {
  it("passes on the first attempt", async () => {
    const { chatText, calls } = fakeChat([GOOD]);
    const res = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(chatText));
    expect(res).toEqual({ status: "replayed", text: GOOD, attempts: 1, failures: [] });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe("rewrite-model");
    expect(call.max_tokens).toBe(REWRITE_MAX_TOKENS);
    expect(call.max_tokens).toBeGreaterThanOrEqual(4000);
    const system = systemOf(call);
    expect(system).toContain(`Question: ${QUESTION}`);
    expect(system).toContain(`Answer: ${ANSWER}`);
    expect(system).not.toMatch(/\{\{\w+\}\}/);
    expect(system).not.toContain("Retry addendum");
    const user = call.messages.find((m) => m.role === "user")!.content;
    expect(user.length).toBeLessThan(80);
  });

  it("passes on the retry, which carries the filled addendum and never the heading", async () => {
    const { chatText, calls } = fakeChat([BAD_NUMBER, GOOD]);
    const res = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(chatText));
    expect(res.status).toBe("replayed");
    expect(res.text).toBe(GOOD);
    expect(res.attempts).toBe(2);
    expect(res.failures).toEqual([{ rule: "new-number", detail: '"500" is not in the Answer' }]);
    const retry = systemOf(calls[1]!);
    expect(retry).toContain("Your previous rewrite broke these rules:");
    expect(retry).toContain('- new-number: "500" is not in the Answer');
    expect(retry).toContain(`Answer: ${ANSWER}`);
    expect(retry).not.toContain(RETRY_HEADING);
    expect(retry).not.toContain("Retry addendum");
    expect(retry).not.toMatch(/\{\{\w+\}\}/);
    expect(systemOf(calls[0]!)).not.toContain("Your previous rewrite");
  });

  it("falls back to the Guest's own words after two failed attempts, keeping every failure", async () => {
    const { chatText, calls } = fakeChat([BAD_NUMBER, BAD_WE]);
    const res = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(chatText));
    expect(calls).toHaveLength(2);
    expect(res.status).toBe("fallback");
    expect(res.attempts).toBe(2);
    expect(res.text).toBe("So we built a support bot, we built it in about three months and I wrote the retrieval part.");
    expect(res.failures.map((f) => f.rule)).toEqual(["new-number", "we-to-i"]);
  });

  it("treats a chatText exception as a failed attempt, never a pass", async () => {
    const once = fakeChat([new Error("nebius chat completion failed with 500"), GOOD]);
    const res1 = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(once.chatText));
    expect(res1).toEqual({ status: "replayed", text: GOOD, attempts: 2, failures: [] });
    // No guard failures to name, so the second attempt is a plain retry without the addendum.
    expect(systemOf(once.calls[1]!)).not.toContain("Your previous rewrite");

    const twice = fakeChat([new Error("boom"), new Error("boom")]);
    const res2 = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(twice.chatText));
    expect(res2.status).toBe("fallback");
    expect(res2.attempts).toBe(2);
    expect(res2.failures).toEqual([]);
  });

  it("treats empty output (or only an em-dash) as a failed attempt", async () => {
    const { chatText } = fakeChat(["", " — "]);
    const res = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(chatText));
    expect(res.status).toBe("fallback");
  });

  it("replaces em-dashes in model output before the guard check", async () => {
    const { chatText } = fakeChat(["We built a support bot — in about three months — and I wrote the retrieval part."]);
    const res = await bestSelfAnswer({ question: QUESTION, answer: ANSWER }, deps(chatText));
    expect(res.status).toBe("replayed");
    expect(res.text).toBe("We built a support bot, in about three months, and I wrote the retrieval part.");
    expect(res.text).not.toContain("—");
  });

  it("the fallback text adds nothing: every word was said, and the guard rules pass", async () => {
    const answers = [
      ANSWER,
      "we we shipped it in like two weeks, um, and honestly I think maybe half the tickets went away",
      "uh. hmm, erm... it failed because the the eval set was stale",
      "um uh",
    ];
    const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    for (const answer of answers) {
      const { chatText } = fakeChat([new Error("x"), new Error("x")]);
      const res = await bestSelfAnswer({ question: QUESTION, answer }, deps(chatText));
      expect(res.status).toBe("fallback");
      expect(res.text.length).toBeGreaterThan(0);
      const said = new Set(tokens(answer));
      for (const w of tokens(res.text)) expect(said.has(w)).toBe(true);
      expect(checkBestSelfAnswer(answer, res.text)).toEqual([]);
    }
  });
});
