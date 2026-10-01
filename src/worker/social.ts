// Code request fields. The handle is the account the requester will DM Mel from, on
// Instagram, X or TikTok; the form does not ask which, because Mel sees the DM arrive. So
// one rule covers all three: letters, digits, dots and underscores, up to 30 characters. A
// leading @ or a pasted profile URL is reduced to the handle.
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
export const MAX_JOB_LENGTH = 300;

/** The bare handle (no @) if it looks like a social handle, else null. */
export function normaliseHandle(input: string): string | null {
  let h = input.trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|x\.com|twitter\.com|tiktok\.com)\/@?([^/?#\s]+)/i.exec(h);
  if (fromUrl) h = fromUrl[1]!;
  h = h.replace(/^@/, "");
  return HANDLE.test(h) ? h : null;
}

/** The job as given (a link or a title), whitespace collapsed; null if empty; undefined if too long. */
export function normaliseJob(input: string): string | null | undefined {
  const j = input.trim().replace(/\s+/g, " ");
  if (!j) return null;
  return j.length > MAX_JOB_LENGTH ? undefined : j;
}
