// The browser/Worker contract for Tier A. Frozen at Wave 0: agents build against it and
// report (not edit) any change they need. Error bodies are always ApiError.
export type CodeKind = "guest" | "gift" | "owner";

export type ApiError = { error: string };

export type RedeemRequest = { code: string; contact?: string };
export type Me = {
  kind: CodeKind;
  allowance: number;
  used: number;
  hasContact: boolean;
  hasVoice: boolean;
  /** The target job's brief, once built. */
  job: JobBrief | null;
  /** What the Guest (or their code request) gave for the job: a link or text. Prefills the job screen. */
  jobSource: string | null;
};

// The target job, read by the job model from a link or pasted post. Questions get ids
// "job-1".."job-3" so a Round can name one; the fixed Question set stays as the fallback.
export type JobBrief = {
  role: string;
  company: string | null;
  needs: string[];
  questions: { id: string; text: string }[];
};
export type SetJobRequest = { source: string };

export type VoiceResponse = { hasVoice: boolean };

export type StartRoundRequest = { question_id: string };
export type StartRoundResponse = {
  round_id: string;
  conversation_token: string;
  question: { id: string; text: string };
  allowance_left: number;
  /** Everything the page passes to Conversation.startSession, built by the Worker. */
  dynamic_variables: SageDynamicVariables;
};
// Dynamic variables the page passes to Conversation.startSession; the Sage prompt uses them.
// job_intro opens Sage's first message ("" without a job); job_context grounds the Pushback.
export type SageDynamicVariables = { question_id: string; question_text: string; job_intro: string; job_context: string };

export type ReplayRequest = { conversation_id: string };
export type ReplayResponse = {
  status: "replayed" | "fallback";
  final_answer: string;
  best_self_text: string;
  audio_url: string; // GET, same origin, cookie-authenticated, audio/mpeg
};

export type AdminCreateCodesRequest = {
  kind: CodeKind;
  count?: number; // default 1
  allowance?: number; // guest default 3, owner default 100, gift required
  note?: string;
};
export type AdminCreateCodesResponse = { codes: string[] };

// Landing page "Request a code" form: the social handle the requester will DM Mel from, and
// optionally the job they are preparing for (a link or a title). `website` is a honeypot.
export type Lang = "en" | "es";
/** Where a requester will DM Mel: the logo they tapped on the landing form. */
export type Platform = "instagram" | "x" | "tiktok";
export const PLATFORMS: readonly Platform[] = ["instagram", "x", "tiktok"];
export type CodeRequestBody = { handle: string; platform?: Platform; job?: string; lang?: Lang; website?: string };
export type CodeRequestResponse = { ok: true };

export const STORY_BANK_KEY = "buddi-sage:story-bank";
// question_text tells job Questions apart: "job-1" is a different Question for each job.
export type StoryBankEntry = { question_id: string; question_text?: string; final_answer: string; best_self_text: string; saved_at: string };
