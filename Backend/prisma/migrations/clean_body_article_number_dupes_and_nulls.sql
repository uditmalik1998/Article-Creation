-- Root-cause cleanup for body_article_data.body_article_number:
--   1. Removes rows with no body_article_number at all — abandoned creation
--      attempts (ApproverController creates a row before SAP assigns a
--      number, via zmmBodyArtCreationService; these never got one and sit
--      PENDING/NOT_SYNCED or PENDING/FAILED forever).
--   2. Collapses duplicate body_article_number rows to exactly one each,
--      keeping the APPROVED + SYNCED row — every duplicated number has
--      exactly one such row (the real, completed article) plus abandoned
--      PENDING retries from repeated create attempts before a number was
--      assigned (the existing duplicate guard only checks for an
--      ALREADY-numbered row, so a still-pending or failed attempt doesn't
--      block a fresh retry).
--   3. Adds a partial unique index so a duplicate body_article_number can
--      never be inserted again, regardless of what the application does.
-- Idempotent — safe to run more than once; each step is a no-op once done.

DELETE FROM body_article_data
WHERE body_article_number IS NULL OR TRIM(body_article_number) = '';

DELETE FROM body_article_data
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY body_article_number
      ORDER BY (approval_status = 'APPROVED' AND sap_sync_status = 'SYNCED') DESC, updated_at DESC
    ) AS rn
    FROM body_article_data
    WHERE body_article_number IS NOT NULL AND body_article_number <> ''
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS body_article_data_number_unique
  ON body_article_data (body_article_number)
  WHERE body_article_number IS NOT NULL AND body_article_number <> '';
