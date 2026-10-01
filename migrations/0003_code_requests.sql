-- A Code request comes from the landing page from someone without a code. They give the
-- social handle they will DM Mel from (Instagram, X or TikTok) and, optionally, the job they
-- are preparing for. Mel matches the DM to the Telegram ping, then approves or dismisses it
-- from the admin bot; approving issues a code and records it here. ip_hash is an HMAC of the
-- requester's IP, kept only to rate-limit the form.
CREATE TABLE code_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'x', 'tiktok')),
  handle TEXT NOT NULL,
  job_url TEXT,
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'es')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  code TEXT REFERENCES codes(code),
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX code_requests_status ON code_requests(status);
CREATE INDEX code_requests_ip ON code_requests(ip_hash, created_at);
