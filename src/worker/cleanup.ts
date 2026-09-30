// Hourly deletion of Guest Voice clones (spec task 2). Owner from Wave 2: A5. Wave 1 stub so the
// scheduled handler is wired once; it deletes nothing until A5 fills the body.
import type { Env } from "./env";

export async function cleanupVoices(_env: Env, _now: Date): Promise<{ deleted: number; failed: number }> {
  return { deleted: 0, failed: 0 };
}
