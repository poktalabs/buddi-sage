// The fallback Replay text when the Best-self answer fails the guard rules twice: the Guest's
// own final Answer, lightly tidied. It may only remove, never add: standalone fillers go, an
// immediately repeated word collapses, whitespace and punctuation spacing are tidied, and the
// first letter is capitalised with a closing full stop. "like" and "you know" stay on purpose:
// they are sometimes content, and removing content is worse than leaving a filler.

const FILLER = /(^|[^\p{L}\p{N}'])(?:um|uh|erm|er|uhm|hmm|mm)(?![\p{L}\p{N}'])(?:\s*,)?/giu;
const REPEAT = /(^|[^\p{L}\p{N}'])([\p{L}\p{N}']+)(?:\s*,?\s+\2)+(?![\p{L}\p{N}'])/giu;

export function cleanAnswer(text: string): string {
  // Tidying punctuation can expose another filler or repeat ("built ,built"), so run the
  // passes to a fixpoint. No pass lengthens the text, and the cap is a backstop.
  let out = text;
  for (let i = 0; i < 10; i++) {
    const next = tidy(out);
    if (next === out) break;
    out = next;
  }

  if (!out) return "";
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (!/[.!?]$/.test(out)) out += ".";
  return out;
}

function tidy(text: string): string {
  let out = text.replace(/\s+/g, " ");

  let prev: string;
  do {
    prev = out;
    out = out.replace(FILLER, "$1");
  } while (out !== prev);

  do {
    prev = out;
    out = out.replace(REPEAT, "$1$2");
  } while (out !== prev);

  out = out
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?])(?:\s*[.!?])+/g, "$1")
    .replace(/([.!?])\s*,/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/,\s*([.!?;:])/g, "$1")
    .replace(/^[\s,.;:!?]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
  return out;
}
