-- Enforce body_article_data.body_article_number as a required field.
--   1. Deletes any remaining rows with no number — abandoned creation
--      attempts left behind by the old two-step flow (draft row created
--      by ApproverController.createBodyArticleFromFG, number assigned
--      later by zmmBodyArtCreationService; many never got one).
--      Builds on clean_body_article_number_dupes_and_nulls.sql, which did
--      the same cleanup once — this repeats it since the creation flow
--      keeps producing new null rows until it is reworked (tracked
--      separately; application code now blocks new null/empty inserts
--      and updates with a 400 error instead of letting them through).
--   2. Makes the column NOT NULL and rejects blank/whitespace-only values
--      via a CHECK constraint, so no code path — app or manual SQL — can
--      leave a row without a real number again.
--   3. Drops the old partial unique index (WHERE body_article_number IS
--      NOT NULL) and replaces it with a plain unique index, now that the
--      column can never be null.
-- Idempotent — safe to run more than once.

DELETE FROM body_article_data
WHERE body_article_number IS NULL OR TRIM(body_article_number) = '';

ALTER TABLE body_article_data
  ALTER COLUMN body_article_number SET NOT NULL;

ALTER TABLE body_article_data
  DROP CONSTRAINT IF EXISTS body_article_number_not_blank;

ALTER TABLE body_article_data
  ADD CONSTRAINT body_article_number_not_blank CHECK (TRIM(body_article_number) <> '');

DROP INDEX IF EXISTS body_article_data_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS body_article_data_number_unique
  ON body_article_data (body_article_number);
