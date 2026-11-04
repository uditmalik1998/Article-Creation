-- extraction_results_flat: drop size, article_type, MVGR full-form columns and pd_status (2026-11-04). NOT applied yet.
-- Code no longer reads or writes them (Prisma fields + PdStatus enum removed). weight is KEPT (sent to SAP).

-- Step 1: safe any time
DROP INDEX IF EXISTS public.idx_erf_approval_pd;

-- Step 2: ONLY after the new backend is deployed (the old Prisma client still selects these columns)
ALTER TABLE public.extraction_results_flat
  DROP COLUMN IF EXISTS size,
  DROP COLUMN IF EXISTS article_type,
  DROP COLUMN IF EXISTS macro_mvgr_full_form,
  DROP COLUMN IF EXISTS main_mvgr_full_form,
  DROP COLUMN IF EXISTS m_fab2_full_form,
  DROP COLUMN IF EXISTS pd_status;
DROP TYPE IF EXISTS public.pd_status;
