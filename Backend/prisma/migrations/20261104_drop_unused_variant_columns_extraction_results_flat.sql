-- extraction_results_flat: drop unused variant columns (2026-11-04). NOT applied yet.
-- All 4 columns are NULL in every row; variants live in fg_variants_article_data since 2026-10-16.
-- Code no longer reads or writes them (Prisma fields removed). size / article_type are still used - kept.

-- Step 1: safe any time
DROP INDEX IF EXISTS public.extraction_results_flat_generic_article_id_idx;

-- Step 2: ONLY after the new backend is deployed (the old Prisma client still selects these columns)
ALTER TABLE public.extraction_results_flat
  DROP COLUMN IF EXISTS generic_article_id,
  DROP COLUMN IF EXISTS variant_size,
  DROP COLUMN IF EXISTS variant_color,
  DROP COLUMN IF EXISTS variant_weight;
