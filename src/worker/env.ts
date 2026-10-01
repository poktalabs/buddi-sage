// Worker bindings: vars from wrangler.jsonc, secrets from .dev.vars / wrangler secret.
export interface Env {
  DB: D1Database;
  ELEVEN_API_BASE: string;
  NEBIUS_API_BASE: string;
  COACH_MODEL: string;
  REWRITE_MODEL: string;
  TTS_MODEL: string;
  AGENT_ID: string;
  ELEVENLABS_API_KEY: string;
  NEBIUS_API_KEY: string;
  LLM_PROXY_SECRET: string;
  SESSION_SECRET: string;
  ADMIN_SECRET: string;
  // Telegram admin bot. All three optional: without them the bot and request pings are off.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_OWNER_ID?: string;
}

export type Session = { code: string };
