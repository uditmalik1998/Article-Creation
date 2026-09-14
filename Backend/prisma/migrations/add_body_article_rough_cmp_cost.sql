-- Migration: add Rough CMP Cost to body_article_data

ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS rough_cmp_cost NUMERIC(10,2);
