-- CMP COST TOTAL row (sum of PR VAL per scenario, or a user override).
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS total_bgt_pr_val    NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS total_act_pr_val    NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS total_vendor_pr_val NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS total_final_pr_val  NUMERIC(10,4);
