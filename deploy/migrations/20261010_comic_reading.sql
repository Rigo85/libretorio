BEGIN;
ALTER TABLE reading_progress DROP CONSTRAINT reading_progress_representation_check;
ALTER TABLE reading_progress ADD CONSTRAINT reading_progress_representation_check
 CHECK (representation IN ('pdf','converted-pdf','epub','audio','comic'));
COMMIT;
