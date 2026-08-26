-- Migration: add CMPT Cost, CMP Cost, FAB Cost to body_article_data and extraction_results_flat

-- Body article cost columns
ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS cmpt_cost NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cmp_cost  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fab_cost  NUMERIC(10,2);

-- Same columns on extraction_results_flat so the standard PUT /approver/items/:id save works
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS cmpt_cost NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cmp_cost  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fab_cost  NUMERIC(10,2);
