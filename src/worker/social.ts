// Social handles for Code requests. A requester names the account they will DM Mel from, so
// the handle must look like a real one on that platform (Mel matches the DM to it). Loose on
// purpose otherwise: a leading @ or a pasted profile URL is accepted and reduced to the handle.
import type { SocialPlatform } from "../shared/api";

const HANDLE: Record<SocialPlatform, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
};

const PLATFORM_NAME: Record<SocialPlatform, string> = { instagram: "Instagram", x: "X", tiktok: "TikTok" };

export function isPlatform(v: unknown): v is SocialPlatform {
  return v === "instagram" || v === "x" || v === "tiktok";
}

/** The bare handle (no @) if it is valid on the platform, else null. */
export function normaliseHandle(platform: SocialPlatform, input: string): string | null {
  let h = input.trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|x\.com|twitter\.com|tiktok\.com)\/@?([^/?#\s]+)/i.exec(h);
  if (fromUrl) h = fromUrl[1]!;
  h = h.replace(/^@/, "");
  return HANDLE[platform].test(h) ? h : null;
}

export function profileUrl(platform: SocialPlatform, handle: string): string {
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "x") return `https://x.com/${handle}`;
  return `https://www.tiktok.com/@${handle}`;
}

/** `@ana (Instagram)`: how a request's handle is shown to Mel and stored as a code's Contact. */
export function handleLabel(platform: SocialPlatform, handle: string): string {
  return `@${handle} (${PLATFORM_NAME[platform]})`;
}

/** An http(s) URL of at most 500 characters, else null. */
export function normaliseJobUrl(input: string): string | null {
  const s = input.trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
