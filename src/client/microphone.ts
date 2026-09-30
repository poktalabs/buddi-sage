// Microphone check before a Round. Decision: ask for the microphone and release it at
// once, before POST /api/rounds, so a blocked microphone never costs the Guest a Round.
// Only the Round screen calls this, which needs a Voice clone, which needs Consent.

export async function ensureMicrophone(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("no microphone API");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}
