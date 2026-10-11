BEGIN;
SET LOCAL lock_timeout = '5s';
-- Fail on ambiguous existing accounts instead of merging or deleting their history.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique ON users (lower(btrim(email)));
ALTER TABLE users ADD COLUMN IF NOT EXISTS management_revision integer NOT NULL DEFAULT 0;
COMMIT;
