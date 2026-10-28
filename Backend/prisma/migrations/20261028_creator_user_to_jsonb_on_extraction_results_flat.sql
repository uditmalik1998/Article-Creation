-- creator_user: list of distinct editors [{name, email}] on the FG New article page
ALTER TABLE extraction_results_flat
  ALTER COLUMN creator_user TYPE JSONB USING NULL;
