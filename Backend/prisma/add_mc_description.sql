ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS mc_description VARCHAR(200);
