// Tier A guardrails on the Best-self answer: two deterministic rules that catch the
// rewrite model's known drift (see docs/NEBIUS-MODEL-CHOICE.md). The full eval suite and
// judge-based guardrail come after the ACR-019 design review.

export type GuardFailure =
  | { rule: "we-to-i"; detail: string }
  | { rule: "new-number"; detail: string };

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000", million: "1000000", billion: "1000000000",
  half: "half", double: "double", twice: "twice", triple: "triple", percent: "%",
};

function words(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, "'").match(/[a-z']+|\d+(?:[.,]\d+)*%?/g) ?? [];
}

/** Every quantity mentioned, normalized so "eighty" and "80" compare equal. */
export function quantities(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) {
    if (/^\d/.test(w)) {
      const pct = w.endsWith("%");
      const n = w.replace(/%$/, "").replace(/,(?=\d{3}\b)/g, "");
      out.add(n);
      if (pct) out.add("%");
    } else if (w in NUMBER_WORDS) {
      out.add(NUMBER_WORDS[w]!);
    }
  }
  return out;
}

/** Verbs the speaker attributed to "we" ("we built" -> "built"). */
function weVerbs(text: string): Set<string> {
  const ws = words(text);
  const verbs = new Set<string>();
  for (let i = 0; i < ws.length - 1; i++) {
    if (ws[i] === "we" || ws[i] === "we've" || ws[i] === "we'd") verbs.add(ws[i + 1]!);
  }
  return verbs;
}

export function checkBestSelfAnswer(original: string, rewrite: string): GuardFailure[] {
  const failures: GuardFailure[] = [];

  const shared = weVerbs(original);
  const rw = words(rewrite);
  for (let i = 0; i < rw.length - 1; i++) {
    if ((rw[i] === "i" || rw[i] === "i've") && shared.has(rw[i + 1]!)) {
      failures.push({ rule: "we-to-i", detail: `"we ${rw[i + 1]}" became "I ${rw[i + 1]}"` });
    }
  }

  const known = quantities(original);
  for (const q of quantities(rewrite)) {
    if (!known.has(q)) failures.push({ rule: "new-number", detail: `"${q}" is not in the Answer` });
  }

  return failures;
}

export function describeFailures(failures: GuardFailure[]): string {
  return failures.map((f) => `- ${f.rule}: ${f.detail}`).join("\n");
}
