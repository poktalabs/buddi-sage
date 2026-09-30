// Synthetic ElevenLabs Conversation transcripts, written for these tests. No real person's
// words. Shape follows GET /v1/convai/conversations/{id} (checked in the docs 2026-09-29).
import type { TranscriptItem } from "../../src/worker/transcript";

const question = "How would you reduce hallucinations in a production RAG system?";
const firstAnswer = "I would use a bigger model and a longer prompt.";
const pushback = "A bigger model still guesses. How would you know it stopped making things up?";
const secondAnswer = "We built a small eval set from real tickets and I added a reranker.";

const save = (params = '{"question_id":"rag-hallucinations"}') => ({
  tool_name: "save_answer",
  params_as_json: params,
  type: "client",
});

export const happyPath: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: secondAnswer, time_in_call_secs: 20 },
  { role: "agent", message: null, tool_calls: [save()], time_in_call_secs: 30 },
];

export const multiTurnAnswer: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: "  We built a small eval set  ", time_in_call_secs: 20 },
  { role: "user", message: "from real tickets,", time_in_call_secs: 23 },
  { role: "user", message: "and I added a reranker.", time_in_call_secs: 26 },
  { role: "agent", message: "", tool_calls: [save()], time_in_call_secs: 30 },
];

export const toolOnlyBetween: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: "We built a small eval set from real tickets", time_in_call_secs: 20 },
  { role: "agent", message: "   ", tool_calls: [{ tool_name: "skip_turn", params_as_json: "{}", type: "system" }], time_in_call_secs: 24 },
  { role: "user", message: "and I added a reranker.", time_in_call_secs: 26 },
  { role: "agent", message: null, tool_calls: [save()], time_in_call_secs: 30 },
];

export const spokenOnSaveItem: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: secondAnswer, time_in_call_secs: 20 },
  {
    role: "agent",
    message: "Great, you cut hallucinations by 90 percent. Saving that now.",
    tool_calls: [save('{"question_id":"rag-hallucinations","answer":"I cut hallucinations by 90%"}')],
    time_in_call_secs: 30,
  },
];

export const noSaveAnswer: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: secondAnswer, time_in_call_secs: 20 },
  { role: "agent", message: "Thanks, that is all for today.", tool_calls: [{ tool_name: "end_call", params_as_json: "{}", type: "system" }], time_in_call_secs: 30 },
];

export const saveRightAfterPushback: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "agent", message: null, tool_calls: [save()], time_in_call_secs: 13 },
];

export const nullMessages: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: null, time_in_call_secs: 18 },
  { role: "user", message: secondAnswer, time_in_call_secs: 20 },
  { role: "user", message: null, time_in_call_secs: 25 },
  { role: "agent", message: null, tool_calls: null, time_in_call_secs: 27 },
  { role: "agent", message: null, tool_calls: [save()], time_in_call_secs: 30 },
];

export const saveCalledTwice: TranscriptItem[] = [
  { role: "agent", message: question, time_in_call_secs: 0 },
  { role: "user", message: firstAnswer, time_in_call_secs: 5 },
  { role: "agent", message: pushback, time_in_call_secs: 12 },
  { role: "user", message: secondAnswer, time_in_call_secs: 20 },
  { role: "agent", message: null, tool_calls: [save()], time_in_call_secs: 30 },
  { role: "user", message: "Actually we also shortened chunks and saved 40 percent.", time_in_call_secs: 34 },
  { role: "agent", message: "Got it, updating.", time_in_call_secs: 38 },
  { role: "agent", message: null, tool_calls: [save()], time_in_call_secs: 40 },
];

export const expected = { firstAnswer, pushback, secondAnswer };
