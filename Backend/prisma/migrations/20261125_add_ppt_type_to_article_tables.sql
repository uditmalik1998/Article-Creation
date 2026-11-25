-- PPT type (V2PD / RETAIL) next to ppt_number on the three article tables (2026-11-25). NOT applied yet.
-- Nullable, so existing rows stay valid; the UI picks it per article.
-- Run this BEFORE (or together with) deploying the new backend: the new Prisma client selects ppt_type,
-- so the article lists fail with "column does not exist" until this has run.
-- Not the same as "Presentations_type" (FG Article / Fabric Article / GM Article).
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS ppt_type TEXT;
ALTER TABLE public.extraction_results_flat
  DROP CONSTRAINT IF EXISTS extraction_results_flat_ppt_type_check;
ALTER TABLE public.extraction_results_flat
  ADD CONSTRAINT extraction_results_flat_ppt_type_check CHECK (ppt_type IN ('V2PD', 'RETAIL'));

ALTER TABLE public.fabric_article_data
  ADD COLUMN IF NOT EXISTS ppt_type TEXT;
ALTER TABLE public.fabric_article_data
  DROP CONSTRAINT IF EXISTS fabric_article_data_ppt_type_check;
ALTER TABLE public.fabric_article_data
  ADD CONSTRAINT fabric_article_data_ppt_type_check CHECK (ppt_type IN ('V2PD', 'RETAIL'));

ALTER TABLE public.gm_article_data
  ADD COLUMN IF NOT EXISTS ppt_type TEXT;
ALTER TABLE public.gm_article_data
  DROP CONSTRAINT IF EXISTS gm_article_data_ppt_type_check;
ALTER TABLE public.gm_article_data
  ADD CONSTRAINT gm_article_data_ppt_type_check CHECK (ppt_type IN ('V2PD', 'RETAIL'));
