// The target job: what makes a Round about the Guest's real opening instead of a generic
// Question (BUDDi's "all coaching is job-grounded"). A Guest gives a link or pastes the post;
// buildBrief turns it into a JobBrief (role, company, needs, three Questions) with one model
// call. Decisions encoded here:
// - The link is untrusted and fetched by the Worker, so only public http(s) hosts are allowed
//   and every redirect hop is re-checked (ported from BUDDi's ssrf.ts; Workers have no DNS
//   lookup, so literal private IPs and local names are refused instead).
// - A page is read up to MAX_PAGE_BYTES and parsed with plain string passes, which keeps the
//   CPU cost small. JSON-LD JobPosting (most ATS pages) wins over the page text.
// - The post goes to the model as quoted data, and what comes back is validated field by field:
//   lengths, a question mark on every Question, no braces (they are prompt placeholders) and
//   no em-dashes. Anything else is a failed attempt; two failures and the Guest is asked to
//   paste the post instead. The brief never reaches Sage unvalidated.
import promptFile from "../../content/job-brief-prompt.md?raw";
import type { JobBrief, SageDynamicVariables } from "../shared/api";
import type { FetchImpl } from "./eleven";
import type { ChatTextArgs } from "./nebius";
import { fill } from "./rewrite";

export const MAX_SOURCE_CHARS = 20_000;
export const MAX_JOB_TEXT_CHARS = 12_000;
export const MAX_PAGE_BYTES = 600_000;
export const MIN_PAGE_TEXT_CHARS = 200;
export const MAX_JOB_SETS = 5;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
const USER_AGENT = "BUDDi-Sage/1.0 (interview practice; +https://sage.agentcamp.xyz)";

export type JobFailure = "job_fetch_failed" | "job_unreadable" | "upstream_error";
export type BriefResult = { ok: true; brief: JobBrief } | { ok: false; code: JobFailure };

export type JobDeps = {
  chatText: (args: ChatTextArgs) => Promise<string>;
  model: string;
  fetchImpl?: FetchImpl;
  prompt?: string;
};

// ---------- links ----------

/** The source as a URL when it is a single http(s) link, else null (it is pasted text). */
export function asJobUrl(source: string): URL | null {
  const s = source.trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function ipv4IsPublic(host: string): boolean {
  const p = host.split(".").map(Number);
  const [a, b] = p as [number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0)) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/** Only public http(s) hosts: no IP literals in private ranges, no IPv6 literals, no local names. */
export function hostAllowed(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return ipv4IsPublic(host);
  if (!host.includes(".")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return out + decoder.decode();
}

/** The page's HTML, or null when it cannot be fetched. Redirects are followed by hand and re-checked. */
export async function fetchJobPage(url: URL, fetchImpl: FetchImpl = fetch): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!hostAllowed(current)) return null;
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location) {
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|text\/plain/i.test(type)) return null;
    return readCapped(res, MAX_PAGE_BYTES);
  }
  return null;
}

// ---------- page text ----------

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', bull: "-", middot: "-",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      if (code === 0xa0) return " ";
      if (code === 0x2013 || code === 0x2014) return "-";
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

const BLOCK = /<\/?(?:p|div|section|article|header|footer|main|aside|ul|ol|dl|dt|dd|table|tr|blockquote|pre|h[1-6])\b[^>]*>/gi;

/** HTML to line-structured text: list items become "- " lines, blocks get their own line. */
export function htmlToText(html: string): string {
  if (!/<[a-z!/][^>]*>/i.test(html)) return tidyLines(decodeEntities(html));
  const text = html
    .replace(/\s+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head|iframe|nav|footer)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, " ");
  return tidyLines(decodeEntities(text));
}

function tidyLines(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((l) => l && l !== "-")
    .join("\n");
}

type LdJob = { title: string; company: string | null; description: string };

function findJobPosting(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return obj;
  return findJobPosting(obj["@graph"]);
}

/** The page's JSON-LD JobPosting (what most hiring sites embed for search engines), if any. */
export function jsonLdJob(html: string): LdJob | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const job = findJobPosting(data);
    if (!job) continue;
    const org = job.hiringOrganization as { name?: unknown } | string | undefined;
    const company = typeof org === "string" ? org : typeof org?.name === "string" ? org.name : null;
    return {
      title: typeof job.title === "string" ? decodeEntities(job.title) : "",
      company: company ? decodeEntities(company) : null,
      description: typeof job.description === "string" ? htmlToText(decodeEntities(job.description)) : "",
    };
  }
  return null;
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]!.trim()) : null;
}

