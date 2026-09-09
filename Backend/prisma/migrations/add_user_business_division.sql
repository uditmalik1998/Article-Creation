-- Adds `business_division` to `users` — a coarse, always-single-valued tag
-- (MENS / KIDS / LADIES / PO), admin-editable from the Users page. Kept
-- separate from the existing `division`/`sub_division` columns: those serve
-- the Department/SubDepartment extraction-routing hierarchy, `division` can
-- hold several comma-separated values, and neither has a "PO" value at all.
--
-- Backfill only sets a value where the mapping is unambiguous — a user whose
-- `division` is exactly one of MENS/MEN/LADIES/LADY/KIDS/KID. Everyone else
-- (no division, multiple divisions, PO_COMMITTEE, Admin, PD, ...) is left
-- NULL for an admin to assign by hand — there is no reliable signal in the
-- existing data for who belongs in "PO Division", so this does not guess.
--
-- Safe to re-run: every statement is guarded.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_division" VARCHAR(20);

UPDATE "users"
SET "business_division" = CASE
  WHEN "division" IN ('MENS', 'MEN')     THEN 'MENS'
  WHEN "division" IN ('LADIES', 'LADY')  THEN 'LADIES'
  WHEN "division" IN ('KIDS', 'KID')     THEN 'KIDS'
  ELSE NULL
END
WHERE "business_division" IS NULL;
