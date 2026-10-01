// Mock mode (?mock=1 on a loopback host, see mockMode.ts): a fake Worker and a fake Sage
// session built on the frozen contract types, so every screen is clickable before the
// Worker bodies exist. Decision: state lives in memory only and resets on reload; nothing
// here calls ElevenLabs, Nebius or the Worker. Loaded with a dynamic import, so it is a
// separate chunk the real page never fetches.
//
// Mock codes: any code works; one containing "BAD" is invalid_code, one containing
// "OWNER" gets an owner Allowance. Setting a job always yields MOCK_JOB. The first redeem needs a Contact. The Question
// "why-this-role" answers with status fallback, so that copy can be seen. The canned
// Best-self answer adds no fact the canned Answer lacks, like the real one must not.
import type { CodeKind, JobBrief, Me, ReplayResponse, StartRoundResponse } from "../shared/api";
import { resolveQuestion } from "../shared/questions";
import { ApiFailure, type ClientApi } from "./api";
import type { LiveSession, SessionOptions } from "./round";

// The job any link or text becomes in mock mode (a link containing "blocked" fails instead).
const MOCK_JOB: JobBrief = {
  role: "Senior AI Engineer",
  company: "Acme",
  needs: ["Ship LLM features to production", "Evaluate and monitor model quality", "Own on-call for AI services"],
  questions: [
    { id: "job-1", text: "Walk me through an LLM feature you took to production. What was your part in it?" },
    { id: "job-2", text: "Tell me about a time you caught a drop in model quality. How did you notice, and what did you do?" },
    { id: "job-3", text: "Tell me about an incident you handled on call. What happened, and what changed after?" },
  ],
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type MockRound = { id: string; question_id: string; replayed: boolean };

export function mockApi(delayMs = 350): ClientApi {
  let redeemed = false;
  let hasContact = false;
  let hasVoice = false;
  let kind: CodeKind = "guest";
  let allowance = 3;
  let used = 0;
  let job: JobBrief | null = null;
  let jobSource: string | null = null;
  const rounds = new Map<string, MockRound>();

  const me = (): Me => ({ kind, allowance, used, hasContact, hasVoice, job, jobSource });
  const requireSession = () => {
    if (!redeemed) throw new ApiFailure(401, "unauthorized");
  };

  return {
    async me() {
      await sleep(delayMs);
      requireSession();
      return me();
    },
    async logout() {
      await sleep(delayMs);
      redeemed = false;
    },
    async redeem(req) {
      await sleep(delayMs);
      const code = req.code.trim().toUpperCase();
      if (!code) throw new ApiFailure(400, "bad_request");
      if (code.includes("BAD")) throw new ApiFailure(404, "invalid_code");
      const contact = req.contact?.trim();
      if (!hasContact && !contact) throw new ApiFailure(400, "contact_required");
      if (contact) hasContact = true;
      if (code.includes("OWNER")) {
        kind = "owner";
        allowance = 100;
      }
      redeemed = true;
      return me();
    },
    async addVoice(sample) {
      await sleep(delayMs * 3);
      requireSession();
      if (hasVoice) throw new ApiFailure(409, "voice_exists");
      if (sample.size === 0) throw new ApiFailure(400, "bad_request");
      hasVoice = true;
      return { hasVoice };
    },
    async requestCode(req) {
      await sleep(delayMs);
      if (!/^@?[A-Za-z0-9._]{1,30}$/.test(req.handle.trim())) throw new ApiFailure(400, "bad_request");
      return { ok: true };
    },
    async setJob(req) {
      await sleep(delayMs * 4);
      requireSession();
      const source = req.source.trim();
      if (!source) throw new ApiFailure(400, "bad_request");
      if (source.includes("blocked")) throw new ApiFailure(422, "job_fetch_failed");
      jobSource = source;
      job = MOCK_JOB;
      return me();
    },
    async deleteVoice() {
      await sleep(delayMs);
      requireSession();
      hasVoice = false;
      return { hasVoice };
    },
    async startRound(req): Promise<StartRoundResponse> {
      await sleep(delayMs);
      requireSession();
      const question = resolveQuestion(req.question_id, job);
      if (!question) throw new ApiFailure(400, "unknown_question");
      if (!hasVoice) throw new ApiFailure(409, "voice_required");
      if (used >= allowance) throw new ApiFailure(403, "allowance_used");
      used += 1;
      const id = `mock-round-${used}`;
      rounds.set(id, { id, question_id: question.id, replayed: false });
      return {
        round_id: id,
        conversation_token: "mock-conversation-token",
        question: { id: question.id, text: question.text },
        allowance_left: allowance - used,
        dynamic_variables: {
          question_id: question.id,
          question_text: question.text,
          job_intro: job ? `Today we're practicing for the ${job.role} role. ` : "",
          job_context: job ? `Role: ${job.role}.` : "No specific job.",
        },
      };
    },
    async replay(roundId): Promise<ReplayResponse> {
      await sleep(delayMs * 5);
      requireSession();
      const round = rounds.get(roundId);
      if (!round) throw new ApiFailure(404, "round_not_found");
      if (round.replayed) throw new ApiFailure(409, "round_already_replayed");
      round.replayed = true;
      const fallback = round.question_id === "why-this-role";
      const final_answer =
        "So we, um, we had a support bot that kept making up refund rules. I added a check that only lets it quote the policy page, and the made-up answers mostly stopped.";
      return {
        status: fallback ? "fallback" : "replayed",
        final_answer,
        best_self_text: fallback
          ? "So we had a support bot that kept making up refund rules. I added a check that only lets it quote the policy page, and the made-up answers mostly stopped."
          : "We had a support bot that kept making up refund rules. I added a check so it could only quote the policy page. After that, the made-up answers mostly stopped.",
        audio_url: `/api/rounds/${roundId}/audio`,
      };
    },
    async fetchAudio() {
      await sleep(delayMs);
      requireSession();
      return toneWav(1.5);
    },
  };
}

/**
 * A fake Sage session: Sage asks, the Guest answers, one Pushback, the second attempt,
 * save_answer, the closing line. About nine seconds end to end.
 */
export async function mockStartSession(options: SessionOptions): Promise<LiveSession> {
  await sleep(600);
  let open = true;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => open && fn(), ms));
  const mode = (m: "speaking" | "listening") => () => options.onModeChange({ mode: m });

  at(100, mode("speaking")); // Sage asks the Question
  at(1600, mode("listening")); // the Guest's first Answer
  at(3600, mode("speaking")); // the Pushback
  at(5100, mode("listening")); // the second attempt
  at(7100, () => void options.clientTools.save_answer({ question_id: options.dynamicVariables.question_id }));
  at(7400, mode("speaking")); // the closing line
  at(8900, mode("listening"));

  return {
    getId: () => "mock-conversation-id",
    async endSession() {
      if (!open) return;
      open = false;
      for (const t of timers) clearTimeout(t);
      options.onDisconnect({ reason: "user" });
    },
  };
}

/** A short 16-bit mono WAV tone: stands in for Replay audio and for a test Voice sample. */
export function toneWav(seconds: number, hz = 440): Blob {
  const rate = 16000;
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 800, (n - i) / 800);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * hz * i) / rate) * 8000 * fade, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
