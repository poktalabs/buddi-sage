// User-facing words for every failure the page can hit. Decision: one table keyed by the
// contract's error codes (src/shared/api.ts), in glossary words, so no screen shows a raw
// code and no copy uses a word CONTEXT.md keeps out of user-facing copy (test/client/copy.test.ts).

export const FAILURE_COPY: Record<string, string> = {
  unauthorized: "Your Session has ended. Enter your code again to continue.",
  forbidden: "Only an owner code can open the dashboard.",
  bad_request: "Something in that request was not right. Please try again.",
  invalid_code: "That code does not work. Check it and try again.",
  contact_required: "Add an email or X handle the first time you use this code.",
  voice_required: "Record your Voice sample before starting a Round.",
  voice_exists: "You already have a Voice clone. Delete it first to record a new one.",
  voice_verification_required:
    "That Voice sample could not be used for a Voice clone. Record it again, reading the script in your own voice.",
  allowance_used: "You have used every Round on this code.",
  unknown_question: "That Question is not in the Question set.",
  round_not_found: "That Round could not be found.",
  round_already_replayed: "That Round already has its Replay.",
  conversation_failed: "Sage lost the thread of that Round. Please try another Round.",
  conversation_timeout: "Your Replay is taking longer than expected. Please try again in a moment.",
  no_save_answer: "Sage did not save an Answer in that Round, so there is no Replay this time.",
  empty_answer: "We did not hear an Answer to save in that Round, so there is no Replay this time.",
  upstream_error: "A service we depend on did not answer. Please try again in a moment.",
  rate_limited: "Too many requests from here. Please try again in an hour.",
  job_fetch_failed: "We could not read that link. Some job sites block it. Paste the job post text instead.",
  job_unreadable: "We could not find a job in that. Paste the job post, or at least the job title.",
  job_limit: "This code has set its job too many times. Keep practicing with the current one.",
  network: "You look offline. Check your connection and try again.",
  bad_response: "Something went wrong on our side. Please try again.",
  // Page-side Round failures (round.ts).
  mic_blocked: "We could not use your microphone. Allow microphone access and check one is connected, then try again.",
  session_failed: "We could not connect you to Sage. Please try again.",
  ended_early: "The Round ended before Sage saved your Answer, so there is no Replay this time.",
  aborted: "You ended the Round.",
  recorder_unavailable: "This browser cannot record audio. Try a recent Chrome, Edge, Firefox or Safari.",
};

export function failureMessage(code: string): string {
  return FAILURE_COPY[code] ?? FAILURE_COPY.bad_response!;
}
