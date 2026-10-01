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
};

export type VoiceResponse = { hasVoice: boolean };

export type StartRoundRequest = { question_id: string };
export type StartRoundResponse = {
  round_id: string;
  conversation_token: string;
  question: { id: string; text: string };
  allowance_left: number;
};
// Dynamic variables the page passes to Conversation.startSession; the Sage prompt uses them.
export type SageDynamicVariables = { question_id: string; question_text: string };

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

// Landing page "Request a code" form: the handle the requester will DM Mel from, and
// optionally the job they are preparing for. `website` is a honeypot: people leave it empty.
export type Lang = "en" | "es";
export type SocialPlatform = "instagram" | "x" | "tiktok";
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = ["instagram", "x", "tiktok"];
export type CodeRequestBody = { platform: SocialPlatform; handle: string; job_url?: string; lang?: Lang; website?: string };
export type CodeRequestResponse = { ok: true };

export const STORY_BANK_KEY = "buddi-sage:story-bank";
export type StoryBankEntry = { question_id: string; final_answer: string; best_self_text: string; saved_at: string };
