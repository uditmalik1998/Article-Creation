-- Migration: add costing_type to body_article_data

ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS costing_type VARCHAR(20);
