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
}

export type Session = { code: string };
