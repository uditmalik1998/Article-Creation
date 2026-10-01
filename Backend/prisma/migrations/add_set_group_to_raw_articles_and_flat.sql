-- Migration: SRM set articles. Every photo of one set shares set_group_id;
-- set_role is PARENT (the set's own photo), TOP (primary piece) or PIECE.
-- All columns are nullable, so normal (non-set) articles are unaffected.
--
-- Applied to the MDM project (hgdftqswlvkspzjtlrll). SRM's
-- sync-presentation-to-mdm writes the three raw_articles columns; the
-- extraction worker copies them onto extraction_results_flat.

ALTER TABLE public.raw_articles
  ADD COLUMN IF NOT EXISTS set_group_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS set_role     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS set_name     VARCHAR(200);

ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS set_group_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS set_role     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS set_name     VARCHAR(200);

DO $$ BEGIN
  ALTER TABLE public.raw_articles
    ADD CONSTRAINT chk_raw_articles_set_role
      CHECK (set_role IS NULL OR set_role IN ('PARENT', 'TOP', 'PIECE'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.extraction_results_flat
    ADD CONSTRAINT chk_erf_set_role
      CHECK (set_role IS NULL OR set_role IN ('PARENT', 'TOP', 'PIECE'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_erf_ppt_set_group
  ON public.extraction_results_flat (ppt_number, set_group_id);
CREATE INDEX IF NOT EXISTS idx_raw_articles_set_group
  ON public.raw_articles (presentation_no, set_group_id);
