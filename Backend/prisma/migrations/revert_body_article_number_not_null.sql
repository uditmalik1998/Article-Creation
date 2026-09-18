-- Reverts enforce_body_article_number_not_null.sql (now deleted).
-- body_article_data.body_article_number is nullable again: the app creates a body article
-- row before SAP assigns the number (ApproverController.createBodyArticleFromFG, number
-- filled in later by zmmBodyArtCreationService), so requiring it upfront blocked that flow.
-- Restores the partial unique index from clean_body_article_number_dupes_and_nulls.sql,
-- which still prevents duplicate numbers while allowing rows that have none yet.
-- Idempotent — safe to run more than once.

ALTER TABLE body_article_data
  ALTER COLUMN body_article_number DROP NOT NULL;

ALTER TABLE body_article_data
  DROP CONSTRAINT IF EXISTS body_article_number_not_blank;

DROP INDEX IF EXISTS body_article_data_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS body_article_data_number_unique
  ON body_article_data (body_article_number)
  WHERE body_article_number IS NOT NULL AND body_article_number <> '';
