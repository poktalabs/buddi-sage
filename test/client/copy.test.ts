import { describe, expect, it } from "vitest";
import { FAILURE_COPY, failureMessage } from "../../src/client/copy";

// Every ApiError code in the frozen contract (IMPLEMENTATION-PLAN, Wave 0).
const CONTRACT_CODES = [
  "unauthorized", "bad_request", "invalid_code", "contact_required", "voice_required", "voice_exists",
  "voice_verification_required", "allowance_used", "unknown_question", "round_not_found",
  "round_already_replayed", "conversation_failed", "conversation_timeout", "no_save_answer",
  "empty_answer", "upstream_error",
];

describe("failure copy", () => {
  it("has words for every contract error code", () => {
    for (const code of CONTRACT_CODES) expect(FAILURE_COPY[code], code).toBeTruthy();
  });
  it("falls back to a generic message for an unknown code", () => {
    expect(failureMessage("something_new")).toBe(FAILURE_COPY.bad_response);
  });
  it("never uses words the glossary keeps out of user-facing copy", () => {
    for (const text of Object.values(FAILURE_COPY)) {
      expect(text).not.toMatch(/\b(agent|credits?|quota|model answer)\b/i);
      expect(text).not.toContain(String.fromCharCode(0x2014)); // no em-dashes in copy
    }
  });
});
