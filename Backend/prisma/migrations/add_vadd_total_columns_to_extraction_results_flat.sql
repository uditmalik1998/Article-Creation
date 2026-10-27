-- V. ADD TOTAL row: AUTO-BGT total is always the sum of the rows (read-only);
-- ROUGH-V2 / VENDOR COST / FINAL COST are the sum or a user override.
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS vadd_total_auto_bgt    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vadd_total_rough_v2    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vadd_total_vendor_cost NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vadd_total_final_cost  NUMERIC(10,2);
