-- The Replay audio endpoint speaks the stored Best-self answer, and the Story bank shows the
-- final Answer beside it, so a finished Round keeps both texts. Kept in its own migration
-- because 0001 may already be applied.
ALTER TABLE rounds ADD COLUMN final_answer TEXT;
ALTER TABLE rounds ADD COLUMN best_self_text TEXT;
