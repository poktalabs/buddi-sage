import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayResponse, StartRoundResponse } from "../../src/shared/api";
import { ApiFailure, type ClientApi } from "../../src/client/api";
import { CLOSING_LINE_CAP_MS, RoundFailure, runRound, type SessionOptions } from "../../src/client/round";

const START: StartRoundResponse = {
  round_id: "r1",
  conversation_token: "tok",
  question: { id: "shipped-system", text: "Walk me through an AI system you shipped." },
  allowance_left: 2,
};
const REPLAY: ReplayResponse = { status: "replayed", final_answer: "a", best_self_text: "b", audio_url: "/api/rounds/r1/audio" };

function fakeApi(overrides: Partial<ClientApi> = {}) {
  const api = {
    me: vi.fn(),
    redeem: vi.fn(),
    addVoice: vi.fn(),
    deleteVoice: vi.fn(),
    startRound: vi.fn(async () => START),
    replay: vi.fn(async () => REPLAY),
    fetchAudio: vi.fn(),
    requestCode: vi.fn(),
    ...overrides,
  };
  return api;
}

function fakeSession() {
  let opts!: SessionOptions;
  const endSession = vi.fn(async () => undefined);
  const startSession = vi.fn(async (o: SessionOptions) => {
    opts = o;
    return { getId: () => "conv-1", endSession };
  });
  return { startSession, endSession, get opts() { return opts; } };
}

