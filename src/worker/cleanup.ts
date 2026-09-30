// Hourly deletion of Guest Voice clones (spec task 2), run by the cron in index.ts. Which
// clones go is decided by db.listVoicesToClean: never an owner code; a used-up Allowance whose
// last Round started at least an hour ago (the grace keeps a clone alive until that Round's
// Replay), or any clone 7 days old. One failing delete never stops the rest: it is counted,
// logged by status only, and retried on the next hourly run because voice_id stays set.
import type { Env } from "./env";
import { listVoicesToClean } from "./db";
import { UpstreamError, deleteVoice, type FetchImpl } from "./eleven";

// Clears voice_id only if it is still the clone we deleted: a Guest who deleted and uploaded
// a new clone between the listing and this write keeps the new one. Local to this module
// because db.ts is A1's; db.clearVoice clears unconditionally.
async function clearVoiceIfSame(db: D1Database, code: string, voiceId: string): Promise<void> {
  await db
    .prepare("UPDATE codes SET voice_id = NULL, voice_created_at = NULL WHERE code = ? AND voice_id = ?")
    .bind(code, voiceId)
    .run();
}

export async function cleanupVoices(
  env: Env,
  now: Date,
  fetchImpl: FetchImpl = fetch,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const { code, voice_id } of await listVoicesToClean(env.DB, now)) {
    try {
      // A 404 counts as deleted inside deleteVoice, so a clone removed by hand still clears.
      await deleteVoice(env, voice_id, fetchImpl);
      await clearVoiceIfSame(env.DB, code, voice_id);
      deleted++;
    } catch (err) {
      failed++;
      console.error("voice cleanup delete failed", err instanceof UpstreamError ? err.status : err instanceof Error ? err.name : typeof err);
    }
  }
  return { deleted, failed };
}
