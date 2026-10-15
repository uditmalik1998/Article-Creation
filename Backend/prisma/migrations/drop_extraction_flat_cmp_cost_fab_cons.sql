-- Remove CMTP COST, CMP COST, FAB CON from extraction_results_flat.
-- These fields are no longer used in the Body card on the FG Article detail page.

ALTER TABLE public.extraction_results_flat
  DROP COLUMN IF EXISTS cmtp_cost,
  DROP COLUMN IF EXISTS cmp_cost,
  DROP COLUMN IF EXISTS fab_cons;
