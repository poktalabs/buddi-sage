// One Round, from the page's side. Decisions encoded here:
// - The microphone is checked BEFORE POST /api/rounds, so a blocked microphone never
//   spends a Round (a Round counts when it starts).
// - The save_answer client tool only records that Sage saved and answers "saved" at once.
//   The final Answer comes from the ElevenLabs transcript in the Worker, never from the
//   tool's parameters, so nothing here can put model words in front of the Guest.
// - After the save, the page lets Sage finish the closing line (mode goes speaking, then
//   listening) or waits CLOSING_LINE_CAP_MS, whichever is first, then ends the session.
//   Only after endSession does it ask for the Replay.
// - The session ends on every exit path (error, abort, pagehide), because billing runs
//   while it is connected.
// - A conversation_timeout from the Replay is retried exactly once; the Worker leaves the
//   Round started for that.
import type { ReplayResponse, SageDynamicVariables, StartRoundResponse } from "../shared/api";
import { ApiFailure, type ClientApi } from "./api";

export const CLOSING_LINE_CAP_MS = 6000;

export type Mode = "speaking" | "listening";

/** The subset of @elevenlabs/client's startSession options the Round uses. */
export type SessionOptions = {
  conversationToken: string;
  connectionType: "webrtc";
  dynamicVariables: SageDynamicVariables;
  clientTools: { save_answer: (params: unknown) => string };
  onModeChange: (prop: { mode: Mode }) => void;
  onDisconnect: (details: { reason: string }) => void;
  onError: (message: string) => void;
};

export type LiveSession = { getId(): string; endSession(): Promise<void> };
export type StartSession = (options: SessionOptions) => Promise<LiveSession>;

export class RoundFailure extends Error {
  constructor(readonly code: "mic_blocked" | "session_failed" | "ended_early" | "aborted") {
    super(code);
    this.name = "RoundFailure";
  }
}

export type RoundHooks = {
  onStarted?(start: StartRoundResponse): void;
  onConnected?(): void;
  onMode?(mode: Mode): void;
  onSaved?(): void;
  onBuilding?(): void;
  onRetrying?(): void;
};

export type RoundArgs = {
  questionId: string;
  api: ClientApi;
  startSession: StartSession;
  ensureMicrophone: () => Promise<void>;
  hooks?: RoundHooks;
  signal?: AbortSignal;
};

export type RoundResult = { start: StartRoundResponse; replay: ReplayResponse };

type Outcome = { ok: true } | { ok: false; code: RoundFailure["code"] };

export async function runRound(args: RoundArgs): Promise<RoundResult> {
  const { api, hooks = {}, signal } = args;
  if (signal?.aborted) throw new RoundFailure("aborted");

  try {
    await args.ensureMicrophone();
  } catch {
    throw new RoundFailure("mic_blocked");
  }
  if (signal?.aborted) throw new RoundFailure("aborted");

  const start = await api.startRound({ question_id: args.questionId });
  hooks.onStarted?.(start);

  let settled = false;
  let resolveOutcome!: (o: Outcome) => void;
  const outcome = new Promise<Outcome>((r) => (resolveOutcome = r));
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  const settle = (o: Outcome) => {
    if (settled) return;
    settled = true;
    if (capTimer !== undefined) clearTimeout(capTimer);
    resolveOutcome(o);
  };

  let mode: Mode = "listening";
  let saved = false;
  let spokeAfterSave = false;
  const onAbort = () => settle({ ok: false, code: "aborted" });
  signal?.addEventListener("abort", onAbort, { once: true });

  let session: LiveSession | null = null;
  let ended = false;
  const endSession = async () => {
    if (ended || !session) return;
    ended = true;
    try {
      await session.endSession();
    } catch {
      // Already closed: nothing left to bill.
    }
  };

  try {
    try {
      session = await args.startSession({
        conversationToken: start.conversation_token,
        connectionType: "webrtc",
        dynamicVariables: start.dynamic_variables,
        clientTools: {
          save_answer: () => {
            if (!saved) {
              saved = true;
              spokeAfterSave = mode === "speaking";
              hooks.onSaved?.();
              capTimer = setTimeout(() => settle({ ok: true }), CLOSING_LINE_CAP_MS);
            }
            return "saved";
          },
        },
        onModeChange: ({ mode: next }) => {
          mode = next;
          hooks.onMode?.(next);
          if (!saved) return;
          if (next === "speaking") spokeAfterSave = true;
          else if (spokeAfterSave) settle({ ok: true });
        },
        onDisconnect: () => settle(saved ? { ok: true } : { ok: false, code: "ended_early" }),
        onError: () => {
          if (!saved) settle({ ok: false, code: "session_failed" });
        },
      });
    } catch {
      throw new RoundFailure(signal?.aborted ? "aborted" : "session_failed");
    }
    if (!settled) hooks.onConnected?.();

    const result = await outcome;
    const conversationId = session.getId();
    await endSession();
    if (!result.ok) throw new RoundFailure(result.code);

    hooks.onBuilding?.();
    let replay: ReplayResponse;
    try {
      replay = await api.replay(start.round_id, { conversation_id: conversationId });
    } catch (e) {
      if (!(e instanceof ApiFailure && e.code === "conversation_timeout")) throw e;
      hooks.onRetrying?.();
      replay = await api.replay(start.round_id, { conversation_id: conversationId });
    }
    return { start, replay };
  } finally {
    settle({ ok: false, code: "aborted" });
    signal?.removeEventListener("abort", onAbort);
    await endSession();
  }
}
