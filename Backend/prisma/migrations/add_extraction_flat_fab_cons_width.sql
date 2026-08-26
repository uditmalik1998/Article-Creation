-- Migration: add FAB_CONS and WIDTH to extraction_results_flat
-- Mirrors body_article_data.fab_cons / .width so the Body & Construction card
-- (and the BOM card's pre-existing but previously unbacked "Width" field) can
-- store values fetched from body_article_data via the Body Article No. search.

ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS fab_cons NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS width    NUMERIC(10,2);
