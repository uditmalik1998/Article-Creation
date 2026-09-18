-- Migration: add body consumption fields to body_article_data

ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS body_consumption_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gsm                   NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS ratio                 NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS consumption_kg        NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS consumption_meter     NUMERIC(10, 4);
