ALTER TABLE extraction_results_flat
  ADD COLUMN IF NOT EXISTS value_add_process_cost NUMERIC(10, 2);
