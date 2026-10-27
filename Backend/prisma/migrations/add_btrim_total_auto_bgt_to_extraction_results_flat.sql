-- B TRIM TOTAL row: AUTO-BGT total (always the sum of the rows, read-only on screen).
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS b_trim_total_auto_bgt NUMERIC(10,2);
