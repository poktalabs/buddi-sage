// Voice sample recording. Decision: the browser records with MediaRecorder in the best
// supported of WebM/Opus or MP4/AAC, and the page uploads that file unchanged. Whether
// ElevenLabs accepts WebM is decided by the gate 1 to 2 probe; if it does not, this one
// module is swapped (A5, Wave 2) and nothing else in the page changes. It has no imports
// on purpose, so the swap cannot ripple.

/** Preferred container types, best first. */
export const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4"] as const;

/** The first preferred type the browser can record, or null if none. */
export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of PREFERRED_MIME_TYPES) {
    if (isSupported(type)) return type;
  }
  return null;
}

/** File extension for an upload, so the Worker and ElevenLabs see the right format. */
export function extensionFor(mimeType: string): "webm" | "m4a" {
  return mimeType.toLowerCase().startsWith("audio/mp4") ? "m4a" : "webm";
}

/** Upload filename for a recorded Voice sample. */
export function sampleFilename(mimeType: string): string {
  return `voice-sample.${extensionFor(mimeType)}`;
}

export class RecorderUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecorderUnavailable";
  }
}

/**
 * Asks for the microphone and starts recording. Only the Voice sample screen calls this,
 * and that screen is only reachable after Consent.
 */
export async function startRecording(): Promise<{ stop(): Promise<Blob>; mimeType: string }> {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new RecorderUnavailable("This browser cannot record audio.");
  }
  const chosen = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  if (!chosen) throw new RecorderUnavailable("This browser cannot record WebM or MP4 audio.");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: chosen });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  recorder.start(1000);
  const mimeType = recorder.mimeType || chosen;

  let stopped: Promise<Blob> | null = null;
  return {
    mimeType,
    stop() {
      if (stopped) return stopped;
      stopped = new Promise<Blob>((resolve) => {
        const finish = () => {
          for (const track of stream.getTracks()) track.stop();
          resolve(new Blob(chunks, { type: mimeType }));
        };
        if (recorder.state === "inactive") finish();
        else {
          recorder.addEventListener("stop", finish, { once: true });
          recorder.stop();
        }
      });
      return stopped;
    },
  };
}
