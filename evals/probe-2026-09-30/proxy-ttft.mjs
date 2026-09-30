// Time to first spoken token through the Custom LLM pass-through (spec task 4). Sage's first
// word waits on the coach model's first content token, and the proxy exists to keep that fast
// (reasoning off), so this measures exactly that: POST a short fixed prompt to
// <base>/chat/completions with the LLM_PROXY_SECRET bearer, and time from request start to the
// first SSE chunk whose delta carries non-empty `content` (reasoning chunks do not count).
// 5 runs, sequential, each capped at 30 s; prints each run and the median. The bearer comes
// from .dev.vars, parsed here and never printed.
//
//   node evals/probe-2026-09-30/proxy-ttft.mjs [base-url]
//
// base-url defaults to http://localhost:5173/llm/v1 (local `pnpm dev`); pass the deployed
// https://<worker>.workers.dev/llm/v1 for the Wave 3 re-run. DEV_VARS=<path> overrides the
// .dev.vars location (default: the repo root above this file).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_VARS = process.env.DEV_VARS ?? fileURLToPath(new URL("../../.dev.vars", import.meta.url));
const BASE = (process.argv[2] ?? "http://localhost:5173/llm/v1").replace(/\/+$/, "");
const RUNS = 5;
const TIMEOUT_MS = 30_000;
const PROMPT = [
  { role: "system", content: "You are an interview coach. Answer in one short sentence." },
  { role: "user", content: "Give me one tip for answering a behavioural interview question." },
];

function readDevVars(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read ${path}`);
  }
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[name] = value;
  }
  return vars;
}

function fail(message) {
  console.error(`proxy-ttft: ${message}`);
  process.exit(1);
}

const secret = readDevVars(DEV_VARS).LLM_PROXY_SECRET;
if (!secret) fail(`LLM_PROXY_SECRET is missing or empty in ${DEV_VARS}`);

/** Short error excerpt with the secret scrubbed, in case an error body ever echoes it. */
async function excerpt(res) {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return text.split(secret).join("[redacted]");
}

/** True when an SSE `data:` line is a chunk with non-empty delta content. */
function hasContent(line) {
  if (!line.startsWith("data:")) return false;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return false;
  try {
    const content = JSON.parse(data).choices?.[0]?.delta?.content;
    return typeof content === "string" && content.length > 0;
  } catch {
    return false;
  }
}

async function once() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: PROMPT, stream: true, max_tokens: 60 }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await excerpt(res)}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended without a content token");
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (hasContent(line)) {
          const ms = performance.now() - start;
          await reader.cancel().catch(() => {});
          return ms;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

console.log(`proxy-ttft: ${RUNS} runs against ${BASE}/chat/completions`);
const times = [];
for (let i = 1; i <= RUNS; i++) {
  try {
    const ms = await once();
    times.push(ms);
    console.log(`run ${i}: ${Math.round(ms)} ms`);
  } catch (err) {
    console.log(`run ${i}: failed (${err instanceof Error ? err.message : String(err)})`);
  }
}
if (times.length === 0) fail("no successful run");
const sorted = [...times].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
console.log(`median: ${Math.round(median)} ms (${times.length}/${RUNS} runs succeeded)`);
