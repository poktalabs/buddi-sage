// Outbound Telegram messages to Mel (the only person the admin bot talks to). Replies to
// Mel's own commands go back in the webhook response instead (routes/telegram.ts), so this is
// only for pushes the Worker starts itself, like a new Code request. Plain text, no parse
// mode: a Contact or goal with Markdown characters can never break the message.
import type { Env } from "./env";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const TELEGRAM_API = "https://api.telegram.org";

export function telegramEnabled(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_ID);
}

/** Sends `text` to Mel; false when the bot is off or Telegram refuses. Never throws. */
export async function notifyOwner(env: Env, text: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)): Promise<boolean> {
  if (!telegramEnabled(env)) return false;
  try {
    const res = await fetchImpl(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_OWNER_ID, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("telegram notify failed", res.status);
    return res.ok;
  } catch (err) {
    console.error("telegram notify failed", err instanceof Error ? err.name : typeof err);
    return false;
  }
}
