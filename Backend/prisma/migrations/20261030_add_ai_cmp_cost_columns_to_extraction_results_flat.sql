ALTER TABLE extraction_results_flat
  ADD COLUMN IF NOT EXISTS ai_cmp_cost_cutting NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ai_cmp_cost_stitching NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ai_cmp_cost_ironing NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ai_cmp_cost_finishing NUMERIC(10,2);
