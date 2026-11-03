-- B TRIM TOTAL row (saved tab): sum of the rows, or a user override. AUTO-BGT total: see add_btrim_total_auto_bgt_to_extraction_results_flat.sql.
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS b_trim_total_rough_v2   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS b_trim_total_vdr_cost   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS b_trim_total_final_cost NUMERIC(10,2);
