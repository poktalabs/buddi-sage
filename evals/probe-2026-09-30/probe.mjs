// Gate 1 to 2 probe, run once by the orchestrator with Mel's OK. It answers the two
// assumptions the plan could not settle from the docs: which TTS model the Replay can use
// (TTS_MODEL) and whether /v1/voices/add accepts the browser's WebM/Opus (UPLOAD_FORMAT).
// Keys come from .dev.vars, parsed here and never printed. The upload check creates exactly
// one voice and deletes only that voice_id: it never lists or deletes any other voice, because
// Mel's workspace holds voices an agent must never touch.
//
//   node evals/probe-2026-09-30/probe.mjs models
//   node evals/probe-2026-09-30/probe.mjs upload <file>
//
// DEV_VARS=<path> overrides the .dev.vars location (default: the repo root above this file).
// ELEVEN_API_BASE overrides the API base (default https://api.elevenlabs.io).
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const DEV_VARS = process.env.DEV_VARS ?? fileURLToPath(new URL("../../.dev.vars", import.meta.url));
const BASE = (process.env.ELEVEN_API_BASE ?? "https://api.elevenlabs.io").replace(/\/+$/, "");

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
  console.error(`probe: ${message}`);
  process.exit(1);
}

const key = readDevVars(DEV_VARS).ELEVENLABS_API_KEY;
if (!key) fail(`ELEVENLABS_API_KEY is missing or empty in ${DEV_VARS}`);

/** Short error excerpt with the key scrubbed, in case an error body ever echoes it. */
async function excerpt(res) {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return text.split(key).join("[redacted]");
}

async function models() {
  const res = await fetch(`${BASE}/v1/models`, { headers: { "xi-api-key": key } });
  console.log(`GET /v1/models -> ${res.status}`);
  if (!res.ok) fail(await excerpt(res));
  const list = await res.json();
  if (!Array.isArray(list)) fail("expected a top-level array");
  for (const m of list) console.log(`  ${m.model_id}  can_do_text_to_speech=${m.can_do_text_to_speech}`);
  const v4 = list.find((m) => m.model_id === "eleven_v4");
  if (!v4) console.log("eleven_v4: NOT listed -> TTS_MODEL=eleven_multilingual_v2");
  else if (v4.can_do_text_to_speech === true) console.log("eleven_v4: listed with can_do_text_to_speech=true -> TTS_MODEL=eleven_v4");
  else console.log(`eleven_v4: listed but can_do_text_to_speech=${v4.can_do_text_to_speech} -> TTS_MODEL=eleven_multilingual_v2`);
}

const MIME = { ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".wav": "audio/wav" };

async function upload(file) {
  if (!file) fail("usage: probe.mjs upload <file>");
  const bytes = readFileSync(file);
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const name = `sage-probe-${Date.now()}`;
  const form = new FormData();
  form.append("name", name);
  form.append("files", new Blob([bytes], { type }), basename(file));
  console.log(`uploading ${basename(file)} (${type}, ${bytes.length} bytes) as ${name}`);

  const res = await fetch(`${BASE}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": key }, body: form });
  console.log(`POST /v1/voices/add -> ${res.status}`);
  if (!res.ok) {
    console.log(await excerpt(res));
    console.log(`UPLOAD_FORMAT: ${extname(file).slice(1)} rejected (no voice was created, nothing to delete)`);
    return;
  }
  const body = await res.json();
  const voiceId = typeof body.voice_id === "string" ? body.voice_id : "";
  console.log(`voice_id=${voiceId || "(missing)"} requires_verification=${body.requires_verification}`);
  if (!voiceId) return;

  // Delete exactly the voice this run created, and nothing else.
  try {
    const del = await fetch(`${BASE}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: { "xi-api-key": key } });
    console.log(`DELETE /v1/voices/${voiceId} -> ${del.status}`);
    if (!del.ok) console.log(`delete failed: ${await excerpt(del)}. Delete voice ${voiceId} (${name}) by hand.`);
  } catch (e) {
    console.log(`delete threw (${e?.name}). Delete voice ${voiceId} (${name}) by hand.`);
  }
  console.log(`UPLOAD_FORMAT: ${extname(file).slice(1)} accepted`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "models") await models();
else if (cmd === "upload") await upload(arg);
else fail("usage: probe.mjs models | upload <file>");
