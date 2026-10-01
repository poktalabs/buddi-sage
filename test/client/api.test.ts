import { describe, expect, it, vi } from "vitest";
import { ApiFailure, httpApi } from "../../src/client/api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("httpApi", () => {
  it("GETs /api/me same-origin and returns the Me body", async () => {
    const me = { kind: "guest", allowance: 3, used: 0, hasContact: true, hasVoice: false };
    const fetchImpl = vi.fn(async () => json(200, me));
    await expect(httpApi(fetchImpl).me()).resolves.toEqual(me);
    expect(fetchImpl).toHaveBeenCalledWith("/api/me", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("POSTs JSON for redeem, rounds and replay", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    const api = httpApi(fetchImpl);
    await api.redeem({ code: "SAGE-AAAA-BBBB", contact: "@mel" });
    await api.startRound({ question_id: "why-this-role" });
    await api.replay("r/1", { conversation_id: "c1" });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual(["/api/redeem", "/api/rounds", "/api/rounds/r%2F1/replay"]);
    for (const [, init] of calls) {
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    }
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ code: "SAGE-AAAA-BBBB", contact: "@mel" });
    expect(JSON.parse(calls[2]![1].body as string)).toEqual({ conversation_id: "c1" });
  });

  it("uploads the Voice sample as multipart field 'sample' with its filename", async () => {
    const fetchImpl = vi.fn(async () => json(200, { hasVoice: true }));
    await expect(httpApi(fetchImpl).addVoice(new Blob(["x"], { type: "audio/webm" }), "voice-sample.webm")).resolves.toEqual({ hasVoice: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/voice");
    expect(init.method).toBe("POST");
    const file = (init.body as FormData).get("sample") as File;
    expect(file.name).toBe("voice-sample.webm");
    expect(init.headers).toBeUndefined(); // the browser sets the multipart boundary
  });

  it("POSTs /api/logout with no body", async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true }));
    await expect(httpApi(fetchImpl).logout()).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/logout");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("DELETEs /api/voice", async () => {
    const fetchImpl = vi.fn(async () => json(200, { hasVoice: false }));
    await expect(httpApi(fetchImpl).deleteVoice()).resolves.toEqual({ hasVoice: false });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("turns an ApiError body into an ApiFailure with its code and status", async () => {
    const api = httpApi(async () => json(403, { error: "allowance_used" }));
    await expect(api.startRound({ question_id: "x" })).rejects.toEqual(new ApiFailure(403, "allowance_used"));
    await expect(api.startRound({ question_id: "x" })).rejects.toMatchObject({ status: 403, code: "allowance_used" });
  });

  it("uses bad_response for a non-JSON error and for a non-JSON success", async () => {
    await expect(httpApi(async () => new Response("oops", { status: 500 })).me()).rejects.toMatchObject({ status: 500, code: "bad_response" });
    await expect(httpApi(async () => new Response("<html>", { status: 200 })).me()).rejects.toMatchObject({ code: "bad_response" });
  });

  it("uses network when fetch itself throws", async () => {
    await expect(httpApi(async () => { throw new TypeError("offline"); }).me()).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("fetches Replay audio as a Blob, once per call", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const blob = await httpApi(fetchImpl).fetchAudio("/api/rounds/r1/audio");
    expect(blob.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
