// Voice clone routes (spec task 2). A code holds at most one Voice clone: a second upload is
// refused with 409 voice_exists before any upstream call, and the Guest deletes first, because
// the ElevenLabs Creator plan has 30 voice slots and a leaked clone holds one forever. The
// clone's name is `sage-<kind>-<first 8 hex of SHA-256(code)>`: enough to find it in the
// workspace, never the Contact or the raw code. A sample ElevenLabs flags for verification is
// deleted at once, since a clone we cannot use still spends a slot. Deleting is the Guest's
// explicit action, so it is allowed for every kind, owner included.
import type { VoiceResponse } from "../../shared/api";
import type { Env, Session } from "../env";
import { clearVoice, getCode } from "../db";
import * as eleven from "../eleven";
import { UpstreamError, type FetchImpl } from "../eleven";
import { error, json } from "../http";

/** Largest Voice sample accepted, in bytes (ElevenLabs allows more; a minute of Opus is far less). */
export const MAX_SAMPLE_BYTES = 20 * 1024 * 1024;
// Multipart framing around the sample; a Content-Length past sample plus this is refused unread.
const MULTIPART_SLACK_BYTES = 64 * 1024;
const KNOWN_EXTENSIONS = new Set(["webm", "m4a", "mp4", "mp3", "wav", "ogg"]);

/** The Voice clone name for a code: kind plus a short hash, so neither the code nor the Contact leaves the Worker. */
export async function voiceName(kind: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const hex = Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sage-${kind}-${hex}`;
}

/**
 * Upload filename. Only the extension of the Guest's filename is kept (and only a known audio
 * one), so no Guest-typed text goes upstream; otherwise the extension follows the MIME type.
 */
export function sampleFilename(uploaded: string, mimeType: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(uploaded)?.[1]?.toLowerCase();
  if (ext && KNOWN_EXTENSIONS.has(ext)) return `voice-sample.${ext}`;
  return mimeType.toLowerCase().startsWith("audio/mp4") ? "voice-sample.m4a" : "voice-sample.webm";
}

// Sets the Voice clone only if the code still has none, so two concurrent uploads cannot both
// win and leave one clone orphaned in the workspace. Local to this module because db.ts is
// A1's; db.setVoice overwrites unconditionally.
async function setVoiceIfNone(db: D1Database, code: string, voiceId: string, now: Date): Promise<boolean> {
  const res = await db
    .prepare("UPDATE codes SET voice_id = ?, voice_created_at = ? WHERE code = ? AND voice_id IS NULL")
    .bind(voiceId, now.toISOString(), code)
    .run();
  return res.meta.changes === 1;
}

function logUpstream(what: string, err: unknown): void {
  // Status and error name only: no key, no Guest words.
  const detail = err instanceof UpstreamError ? err.status : err instanceof Error ? err.name : typeof err;
  console.error(what, detail);
}

// Removes a clone this request just made and will not keep. Failure is logged, not thrown:
// the Guest's answer does not change, and the id in the log lets Mel remove it by hand.
async function discardVoice(env: Env, voiceId: string, fetchImpl: FetchImpl): Promise<void> {
  try {
    await eleven.deleteVoice(env, voiceId, fetchImpl);
  } catch (err) {
    logUpstream(`voice discard failed for ${voiceId}`, err);
  }
}

export async function addVoice(
  req: Request,
  env: Env,
  session: Session,
  _params?: { id: string },
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const row = await getCode(env.DB, session.code);
  if (!row) return error("unauthorized", 401);
  if (row.voice_id !== null) return error("voice_exists", 409);

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_SAMPLE_BYTES + MULTIPART_SLACK_BYTES) return error("bad_request", 400);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error("bad_request", 400);
  }
  const sample = form.get("sample");
  if (sample === null || typeof sample === "string") return error("bad_request", 400);
  if (sample.size === 0 || sample.size > MAX_SAMPLE_BYTES) return error("bad_request", 400);

  let created: eleven.AddVoiceResult;
  try {
    created = await eleven.addVoice(
      env,
      {
        name: await voiceName(row.kind, row.code),
        sample,
        filename: sampleFilename(sample instanceof File ? sample.name : "", sample.type),
      },
      fetchImpl,
    );
  } catch (err) {
    logUpstream("voice add failed", err);
    return error("upstream_error", 502);
  }

  if (created.requires_verification) {
    await discardVoice(env, created.voice_id, fetchImpl);
    return error("voice_verification_required", 422);
  }

  if (!(await setVoiceIfNone(env.DB, row.code, created.voice_id, new Date()))) {
    // Another upload for this code finished first; keep that one and free this slot.
    await discardVoice(env, created.voice_id, fetchImpl);
    return error("voice_exists", 409);
  }

  const body: VoiceResponse = { hasVoice: true };
  return json(body);
}

export async function deleteVoice(
  _req: Request,
  env: Env,
  session: Session,
  _params?: { id: string },
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const row = await getCode(env.DB, session.code);
  if (!row) return error("unauthorized", 401);

  if (row.voice_id !== null) {
    try {
      // A 404 counts as deleted inside eleven.deleteVoice.
      await eleven.deleteVoice(env, row.voice_id, fetchImpl);
    } catch (err) {
      // Keep voice_id so the Guest can retry; clearing it would orphan the clone.
      logUpstream("voice delete failed", err);
      return error("upstream_error", 502);
    }
    await clearVoice(env.DB, row.code);
  }

  const body: VoiceResponse = { hasVoice: false };
  return json(body);
}
