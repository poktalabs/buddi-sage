// Content review for gate 1 to 2: the reviewer persona on Nebius DeepSeek-V4-Pro-0813, one call per
// content file. Direct Chat Completions call because Pi 0.87 hung on this model (see EPIC-LEDGER).
// Reads NEBIUS_API_KEY from code/buddi-sage/.dev.vars and never prints it.
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const devVars = readFileSync(new URL("../../../../.dev.vars", import.meta.url), "utf8");
const key = devVars.match(/^NEBIUS_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("NEBIUS_API_KEY missing in .dev.vars");

const persona = readFileSync(here + "REVIEWER-PERSONA.md", "utf8");
const files = process.argv.slice(2);

await Promise.all(files.map(async (f) => {
  const t0 = Date.now();
  const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(600000),
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-ai/DeepSeek-V4-Pro-0813",
      reasoning_effort: "low",
      max_tokens: 16000,
      messages: [
        { role: "system", content: persona },
        { role: "user", content: readFileSync(`${here}prompts/${f}.md`, "utf8") },
      ],
    }),
  });
  const j = await res.json();
  const c = j.choices?.[0];
  writeFileSync(`${here}out/${f}.md`, c?.message?.content ?? "");
  console.log(f, res.status, `${((Date.now() - t0) / 1000).toFixed(1)}s`, c?.finish_reason, JSON.stringify({ out: j.usage?.completion_tokens, reasoning: j.usage?.completion_tokens_details?.reasoning_tokens }));
}));
