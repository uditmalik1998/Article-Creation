-- extraction_results_flat: who created / last modified the article (user names)
ALTER TABLE extraction_results_flat
  ADD COLUMN IF NOT EXISTS creator_user VARCHAR(200),
  ADD COLUMN IF NOT EXISTS modify_user VARCHAR(200);
