-- Migration: add precise consumption fields to body_article_data

ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS precise_fab_cons       NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS precise_width          NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS precise_gsm            NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS precise_ratio          NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS precise_consumption_kg NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS precise_consumption_meter NUMERIC(10, 4);
