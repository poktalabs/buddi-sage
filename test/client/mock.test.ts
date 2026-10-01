import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, mockStartSession, toneWav } from "../../src/client/mock";
import type { SessionOptions } from "../../src/client/round";

describe("mock Worker", () => {
  it("walks the contract: 401, contact_required, redeem, voice, Round, Replay", async () => {
    const api = mockApi(0);
    await expect(api.me()).rejects.toMatchObject({ code: "unauthorized" });
    await expect(api.redeem({ code: "SAGE-BAD1-0000" })).rejects.toMatchObject({ code: "invalid_code" });
    await expect(api.redeem({ code: "SAGE-AAAA-BBBB" })).rejects.toMatchObject({ code: "contact_required" });
    const me = await api.redeem({ code: "sage-aaaa-bbbb", contact: "@mel" });
    expect(me).toEqual({ kind: "guest", allowance: 3, used: 0, hasContact: true, hasVoice: false, job: null, jobSource: null });
    await expect(api.startRound({ question_id: "shipped-system" })).rejects.toMatchObject({ code: "voice_required" });
    await expect(api.addVoice(new Blob(["x"]), "voice-sample.webm")).resolves.toEqual({ hasVoice: true });
    await expect(api.addVoice(new Blob(["x"]), "voice-sample.webm")).rejects.toMatchObject({ code: "voice_exists" });
    await expect(api.startRound({ question_id: "nope" })).rejects.toMatchObject({ code: "unknown_question" });
    const start = await api.startRound({ question_id: "shipped-system" });
    expect(start.allowance_left).toBe(2);
    const replay = await api.replay(start.round_id, { conversation_id: "c" });
    expect(replay.status).toBe("replayed");
    await expect(api.replay(start.round_id, { conversation_id: "c" })).rejects.toMatchObject({ code: "round_already_replayed" });
    await expect(api.replay("missing", { conversation_id: "c" })).rejects.toMatchObject({ code: "round_not_found" });
    expect((await api.fetchAudio(replay.audio_url)).type).toBe("audio/wav");
  });

  it("shows the fallback status for why-this-role and runs out of Rounds after the Allowance", async () => {
    const api = mockApi(0);
    await api.redeem({ code: "X", contact: "a@b.co" });
    await api.addVoice(new Blob(["x"]), "voice-sample.webm");
    const r = await api.startRound({ question_id: "why-this-role" });
    expect((await api.replay(r.round_id, { conversation_id: "c" })).status).toBe("fallback");
    await api.startRound({ question_id: "why-this-role" });
    await api.startRound({ question_id: "why-this-role" });
    await expect(api.startRound({ question_id: "why-this-role" })).rejects.toMatchObject({ code: "allowance_used" });
  });

  it("gives an OWNER code the owner Allowance and deletes the voice", async () => {
    const api = mockApi(0);
    expect(await api.redeem({ code: "SAGE-OWNER", contact: "@mel" })).toMatchObject({ kind: "owner", allowance: 100 });
    await api.addVoice(new Blob(["x"]), "v.webm");
    await expect(api.deleteVoice()).resolves.toEqual({ hasVoice: false });
  });
});

describe("mock Sage session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("speaks, calls save_answer once, closes, and stops on endSession", async () => {
    const modes: string[] = [];
    const save = vi.fn(() => "saved");
    const onDisconnect = vi.fn();
    const opts: SessionOptions = {
      conversationToken: "t",
      connectionType: "webrtc",
      dynamicVariables: { question_id: "q", question_text: "Q", job_intro: "", job_context: "No specific job." },
      clientTools: { save_answer: save },
      onModeChange: ({ mode }) => void modes.push(mode),
      onDisconnect,
      onError: () => undefined,
    };
    const p = mockStartSession(opts);
    await vi.advanceTimersByTimeAsync(600);
    const session = await p;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledWith({ question_id: "q" });
    expect(modes.at(-2)).toBe("speaking");
    expect(modes.at(-1)).toBe("listening");
    await session.endSession();
    await session.endSession();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe("toneWav", () => {
  it("builds a valid WAV header and length", async () => {
    const blob = toneWav(0.5);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(bytes.length).toBe(44 + 8000 * 2);
  });
});

describe("mock Replay text", () => {
  it("passes the same guard as the real Replay (it demos the product promise)", async () => {
    const { checkBestSelfAnswer } = await import("../../src/worker/guards");
    const api = mockApi(0);
    await api.redeem({ code: "X", contact: "@m" });
    await api.addVoice(new Blob(["x"]), "v.webm");
    for (const q of ["shipped-system", "why-this-role"]) {
      const r = await api.startRound({ question_id: q });
      const replay = await api.replay(r.round_id, { conversation_id: "c" });
      expect(checkBestSelfAnswer(replay.final_answer, replay.best_self_text)).toEqual([]);
    }
  });
});
