import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { createCodes, getCode, setContact, setVoice } from "../src/worker/db";
import { MAX_SAMPLE_BYTES, addVoice, deleteVoice, sampleFilename, voiceName } from "../src/worker/routes/voice";
import { testEnv } from "./support/fakeD1";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

function noFetch() {
  return fakeFetch(() => {
    throw new Error("no upstream call expected");
  });
}

const isAdd = (c: Call) => c.url.endsWith("/v1/voices/add") && c.init.method === "POST";
const isDelete = (c: Call, id: string) => c.url.endsWith(`/v1/voices/${id}`) && c.init.method === "DELETE";

function upload(sample?: Blob | string, filename = "voice-sample.webm"): Request {
  const form = new FormData();
  if (typeof sample === "string") form.append("sample", sample);
  else if (sample) form.append("sample", sample, filename);
  return new Request("https://sage.test/api/voice", { method: "POST", body: form });
}

const webm = () => new Blob([new Uint8Array(2048)], { type: "audio/webm;codecs=opus" });

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as ApiError).error;
}

let env: Env;
let code: string;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  env = testEnv();
  [code] = (await createCodes(env.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
  await setContact(env.DB, code, "guest@example.com");
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe("voiceName", () => {
  it("is sage-<kind>-<first 8 hex of SHA-256(code)>", async () => {
    // SHA-256("abc") starts ba7816bf.
    expect(await voiceName("guest", "abc")).toBe("sage-guest-ba7816bf");
    expect(await voiceName("owner", code)).toMatch(/^sage-owner-[0-9a-f]{8}$/);
  });
});

describe("sampleFilename", () => {
  it("keeps only a known audio extension from the upload, else follows the MIME type", () => {
    expect(sampleFilename("my voice.WEBM", "audio/webm")).toBe("voice-sample.webm");
    expect(sampleFilename("take2.m4a", "")).toBe("voice-sample.m4a");
    expect(sampleFilename("secret-name.exe", "audio/mp4")).toBe("voice-sample.m4a");
    expect(sampleFilename("", "audio/webm;codecs=opus")).toBe("voice-sample.webm");
    expect(sampleFilename("blob", "")).toBe("voice-sample.webm");
  });
});

describe("addVoice", () => {
  it("clones the sample under a hashed name, stores the voice_id and returns hasVoice", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ voice_id: "v_new", requires_verification: false }));
    const res = await addVoice(upload(webm(), "recording.webm"), env, { code }, undefined, impl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasVoice: true });
    expect(calls).toHaveLength(1);
    expect(isAdd(calls[0]!)).toBe(true);
    expect(new Headers(calls[0]!.init.headers).get("xi-api-key")).toBe(env.ELEVENLABS_API_KEY);

    const sent = calls[0]!.init.body as FormData;
    const name = sent.get("name") as string;
    expect(name).toBe(await voiceName("guest", code));
    expect(name).not.toContain(code);
    expect(name).not.toContain("guest@example.com");
    const file = sent.get("files") as File;
    expect(file.name).toBe("voice-sample.webm");
    expect(file.size).toBe(2048);

    const row = await getCode(env.DB, code);
    expect(row?.voice_id).toBe("v_new");
    expect(row?.voice_created_at).not.toBeNull();
  });

  it("uses the kind of the code in the name", async () => {
    const [gift] = (await createCodes(env.DB, { kind: "gift", count: 1, allowance: 5 })) as [string];
    const { impl, calls } = fakeFetch(() => Response.json({ voice_id: "v_gift" }));
    await addVoice(upload(webm()), env, { code: gift }, undefined, impl);
    expect((calls[0]!.init.body as FormData).get("name")).toBe(await voiceName("gift", gift));
  });

  it("409 voice_exists before reading the upload or calling ElevenLabs", async () => {
    await setVoice(env.DB, code, "v_old", new Date());
    const { impl, calls } = noFetch();
    const res = await addVoice(upload(webm()), env, { code }, undefined, impl);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("voice_exists");
    expect(calls).toHaveLength(0);
    expect((await getCode(env.DB, code))?.voice_id).toBe("v_old");
  });

  it("400 bad_request when the sample is missing, a text field, empty, or not multipart", async () => {
    const { impl, calls } = noFetch();
    const requests = [
      upload(),
      upload("not a file"),
      upload(new Blob([], { type: "audio/webm" })),
      new Request("https://sage.test/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      new Request("https://sage.test/api/voice", { method: "POST" }),
    ];
    for (const r of requests) {
      const res = await addVoice(r, env, { code }, undefined, impl);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe("bad_request");
    }
    expect(calls).toHaveLength(0);
    expect((await getCode(env.DB, code))?.voice_id).toBeNull();
  });

  it("400 bad_request when the sample is larger than 20 MB, and accepts exactly 20 MB", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ voice_id: "v_max" }));
    const tooBig = await addVoice(upload(new Blob([new Uint8Array(MAX_SAMPLE_BYTES + 1)], { type: "audio/webm" })), env, { code }, undefined, impl);
    expect(tooBig.status).toBe(400);
    expect(await errorOf(tooBig)).toBe("bad_request");
    expect(calls).toHaveLength(0);

    const atLimit = await addVoice(upload(new Blob([new Uint8Array(MAX_SAMPLE_BYTES)], { type: "audio/webm" })), env, { code }, undefined, impl);
    expect(atLimit.status).toBe(200);
  });

  it("400 bad_request from Content-Length alone, without reading the body", async () => {
    const { impl, calls } = noFetch();
    const r = new Request("https://sage.test/api/voice", {
      method: "POST",
      headers: { "content-length": String(MAX_SAMPLE_BYTES * 2) },
      body: "x",
    });
    const res = await addVoice(r, env, { code }, undefined, impl);
    expect(res.status).toBe(400);
    expect(r.bodyUsed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("422 voice_verification_required and deletes exactly the clone it just made", async () => {
    const { impl, calls } = fakeFetch((c) =>
      isAdd(c) ? Response.json({ voice_id: "v_verify", requires_verification: true }) : new Response(null, { status: 200 }),
    );
    const res = await addVoice(upload(webm()), env, { code }, undefined, impl);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("voice_verification_required");
    expect(calls).toHaveLength(2);
    expect(isDelete(calls[1]!, "v_verify")).toBe(true);
    expect((await getCode(env.DB, code))?.voice_id).toBeNull();
  });

  it("still answers 422 when deleting the unverified clone fails, and logs its id without the key", async () => {
    const { impl } = fakeFetch((c) =>
      isAdd(c) ? Response.json({ voice_id: "v_verify", requires_verification: true }) : new Response("nope", { status: 500 }),
    );
    const res = await addVoice(upload(webm()), env, { code }, undefined, impl);
    expect(res.status).toBe(422);
    expect(errSpy).toHaveBeenCalledWith("voice discard failed for v_verify", 500);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(env.ELEVENLABS_API_KEY);
  });

  it("502 upstream_error on an ElevenLabs error or a network rejection, storing nothing", async () => {
    for (const impl of [
      fakeFetch(() => new Response("bad", { status: 400 })).impl,
      fakeFetch(() => Response.json({ requires_verification: false })).impl,
      fakeFetch(() => Promise.reject(new TypeError("network down"))).impl,
    ]) {
      const res = await addVoice(upload(webm()), env, { code }, undefined, impl);
      expect(res.status).toBe(502);
      expect(await errorOf(res)).toBe("upstream_error");
    }
    expect((await getCode(env.DB, code))?.voice_id).toBeNull();
    expect(errSpy).toHaveBeenCalledWith("voice add failed", 400);
    expect(errSpy).toHaveBeenCalledWith("voice add failed", "TypeError");
  });

  it("409 voice_exists and frees the new clone when a concurrent upload stored one first", async () => {
    const { impl, calls } = fakeFetch(async (c) => {
      if (isAdd(c)) {
        // The other tab's upload lands while this one is at ElevenLabs.
        await setVoice(env.DB, code, "v_other_tab", new Date());
        return Response.json({ voice_id: "v_late" });
      }
      return new Response(null, { status: 200 });
    });
    const res = await addVoice(upload(webm()), env, { code }, undefined, impl);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("voice_exists");
    expect(isDelete(calls[1]!, "v_late")).toBe(true);
    expect((await getCode(env.DB, code))?.voice_id).toBe("v_other_tab");
  });

  it("401 unauthorized when the signed code no longer exists", async () => {
    const { impl, calls } = noFetch();
    const res = await addVoice(upload(webm()), env, { code: "SAGE-GONE-GONE" }, undefined, impl);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("deleteVoice", () => {
  const del = () => new Request("https://sage.test/api/voice", { method: "DELETE" });

  it("deletes the clone upstream, then clears it", async () => {
    await setVoice(env.DB, code, "v_mine", new Date());
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 200 }));
    const res = await deleteVoice(del(), env, { code }, undefined, impl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasVoice: false });
    expect(calls).toHaveLength(1);
    expect(isDelete(calls[0]!, "v_mine")).toBe(true);
    const row = await getCode(env.DB, code);
    expect(row?.voice_id).toBeNull();
    expect(row?.voice_created_at).toBeNull();
  });

  it("is allowed for an owner code", async () => {
    const [owner] = (await createCodes(env.DB, { kind: "owner", count: 1, allowance: 100 })) as [string];
    await setVoice(env.DB, owner, "v_owner", new Date());
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 200 }));
    const res = await deleteVoice(del(), env, { code: owner }, undefined, impl);
    expect(await res.json()).toEqual({ hasVoice: false });
    expect(isDelete(calls[0]!, "v_owner")).toBe(true);
    expect((await getCode(env.DB, owner))?.voice_id).toBeNull();
  });

  it("clears the clone when ElevenLabs says it is already gone (404)", async () => {
    await setVoice(env.DB, code, "v_gone", new Date());
    const { impl } = fakeFetch(() => new Response("not found", { status: 404 }));
    const res = await deleteVoice(del(), env, { code }, undefined, impl);
    expect(res.status).toBe(200);
    expect((await getCode(env.DB, code))?.voice_id).toBeNull();
  });

  it("returns hasVoice false without an upstream call when the code has no clone", async () => {
    const { impl, calls } = noFetch();
    const res = await deleteVoice(del(), env, { code }, undefined, impl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasVoice: false });
    expect(calls).toHaveLength(0);
  });

  it("502 upstream_error keeps the voice_id so the Guest can retry", async () => {
    await setVoice(env.DB, code, "v_stuck", new Date());
    for (const impl of [
      fakeFetch(() => new Response("oops", { status: 500 })).impl,
      fakeFetch(() => Promise.reject(new TypeError("network down"))).impl,
    ]) {
      const res = await deleteVoice(del(), env, { code }, undefined, impl);
      expect(res.status).toBe(502);
      expect(await errorOf(res)).toBe("upstream_error");
    }
    expect((await getCode(env.DB, code))?.voice_id).toBe("v_stuck");
  });

  it("401 unauthorized when the signed code no longer exists", async () => {
    const { impl } = noFetch();
    const res = await deleteVoice(del(), env, { code: "SAGE-GONE-GONE" }, undefined, impl);
    expect(res.status).toBe(401);
  });
});
