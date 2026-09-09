-- Renames the "PO" business division value to "PD" (idempotent — safe to
-- run more than once, and a no-op once no row is left with the old value).
UPDATE "users"
SET "business_division" = 'PD'
WHERE "business_division" = 'PO';
