import { describe, expect, it } from "vitest";
import { extensionFor, pickMimeType, sampleFilename } from "../../src/client/recorder";

describe("recorder format choice", () => {
  it("prefers WebM/Opus", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });
  it("falls back to MP4 (Safari)", () => {
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
  });
  it("returns null when neither is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
  it("names the upload with the matching extension", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(sampleFilename("audio/mp4")).toBe("voice-sample.m4a");
    expect(sampleFilename("audio/webm")).toBe("voice-sample.webm");
  });
});
