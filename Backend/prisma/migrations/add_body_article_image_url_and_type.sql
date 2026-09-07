-- Migration: add image_url and body_article_type to body_article_data

ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS image_url        TEXT,
  ADD COLUMN IF NOT EXISTS body_article_type VARCHAR(100);
