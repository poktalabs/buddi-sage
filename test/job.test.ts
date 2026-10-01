import { beforeEach, describe, expect, it } from "vitest";
import type { ApiError, Me, StartRoundResponse } from "../src/shared/api";
import type { Env } from "../src/worker/env";
import { createCodes, getCode, insertCodeRequest, setVoice } from "../src/worker/db";
import {
  asJobUrl,
  buildBrief,
  fetchJobPage,
  hostAllowed,
  htmlToText,
  jobVariables,
  MAX_JOB_SETS,
  pageToJobText,
  parseBrief,
} from "../src/worker/job";
import type { ChatTextArgs } from "../src/worker/nebius";
import { setJob } from "../src/worker/routes/job";
import { startRound } from "../src/worker/routes/rounds";
import { telegramWebhook } from "../src/worker/routes/telegram";
import { testEnv } from "./support/fakeD1";

// Synthetic job posts written for these tests.
const BRIEF_JSON = JSON.stringify({
  role: "Senior AI Engineer",
  company: "Acme",
  needs: ["Ship LLM features to production", "Evaluate model quality", "Own on-call for AI services"],
  questions: [
    "Walk me through an LLM feature you took to production. What was your part?",
    "Tell me about a time you caught a drop in model quality. What did you do?",
    "Tell me about an incident you handled on call. What changed after?",
  ],
});
const POST_TEXT = "Senior AI Engineer at Acme. You will ship LLM features, evaluate quality and join the on-call rotation.";
const LONG_BODY = "You will ship LLM features to production and evaluate model quality every week. ".repeat(5);
const LD_PAGE = `<html><head><title>Careers</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"x"},{"@type":["JobPosting"],"title":"Senior AI Engineer","hiringOrganization":{"@type":"Organization","name":"Acme &amp; Co"},"description":"&lt;p&gt;${LONG_BODY}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;"}]}</script>
</head><body><nav>Menu</nav><p>Unrelated page text</p></body></html>`;

