-- The Guest's target job (one per code, like BUDDi's Opportunity). job_source is what they
-- gave: a link or the post text, or the job from their code request. job_brief is the JSON
-- JobBrief built from it. job_sets counts how many briefs were built, to cap model calls.
ALTER TABLE codes ADD COLUMN job_source TEXT;
ALTER TABLE codes ADD COLUMN job_brief TEXT;
ALTER TABLE codes ADD COLUMN job_sets INTEGER NOT NULL DEFAULT 0;
-- Questions can now come from the job brief, so a Round keeps the text it was asked.
ALTER TABLE rounds ADD COLUMN question_text TEXT;