/** The job text a page yields: JSON-LD JobPosting first, else its title plus body text. */
export function pageToJobText(html: string): string {
  const ld = jsonLdJob(html);
  if (ld && ld.description.length >= MIN_PAGE_TEXT_CHARS) {
    return [ld.title, ld.company ? `Company: ${ld.company}` : "", "", ld.description].filter((l, i) => l || i === 2).join("\n").slice(0, MAX_JOB_TEXT_CHARS);
  }
  const title = meta(html, "og:title") ?? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
  const site = meta(html, "og:site_name");
  const body = htmlToText(html);
  return [title, site ? `Company: ${site}` : "", "", body].join("\n").trim().slice(0, MAX_JOB_TEXT_CHARS);
}

// ---------- the brief ----------

/** One line, no prompt braces, no em-dashes, single spaces. */
function clean(s: string): string {
  return s
    .replace(/[{}]/g, "")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The model's reply as a JobBrief, "not_a_job", or null when it breaks the shape. */
export function parseBrief(raw: string): JobBrief | "not_a_job" | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (data.not_a_job === true) return "not_a_job";

  const role = typeof data.role === "string" ? clean(data.role) : "";
  if (!role || role.length > 100) return null;
  const company = typeof data.company === "string" && clean(data.company) ? clean(data.company) : null;
  if (company && company.length > 80) return null;

  const needs = (Array.isArray(data.needs) ? data.needs : [])
    .filter((n): n is string => typeof n === "string")
    .map(clean)
    .filter((n) => n.length > 0 && n.length <= 120)
    .slice(0, 4);
  if (needs.length < 2) return null;

  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .filter((q): q is string => typeof q === "string")
    .map(clean)
    .filter((q) => q.length >= 15 && q.length <= 280 && q.endsWith("?"))
    .slice(0, 3);
  if (questions.length < 3) return null;

  return { role, company, needs, questions: questions.map((text, i) => ({ id: `job-${i + 1}`, text })) };
}

/** Reads the job from a link or pasted text and asks the job model for its brief (two attempts). */
export async function buildBrief(source: string, deps: JobDeps): Promise<BriefResult> {
  const url = asJobUrl(source);
  let text: string;
  if (url) {
    if (!hostAllowed(url)) return { ok: false, code: "job_fetch_failed" };
    const html = await fetchJobPage(url, deps.fetchImpl ?? fetch);
    if (html === null) return { ok: false, code: "job_fetch_failed" };
    text = pageToJobText(html);
    // Too little text: a login wall or a page built in the browser.
    if (text.length < MIN_PAGE_TEXT_CHARS) return { ok: false, code: "job_fetch_failed" };
  } else {
    text = htmlToText(source).slice(0, MAX_JOB_TEXT_CHARS);
    if (!text) return { ok: false, code: "job_unreadable" };
  }

  const system = fill(deps.prompt ?? promptFile, { job: text });
  let modelFailed = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply: string;
    try {
      reply = await deps.chatText({
        model: deps.model,
        temperature: 0.3,
        max_tokens: 1500,
        reasoning_effort: "none",
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Write the brief now." },
        ],
      });
    } catch (err) {
      console.error("job brief attempt failed", attempt, err instanceof Error ? err.name : typeof err);
      modelFailed = true;
      continue;
    }
    modelFailed = false;
    const brief = parseBrief(reply);
    if (brief === "not_a_job") return { ok: false, code: "job_unreadable" };
    if (brief) return { ok: true, brief };
  }
  return { ok: false, code: modelFailed ? "upstream_error" : "job_unreadable" };
}

// ---------- what Sage hears ----------

const NO_JOB_CONTEXT = "No specific job. Ground the Pushback only in what the Guest said.";

export function jobTitle(brief: JobBrief): string {
  return brief.company ? `${brief.role} at ${brief.company}` : brief.role;
}

/** The job variables for Sage: the opening line and the background for the Pushback. */
export function jobVariables(brief: JobBrief | null): Pick<SageDynamicVariables, "job_intro" | "job_context"> {
  if (!brief) return { job_intro: "", job_context: NO_JOB_CONTEXT };
  return {
    job_intro: `Today we're practicing for the ${jobTitle(brief)} role. `,
    job_context: `Role: ${jobTitle(brief)}. What this role needs most: ${brief.needs.join("; ")}.`,
  };
}

/** The stored brief, or null when absent or unreadable. */
export function readBrief(json: string | null): JobBrief | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as JobBrief;
  } catch {
    return null;
  }
}
