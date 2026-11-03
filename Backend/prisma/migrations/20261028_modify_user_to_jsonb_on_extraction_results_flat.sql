-- modify_user: list of distinct editors [{name, email}] on the FG Created page
ALTER TABLE extraction_results_flat
  ALTER COLUMN modify_user TYPE JSONB USING NULL;
