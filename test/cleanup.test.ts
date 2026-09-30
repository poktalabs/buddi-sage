import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeKind } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { cleanupVoices } from "../src/worker/cleanup";
import { createCodes, getCode, setVoice, spendRound } from "../src/worker/db";
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

const ok = () => fakeFetch(() => new Response(null, { status: 200 }));
const deletedIds = (calls: Call[]) =>
  calls.filter((c) => c.init.method === "DELETE").map((c) => decodeURIComponent(c.url.split("/v1/voices/")[1]!));

const NOW = new Date("2026-10-10T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (d: number) => minutesAgo(d * 24 * 60);

let env: Env;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  env = testEnv();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

/** A code with a Voice clone made `cloneAt`, having spent `rounds` Rounds, the last at `lastRoundAt`. */
async function codeWithVoice(args: {
  kind?: CodeKind;
  allowance?: number;
  rounds?: number;
  lastRoundAt?: Date;
  cloneAt: Date;
  voiceId: string;
}): Promise<string> {
  const [code] = (await createCodes(env.DB, { kind: args.kind ?? "guest", count: 1, allowance: args.allowance ?? 1 })) as [string];
  await setVoice(env.DB, code, args.voiceId, args.cloneAt);
  for (let i = 0; i < (args.rounds ?? 0); i++) await spendRound(env.DB, code, args.lastRoundAt ?? NOW);
  return code;
}

describe("cleanupVoices", () => {
  it("keeps a used-up clone for the one-hour grace, then deletes it", async () => {
    const recent = await codeWithVoice({ rounds: 1, lastRoundAt: minutesAgo(30), cloneAt: minutesAgo(40), voiceId: "v_recent" });
    const stale = await codeWithVoice({ rounds: 1, lastRoundAt: minutesAgo(61), cloneAt: minutesAgo(70), voiceId: "v_stale" });
    const { impl, calls } = ok();

    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 1, failed: 0 });
    expect(deletedIds(calls)).toEqual(["v_stale"]);
    expect((await getCode(env.DB, recent))?.voice_id).toBe("v_recent");
    const cleaned = await getCode(env.DB, stale);
    expect(cleaned?.voice_id).toBeNull();
    expect(cleaned?.voice_created_at).toBeNull();
  });

  it("keeps a clone with Rounds left until it is 7 days old", async () => {
    const young = await codeWithVoice({ allowance: 3, rounds: 1, lastRoundAt: daysAgo(6), cloneAt: daysAgo(6.9), voiceId: "v_young" });
    const old = await codeWithVoice({ allowance: 3, cloneAt: daysAgo(7), voiceId: "v_old" });
    const { impl, calls } = ok();

    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 1, failed: 0 });
    expect(deletedIds(calls)).toEqual(["v_old"]);
    expect((await getCode(env.DB, young))?.voice_id).toBe("v_young");
    expect((await getCode(env.DB, old))?.voice_id).toBeNull();
  });

  it("never touches an owner code, even with the Allowance used up and a 30-day-old clone", async () => {
    const owner = await codeWithVoice({ kind: "owner", allowance: 1, rounds: 1, lastRoundAt: daysAgo(10), cloneAt: daysAgo(30), voiceId: "v_owner" });
    const guest = await codeWithVoice({ kind: "guest", allowance: 1, rounds: 1, lastRoundAt: daysAgo(10), cloneAt: daysAgo(30), voiceId: "v_guest" });
    const gift = await codeWithVoice({ kind: "gift", allowance: 5, cloneAt: daysAgo(8), voiceId: "v_gift" });
    const { impl, calls } = ok();

    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 2, failed: 0 });
    expect(deletedIds(calls).sort()).toEqual(["v_gift", "v_guest"]);
    expect(calls.some((c) => c.url.includes("v_owner"))).toBe(false);
    expect((await getCode(env.DB, owner))?.voice_id).toBe("v_owner");
    expect((await getCode(env.DB, guest))?.voice_id).toBeNull();
    expect((await getCode(env.DB, gift))?.voice_id).toBeNull();
  });

  it("clears a clone ElevenLabs already deleted (404)", async () => {
    const code = await codeWithVoice({ cloneAt: daysAgo(8), voiceId: "v_gone" });
    const { impl } = fakeFetch(() => new Response("not found", { status: 404 }));
    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 1, failed: 0 });
    expect((await getCode(env.DB, code))?.voice_id).toBeNull();
  });

  it("counts a failing delete, keeps its voice_id for the next run, and carries on with the rest", async () => {
    const a = await codeWithVoice({ cloneAt: daysAgo(8), voiceId: "v_a" });
    const b = await codeWithVoice({ cloneAt: daysAgo(8), voiceId: "v_b" });
    const c = await codeWithVoice({ cloneAt: daysAgo(8), voiceId: "v_c" });
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/v_a")) return new Response("boom", { status: 500 });
      if (call.url.endsWith("/v_b")) return Promise.reject(new TypeError("network down"));
      return new Response(null, { status: 200 });
    });

    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 1, failed: 2 });
    expect(deletedIds(calls).sort()).toEqual(["v_a", "v_b", "v_c"]);
    expect((await getCode(env.DB, a))?.voice_id).toBe("v_a");
    expect((await getCode(env.DB, b))?.voice_id).toBe("v_b");
    expect((await getCode(env.DB, c))?.voice_id).toBeNull();
    expect(errSpy).toHaveBeenCalledWith("voice cleanup delete failed", 500);
    expect(errSpy).toHaveBeenCalledWith("voice cleanup delete failed", "TypeError");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(env.ELEVENLABS_API_KEY);
  });

  it("does not clear a new clone the Guest uploaded while the old one was being deleted", async () => {
    const code = await codeWithVoice({ cloneAt: daysAgo(8), voiceId: "v_old" });
    const { impl } = fakeFetch(async () => {
      await setVoice(env.DB, code, "v_new", NOW);
      return new Response(null, { status: 200 });
    });
    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 1, failed: 0 });
    expect((await getCode(env.DB, code))?.voice_id).toBe("v_new");
  });

  it("makes no upstream call when nothing is due", async () => {
    await codeWithVoice({ allowance: 3, cloneAt: minutesAgo(5), voiceId: "v_fresh" });
    const { impl, calls } = ok();
    expect(await cleanupVoices(env, NOW, impl)).toEqual({ deleted: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });
});
