-- Where the requester will DM Mel: the landing form's logo they tapped. NULL for requests made
-- before the form asked.
ALTER TABLE code_requests ADD COLUMN platform TEXT CHECK (platform IN ('instagram', 'x', 'tiktok'));
