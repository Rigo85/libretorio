BEGIN;
CREATE TABLE IF NOT EXISTS reading_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 original_archive_id integer NOT NULL,
 archive_id integer REFERENCES archive(id) ON DELETE SET NULL,
 snapshot jsonb NOT NULL,
 first_visited_at timestamptz NOT NULL DEFAULT now(),
 last_visited_at timestamptz NOT NULL DEFAULT now(),
 visits integer NOT NULL DEFAULT 1 CHECK (visits > 0),
 last_visit_operation uuid NOT NULL,
 UNIQUE(user_id, original_archive_id)
);
CREATE INDEX IF NOT EXISTS reading_history_recent ON reading_history(user_id,last_visited_at DESC,id);
CREATE INDEX IF NOT EXISTS reading_history_archive ON reading_history(archive_id);
CREATE TABLE IF NOT EXISTS reading_progress (
 history_id uuid NOT NULL REFERENCES reading_history(id) ON DELETE CASCADE,
 representation text NOT NULL CHECK (representation IN ('pdf','converted-pdf','epub','audio')),
 source_revision text NOT NULL,
 position jsonb NOT NULL CHECK (jsonb_typeof(position)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 last_operation uuid NOT NULL,
 operation_hash text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(history_id,representation)
);
COMMIT;
