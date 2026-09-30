-- A code is the Guest's identity; the Allowance counts Rounds (see CONTEXT.md).
CREATE TABLE codes (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'gift', 'owner')),
  allowance INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  contact TEXT,
  voice_id TEXT,
  voice_created_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- One row per Round (one ElevenAgents conversation).
CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES codes(code),
  question_id TEXT NOT NULL,
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'replayed', 'fallback', 'failed')),
  rewrite_attempts INTEGER NOT NULL DEFAULT 0,
  guard_failures TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX rounds_code ON rounds(code);