const mic = async () => undefined;
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("runRound", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not start (or spend) a Round when the microphone is blocked", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: async () => { throw new Error("NotAllowedError"); } });
    await expect(p).rejects.toEqual(new RoundFailure("mic_blocked"));
    expect(api.startRound).not.toHaveBeenCalled();
    expect(s.startSession).not.toHaveBeenCalled();
  });

  it("passes the token, webrtc and the Question as dynamic variables, with no overrides", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const p = runRound({ questionId: "shipped-system", api, startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    expect(api.startRound).toHaveBeenCalledWith({ question_id: "shipped-system" });
    expect(s.opts.conversationToken).toBe("tok");
    expect(s.opts.connectionType).toBe("webrtc");
    expect(s.opts.dynamicVariables).toEqual({ question_id: "shipped-system", question_text: START.question.text });
    expect(Object.keys(s.opts)).not.toContain("overrides");
    s.opts.onDisconnect({ reason: "agent" });
    await expect(p).rejects.toEqual(new RoundFailure("ended_early"));
  });

  it("after save, waits for the closing line (speaking then listening), ends the session, then asks for the Replay", async () => {
    const order: string[] = [];
    const api = fakeApi({ replay: vi.fn(async () => (order.push("replay"), REPLAY)) });
    const s = fakeSession();
    s.endSession.mockImplementation(async () => void order.push("end"));
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.onModeChange({ mode: "listening" });
    expect(s.opts.clientTools.save_answer({ question_id: "q" })).toBe("saved");
    s.opts.onModeChange({ mode: "listening" }); // not yet: Sage has not spoken the closing line
    await flush();
    expect(order).toEqual([]);
    s.opts.onModeChange({ mode: "speaking" });
    s.opts.onModeChange({ mode: "listening" });
    const result = await p;
    expect(order).toEqual(["end", "replay"]);
    expect(api.replay).toHaveBeenCalledWith("r1", { conversation_id: "conv-1" });
    expect(result).toEqual({ start: START, replay: REPLAY });
  });

  it("counts a closing line already in progress at save time", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.onModeChange({ mode: "speaking" });
    s.opts.clientTools.save_answer({});
    s.opts.onModeChange({ mode: "listening" });
    await expect(p).resolves.toBeTruthy();
    expect(s.endSession).toHaveBeenCalledTimes(1);
  });

  it("ends the session after the cap when the closing line never finishes", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.clientTools.save_answer({});
    await vi.advanceTimersByTimeAsync(CLOSING_LINE_CAP_MS - 1);
    expect(s.endSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBeTruthy();
    expect(s.endSession).toHaveBeenCalledTimes(1);
  });

  it("treats a second save_answer as the same save", async () => {
    const hooks = { onSaved: vi.fn() };
    const s = fakeSession();
    const p = runRound({ questionId: "q", api: fakeApi(), startSession: s.startSession, ensureMicrophone: mic, hooks });
    await flush();
    s.opts.clientTools.save_answer({});
    expect(s.opts.clientTools.save_answer({})).toBe("saved");
    expect(hooks.onSaved).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CLOSING_LINE_CAP_MS);
    await p;
  });

  it("still asks for the Replay when Sage hangs up after the save", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.clientTools.save_answer({});
    s.opts.onDisconnect({ reason: "agent" });
    await expect(p).resolves.toBeTruthy();
    expect(api.replay).toHaveBeenCalledTimes(1);
  });

  it("fails with session_failed on an SDK error before the save, and ends the session", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.onError("boom");
    await expect(p).rejects.toEqual(new RoundFailure("session_failed"));
    expect(s.endSession).toHaveBeenCalledTimes(1);
    expect(api.replay).not.toHaveBeenCalled();
  });

  it("ignores an SDK error after the save", async () => {
    const s = fakeSession();
    const p = runRound({ questionId: "q", api: fakeApi(), startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.clientTools.save_answer({});
    s.opts.onError("late");
    await vi.advanceTimersByTimeAsync(CLOSING_LINE_CAP_MS);
    await expect(p).resolves.toBeTruthy();
  });

  it("fails with session_failed when the session cannot start", async () => {
    const api = fakeApi();
    const p = runRound({ questionId: "q", api, startSession: async () => { throw new Error("no"); }, ensureMicrophone: mic });
    await expect(p).rejects.toEqual(new RoundFailure("session_failed"));
    expect(api.replay).not.toHaveBeenCalled();
  });

  it("aborts (End Round or pagehide): ends the session and asks for no Replay", async () => {
    const api = fakeApi();
    const s = fakeSession();
    const ac = new AbortController();
    const p = runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic, signal: ac.signal });
    await flush();
    ac.abort();
    await expect(p).rejects.toEqual(new RoundFailure("aborted"));
    expect(s.endSession).toHaveBeenCalledTimes(1);
    expect(api.replay).not.toHaveBeenCalled();
  });

  it("does nothing when already aborted", async () => {
    const api = fakeApi();
    const ac = new AbortController();
    ac.abort();
    await expect(runRound({ questionId: "q", api, startSession: fakeSession().startSession, ensureMicrophone: mic, signal: ac.signal })).rejects.toEqual(new RoundFailure("aborted"));
    expect(api.startRound).not.toHaveBeenCalled();
  });

  it("passes startRound failures (allowance_used, voice_required) through without a session", async () => {
    const api = fakeApi({ startRound: vi.fn(async () => { throw new ApiFailure(403, "allowance_used"); }) });
    const s = fakeSession();
    await expect(runRound({ questionId: "q", api, startSession: s.startSession, ensureMicrophone: mic })).rejects.toMatchObject({ code: "allowance_used" });
    expect(s.startSession).not.toHaveBeenCalled();
  });

  it("retries the Replay exactly once on conversation_timeout", async () => {
    const replay = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure(504, "conversation_timeout"))
      .mockResolvedValueOnce(REPLAY);
    const hooks = { onRetrying: vi.fn() };
    const s2 = fakeSession();
    const p2 = runRound({ questionId: "q", api: fakeApi({ replay }), startSession: s2.startSession, ensureMicrophone: mic, hooks });
    await flush();
    s2.opts.clientTools.save_answer({});
    s2.opts.onDisconnect({ reason: "agent" });
    await expect(p2).resolves.toMatchObject({ replay: REPLAY });
    expect(replay).toHaveBeenCalledTimes(2);
    expect(hooks.onRetrying).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second conversation_timeout", async () => {
    const replay = vi.fn(async () => { throw new ApiFailure(504, "conversation_timeout"); });
    const s = fakeSession();
    const p = runRound({ questionId: "q", api: fakeApi({ replay }), startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.clientTools.save_answer({});
    s.opts.onDisconnect({ reason: "agent" });
    await expect(p).rejects.toMatchObject({ code: "conversation_timeout" });
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("does not retry other Replay failures", async () => {
    const replay = vi.fn(async () => { throw new ApiFailure(422, "no_save_answer"); });
    const s = fakeSession();
    const p = runRound({ questionId: "q", api: fakeApi({ replay }), startSession: s.startSession, ensureMicrophone: mic });
    await flush();
    s.opts.clientTools.save_answer({});
    s.opts.onDisconnect({ reason: "agent" });
    await expect(p).rejects.toMatchObject({ code: "no_save_answer" });
    expect(replay).toHaveBeenCalledTimes(1);
  });
});