describe("job links", () => {
  it("treats only a single http(s) link as a URL", () => {
    expect(asJobUrl("https://jobs.example.com/1")?.hostname).toBe("jobs.example.com");
    expect(asJobUrl("  http://jobs.example.com/1  ")).not.toBeNull();
    expect(asJobUrl("Senior AI Engineer at Acme")).toBeNull();
    expect(asJobUrl("see https://jobs.example.com/1 please")).toBeNull();
    expect(asJobUrl("ftp://jobs.example.com/1")).toBeNull();
  });

  it("refuses private, local and literal-IPv6 hosts", () => {
    const ok = (u: string) => hostAllowed(new URL(u));
    expect(ok("https://boards.greenhouse.io/acme/jobs/1")).toBe(true);
    expect(ok("https://8.8.8.8/x")).toBe(true);
    for (const bad of [
      "http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://169.254.169.254/latest", "http://192.168.1.1/",
      "http://172.20.0.1/", "http://[::1]/", "http://intranet/", "http://printer.local/", "https://user:pw@jobs.example.com/",
    ]) expect(ok(bad), bad).toBe(false);
  });

  it("follows a public redirect, but never one to a private host", async () => {
    const seen: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url === "https://a.example.com/job") return new Response(null, { status: 302, headers: { location: "https://b.example.com/job" } });
      if (url === "https://b.example.com/job") return new Response("<p>hi</p>", { headers: { "content-type": "text/html" } });
      if (url === "https://c.example.com/job") return new Response(null, { status: 301, headers: { location: "http://169.254.169.254/" } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    expect(await fetchJobPage(new URL("https://a.example.com/job"), impl)).toBe("<p>hi</p>");
    expect(await fetchJobPage(new URL("https://c.example.com/job"), impl)).toBeNull();
    expect(seen).not.toContain("http://169.254.169.254/");
  });

  it("answers null for an error status or a non-HTML body", async () => {
    const impl = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/404") ? new Response("no", { status: 404 }) : new Response("%PDF", { headers: { "content-type": "application/pdf" } })) as typeof fetch;
    expect(await fetchJobPage(new URL("https://x.example.com/404"), impl)).toBeNull();
    expect(await fetchJobPage(new URL("https://x.example.com/file"), impl)).toBeNull();
  });
});

describe("page text", () => {
  it("prefers the JSON-LD JobPosting, decoded and with its bullets", () => {
    const text = pageToJobText(LD_PAGE);
    expect(text.startsWith("Senior AI Engineer\nCompany: Acme & Co\n")).toBe(true);
    expect(text).toContain("- Python");
    expect(text).not.toContain("Unrelated page text");
  });

  it("falls back to the title and body text, without scripts, styles or navigation", () => {
    const html = `<html><head><title>AI Engineer | Acme</title><style>p{}</style></head><body><nav>Home Jobs</nav><script>var x=1</script><h1>AI Engineer</h1><ul><li>Ship &amp; measure</li></ul></body></html>`;
    const text = pageToJobText(html);
    expect(text).toContain("AI Engineer | Acme");
    expect(text).toContain("- Ship & measure");
    expect(text).not.toMatch(/var x|p\{\}|Home Jobs/);
  });

  it("passes plain text through with its lines", () => {
    expect(htmlToText("Role: AI Engineer\n\n  Needs:  Python  ")).toBe("Role: AI Engineer\nNeeds: Python");
  });
});

describe("parseBrief", () => {
  it("reads a fenced reply into a brief with job Question ids", () => {
    const brief = parseBrief("```json\n" + BRIEF_JSON + "\n```");
    expect(brief).toMatchObject({ role: "Senior AI Engineer", company: "Acme" });
    expect(brief !== "not_a_job" && brief?.questions.map((q) => q.id)).toEqual(["job-1", "job-2", "job-3"]);
  });

  it("strips prompt braces and em-dashes, and keeps a null company", () => {
    const raw = JSON.stringify({
      role: "AI {{Engineer}}",
      company: null,
      needs: ["Python \u2014 daily", "Evals"],
      questions: ["Tell me about a launch \u2014 what was yours?", "Walk me through an eval you built?", "Tell me about a hard bug you fixed?"],
    });
    const brief = parseBrief(raw);
    if (!brief || brief === "not_a_job") throw new Error("expected a brief");
    expect(brief.role).toBe("AI Engineer");
    expect(brief.company).toBeNull();
    expect(brief.needs[0]).toBe("Python, daily");
    expect(brief.questions[0]!.text).toBe("Tell me about a launch, what was yours?");
  });

  it("rejects a reply that breaks the shape, and reports not_a_job", () => {
    expect(parseBrief("not json")).toBeNull();
    expect(parseBrief(JSON.stringify({ role: "x", needs: ["a", "b"], questions: ["Too short?", "Tell me about a time you led?"] }))).toBeNull();
    const noMarks = JSON.parse(BRIEF_JSON) as { questions: string[] };
    noMarks.questions = noMarks.questions.map((q) => q.replace(/\?$/, "."));
    expect(parseBrief(JSON.stringify(noMarks))).toBeNull();
    expect(parseBrief('{"not_a_job": true}')).toBe("not_a_job");
  });
});

function fakeChat(...replies: (string | Error)[]) {
  const calls: ChatTextArgs[] = [];
  let i = 0;
  const chatText = async (args: ChatTextArgs) => {
    calls.push(args);
    const r = replies[i++] ?? new Error("no more replies");
    if (r instanceof Error) throw r;
    return r;
  };
  return { chatText, calls };
}

describe("buildBrief", () => {
  it("sends pasted text as quoted data with thinking off", async () => {
    const chat = fakeChat(BRIEF_JSON);
    const res = await buildBrief(POST_TEXT, { chatText: chat.chatText, model: "job-model" });
    expect(res.ok).toBe(true);
    expect(chat.calls[0]).toMatchObject({ model: "job-model", reasoning_effort: "none" });
    expect(chat.calls[0]!.messages[0]!.content).toContain(`JOB POST START\n${POST_TEXT}\nJOB POST END`);
  });

  it("retries once after a bad reply, then gives up as unreadable", async () => {
    expect((await buildBrief(POST_TEXT, { chatText: fakeChat("nope", BRIEF_JSON).chatText, model: "m" })).ok).toBe(true);
    expect(await buildBrief(POST_TEXT, { chatText: fakeChat("nope", "still no").chatText, model: "m" })).toEqual({ ok: false, code: "job_unreadable" });
    expect(await buildBrief("hello", { chatText: fakeChat('{"not_a_job": true}').chatText, model: "m" })).toEqual({ ok: false, code: "job_unreadable" });
  });

  it("is an upstream error when the model fails both times", async () => {
    const chat = fakeChat(new Error("500"), new Error("500"));
    expect(await buildBrief(POST_TEXT, { chatText: chat.chatText, model: "m" })).toEqual({ ok: false, code: "upstream_error" });
  });

  it("reads a link's page, and fails fast on a page with too little text", async () => {
    const pages: Record<string, string> = { "https://jobs.example.com/ld": LD_PAGE, "https://jobs.example.com/wall": "<html><body>Sign in</body></html>" };
    const impl = (async (input: RequestInfo | URL) => new Response(pages[String(input)] ?? "", { headers: { "content-type": "text/html" } })) as typeof fetch;
    const chat = fakeChat(BRIEF_JSON);
    expect((await buildBrief("https://jobs.example.com/ld", { chatText: chat.chatText, model: "m", fetchImpl: impl })).ok).toBe(true);
    expect(chat.calls[0]!.messages[0]!.content).toContain("Company: Acme & Co");
    const none = fakeChat();
    expect(await buildBrief("https://jobs.example.com/wall", { chatText: none.chatText, model: "m", fetchImpl: impl })).toEqual({ ok: false, code: "job_fetch_failed" });
    expect(await buildBrief("http://127.0.0.1/job", { chatText: none.chatText, model: "m", fetchImpl: impl })).toEqual({ ok: false, code: "job_fetch_failed" });
    expect(none.calls).toHaveLength(0);
  });
});

describe("jobVariables", () => {
  it("gives Sage an opening line and the role's needs, or a no-job default", () => {
    const brief = parseBrief(BRIEF_JSON);
    if (!brief || brief === "not_a_job") throw new Error("expected a brief");
    expect(jobVariables(brief)).toEqual({
      job_intro: "Today we're practicing for the Senior AI Engineer at Acme role. ",
      job_context: "Role: Senior AI Engineer at Acme. What this role needs most: Ship LLM features to production; Evaluate model quality; Own on-call for AI services.",
    });
    expect(jobVariables(null).job_intro).toBe("");
  });
});

// ---------- routes ----------

let env: Env;
let code: string;
beforeEach(async () => {
  env = testEnv();
  [code] = (await createCodes(env.DB, { kind: "guest", count: 1, allowance: 3 })) as [string];
  await setVoice(env.DB, code, "voice-test", new Date());
});

const nebiusFetch = (...contents: string[]) => {
  let i = 0;
  return (async (input: RequestInfo | URL) => {
    if (String(input) === "https://nebius.test/v1/chat/completions") return Response.json({ choices: [{ message: { content: contents[i++] ?? "" } }] });
    if (String(input).startsWith("https://eleven.test/")) return Response.json({ token: "conv-token-test" });
    throw new Error(`unexpected ${String(input)}`);
  }) as typeof fetch;
};

const post = (path: string, body: unknown) =>
  new Request(`https://sage.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/job", () => {
  it("stores the brief and answers Me with the job", async () => {
    const res = await setJob(post("/api/job", { source: POST_TEXT }), env, { code }, undefined, nebiusFetch(BRIEF_JSON));
    expect(res.status).toBe(200);
    const me = (await res.json()) as Me;
    expect(me.job?.role).toBe("Senior AI Engineer");
    expect(me.jobSource).toBe(POST_TEXT);
    expect((await getCode(env.DB, code))!.job_sets).toBe(1);
  });

  it("400 on an empty source, 422 on an unreadable one, and stores nothing", async () => {
    expect((await setJob(post("/api/job", { source: " " }), env, { code })).status).toBe(400);
    const res = await setJob(post("/api/job", { source: "hello" }), env, { code }, undefined, nebiusFetch('{"not_a_job": true}'));
    expect(res.status).toBe(422);
    expect(((await res.json()) as ApiError).error).toBe("job_unreadable");
    expect((await getCode(env.DB, code))!.job_brief).toBeNull();
  });

  it("caps how many briefs a code can build", async () => {
    for (let i = 0; i < MAX_JOB_SETS; i++) {
      expect((await setJob(post("/api/job", { source: POST_TEXT }), env, { code }, undefined, nebiusFetch(BRIEF_JSON))).status).toBe(200);
    }
    const res = await setJob(post("/api/job", { source: POST_TEXT }), env, { code }, undefined, nebiusFetch(BRIEF_JSON));
    expect(res.status).toBe(429);
    expect(((await res.json()) as ApiError).error).toBe("job_limit");
  });
});

describe("job Rounds", () => {
  it("rejects a job Question without a job, then starts one with the job variables once set", async () => {
    const before = await startRound(post("/api/rounds", { question_id: "job-1" }), env, { code }, undefined, nebiusFetch());
    expect(before.status).toBe(400);

    await setJob(post("/api/job", { source: POST_TEXT }), env, { code }, undefined, nebiusFetch(BRIEF_JSON));
    const res = await startRound(post("/api/rounds", { question_id: "job-2" }), env, { code }, undefined, nebiusFetch());
    expect(res.status).toBe(200);
    const body = (await res.json()) as StartRoundResponse;
    expect(body.question.text).toMatch(/drop in model quality/);
    expect(body.dynamic_variables.job_intro).toContain("Senior AI Engineer at Acme");
    const row = await env.DB.prepare("SELECT question_text FROM rounds WHERE id = ?").bind(body.round_id).first<{ question_text: string }>();
    expect(row?.question_text).toBe(body.question.text);
  });

  it("keeps the fixed Questions available alongside a job", async () => {
    await setJob(post("/api/job", { source: POST_TEXT }), env, { code }, undefined, nebiusFetch(BRIEF_JSON));
    expect((await startRound(post("/api/rounds", { question_id: "why-this-role" }), env, { code }, undefined, nebiusFetch())).status).toBe(200);
  });
});

describe("approving a request carries its job", () => {
  it("puts the request's job on the new code as its job source", async () => {
    const tg = testEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_OWNER_ID: "42" });
    const id = await insertCodeRequest(tg.DB, { handle: "jane", job: "https://jobs.example.com/ai", lang: "en", ip_hash: null, now: new Date() });
    const res = await telegramWebhook(
      new Request("https://sage.test/telegram/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "s" },
        body: JSON.stringify({ message: { text: `/approve_${id}`, from: { id: 42 }, chat: { id: 42, type: "private" } } }),
      }),
      tg,
    );
    const text = ((await res.json()) as { text: string }).text;
    const issued = text.match(/SAGE-[A-Z0-9]{4}-[A-Z0-9]{4}/)![0];
    expect((await getCode(tg.DB, issued))!.job_source).toBe("https://jobs.example.com/ai");
  });
});
