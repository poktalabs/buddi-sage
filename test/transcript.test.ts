import { describe, expect, it } from "vitest";
import { extractFinalAnswer, type TranscriptItem } from "../src/worker/transcript";
import {
  expected,
  happyPath,
  multiTurnAnswer,
  noSaveAnswer,
  nullMessages,
  saveCalledTwice,
  saveRightAfterPushback,
  spokenOnSaveItem,
  toolOnlyBetween,
} from "./fixtures/transcripts";

describe("extractFinalAnswer", () => {
  it("happy path: the Guest's words after the Pushback", () => {
    expect(extractFinalAnswer(happyPath)).toEqual({ ok: true, answer: expected.secondAnswer, pushback: expected.pushback });
  });

  it("joins an Answer given across several user turns, in order, trimmed, with single spaces", () => {
    expect(extractFinalAnswer(multiTurnAnswer)).toEqual({
      ok: true,
      answer: "We built a small eval set from real tickets, and I added a reranker.",
      pushback: expected.pushback,
    });
  });

  it("skips a tool-only agent item between the Answer and the save", () => {
    expect(extractFinalAnswer(toolOnlyBetween)).toEqual({
      ok: true,
      answer: "We built a small eval set from real tickets and I added a reranker.",
      pushback: expected.pushback,
    });
  });

  it("ignores what Sage says (and passes to the tool) on the save item itself", () => {
    const r = extractFinalAnswer(spokenOnSaveItem);
    expect(r).toEqual({ ok: true, answer: expected.secondAnswer, pushback: expected.pushback });
    if (r.ok) {
      expect(r.answer).not.toContain("90");
      expect(r.answer).not.toContain("Saving");
    }
  });

  it("no save_answer at all is no_save_answer", () => {
    expect(extractFinalAnswer(noSaveAnswer)).toEqual({ ok: false, reason: "no_save_answer" });
  });

  it("save_answer straight after the Pushback, with no user turn, is empty_answer", () => {
    expect(extractFinalAnswer(saveRightAfterPushback)).toEqual({ ok: false, reason: "empty_answer" });
  });

  it("skips null messages on both sides", () => {
    expect(extractFinalAnswer(nullMessages)).toEqual({ ok: true, answer: expected.secondAnswer, pushback: expected.pushback });
  });

  it("the first save_answer wins when it is called twice", () => {
    const r = extractFinalAnswer(saveCalledTwice);
    expect(r).toEqual({ ok: true, answer: expected.secondAnswer, pushback: expected.pushback });
    if (r.ok) expect(r.answer).not.toContain("40");
  });

  it("an empty transcript is no_save_answer", () => {
    expect(extractFinalAnswer([])).toEqual({ ok: false, reason: "no_save_answer" });
  });

  it("a save_answer as the very first item is empty_answer", () => {
    const items: TranscriptItem[] = [{ role: "agent", message: null, tool_calls: [{ tool_name: "save_answer" }] }];
    expect(extractFinalAnswer(items)).toEqual({ ok: false, reason: "empty_answer" });
  });

  it("an Answer with no agent speech before it has an empty Pushback", () => {
    const items: TranscriptItem[] = [
      { role: "user", message: "We shipped it." },
      { role: "agent", message: null, tool_calls: [{ tool_name: "save_answer" }] },
    ];
    expect(extractFinalAnswer(items)).toEqual({ ok: true, answer: "We shipped it.", pushback: "" });
  });

  it("a user item carrying tool_calls is not treated as the save", () => {
    const items = [
      { role: "user", message: "hi", tool_calls: [{ tool_name: "save_answer" }] },
    ] as TranscriptItem[];
    expect(extractFinalAnswer(items)).toEqual({ ok: false, reason: "no_save_answer" });
  });
});
