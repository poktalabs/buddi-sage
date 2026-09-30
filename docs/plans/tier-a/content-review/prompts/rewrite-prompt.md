Review ONE BUDDi Sage Mode content file: content/rewrite-prompt.md.

## Requirement (wins over taste)
- rewrite-prompt.md: system prompt for a rewrite model (MiniMax-M3, which tends to turn "we" into "I" and make hedges certain). Output is spoken in the Guest's own cloned voice as a Best-self answer: 30 to 45 seconds (about 80 to 115 words); situation, action, result, lesson, in that order; the Guest's register and own phrases; only facts the Guest said (no new numbers, tools, names or outcomes); "we" stays "we", "I" stays "I"; hedges stay hedges; a missing part is left out, never invented; first person; plain spoken text, no markdown, no lists, no em-dashes. Must contain the placeholders {{question}} and {{answer}}, then a section headed exactly `## Retry addendum` containing {{failures}}. The code splits the file on that heading. Note guards.ts NUMBER_WORDS: any number word not in the Answer ("one", "half", "twice") fails the check.

## Glossary (CONTEXT.md; use these exact words in copy)
# BUDDi Sage Mode

Sage Mode is a BUDDi interview-practice experience: a voice coach helps you answer a hard interview question, then you hear your own answer the way your best self would say it, in your own voice.

## Language

### People and voices

**Sage**:
The voice coach the user talks to during a Session. Sage always speaks in its own neutral voice, never in the user's voice.
_Avoid_: agent (in user-facing copy), coach bot, avatar

**Voice clone**:
A copy of the user's own voice, made from a Voice sample given with explicit Consent. Used only for the Replay. Kept until the user deletes it.
_Avoid_: Sage voice, cloned Sage, voice model

**Voice sample**:
The user's recording of a provided reading script, used to make the Voice clone.
_Avoid_: training audio, upload

**Consent**:
The user's explicit opt-in, given before any recording, to clone their own voice and only their own voice.
_Avoid_: terms acceptance

### Practice

**Session**:
One sitting in Sage Mode: Consent (first time only), then one or more Rounds.
_Avoid_: call, conversation (reserve "conversation" for the ElevenAgents runtime object)

**Round**:
One Question practiced end to end: Answer, Pushback, second attempt, save, Replay. The unit an Allowance counts.
_Avoid_: session, attempt, turn

**Question**:
One interview question from the fixed Question set, aimed at AI engineers.
_Avoid_: prompt

**Question set**:
The fixed list of Questions Sage can ask. Not generated from a CV or job description (yet).

**Answer**:
What the user says in response to a Question. The user's final Answer is the one Sage saves after coaching.
_Avoid_: response, reply

**Story bank**:
The user's collection of saved final Answers, one per Question, reusable in future interviews.
_Avoid_: answer log, history

**Replay**:
The moment Sage plays back the user's final Answer, rewritten as a Best-self answer, spoken in the user's Voice clone.
_Avoid_: playback, echo

**Best-self answer**:
The user's final Answer rewritten to keep their content and story but deliver it with confidence and structure. Never adds facts the user didn't say.
_Avoid_: ideal answer, model answer, improved answer

**Pushback**:
The single, specific challenge Sage makes after the user's first Answer to a Question, before the second attempt.
_Avoid_: feedback, critique

**Hesitation signals**:
Measurable signs of an unsure delivery in the user's final Answer: filler words, long pauses and pace. Shown beside the Replay.
_Avoid_: confidence score, fluency score

### Access

**Guest**:
A person using Sage Mode through a code. Identified by the code, not by an account.
_Avoid_: user account, member

**Guest code**:
A code with a small fixed Allowance of Rounds, meant to be shared widely.
_Avoid_: invite, access code

**Gift code**:
A code with an Allowance of Rounds chosen for one specific person.
_Avoid_: voucher, promo code

**Allowance**:
The number of Rounds a code may start. A Round counts when its coaching conversation starts.
_Avoid_: credits, quota, tokens

**Contact**:
The email or X handle a Guest gives before their first Session, used only to ask for feedback.
_Avoid_: lead, signup


## guards.ts (the automatic checks every rewrite must pass)
```ts
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

```

## The file under review: content/rewrite-prompt.md
```markdown
You rewrite a Guest's spoken interview Answer into their Best-self answer. The Guest is a job seeker practicing for an interview. Their Best-self answer keeps the same content and the same story, delivered with confidence and structure. The Guest will hear it spoken in their own voice, so it must sound like them on a good day, not like someone else.

The interview Question was: {{question}}

The Guest's final Answer, transcribed from speech, was: {{answer}}

Rules. Follow every one. They matter more than sounding impressive.

1. Use only facts the Guest said. Add no new numbers, tools, names, technologies, companies, metrics, or outcomes. If a detail is not in the Answer, it does not exist.

2. Keep "we" as "we" and "I" as "I", exactly as spoken. If they said "we built it", you say "we built it", never "I built it". Do not give the Guest credit for work they attributed to the team, and do not take credit away from them.

3. Keep hedges as hedges. "Maybe half" stays approximate, for example "maybe half" or "roughly half". "I think it was that library" stays uncertain. Never turn a guess into a certainty.

4. Do not use any number, digit, or number word the Guest did not say. That includes casual phrases like "one thing I learned" or "one day" when they never said "one", and words like "twice", "double", or "half" when they never said them.

5. Structure it as situation, action, result, lesson, in that order. If a part is missing from the Answer (for example, they never said what the result was), leave that part out. Never invent it, and never fill it with a vague claim like "it worked well".

6. Keep the Guest's register and their own phrases. When they described something in a vivid way of their own, keep their wording. Drop filler words (um, uh, like as filler, you know, so yeah), false starts, and repeated words.

7. Speak in the first person, as the Guest.

8. Aim for 30 to 45 seconds spoken, about 80 to 115 words. If the Answer is short, the Best-self answer is short too. Length never justifies adding content.

9. Output plain spoken text only: no markdown, no lists, no headings, no quotation marks around the whole thing, no em-dashes, no preamble, no notes. Output only the words the Guest will hear.

## Retry addendum

Your previous rewrite broke these rules:

{{failures}}

Write the Best-self answer again from the Guest's Answer above, not from your previous rewrite. Fix every problem listed, and keep following all the rules.

```

Output in markdown: `# content/rewrite-prompt.md`, then `Verdict:` SHIP, SHIP WITH EDITS or REWRITE, then ranked issues (each naming the canon reference that decides it), then the complete revised file in one fenced block.  No em-dashes.