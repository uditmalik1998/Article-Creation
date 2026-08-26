-- Migration: add FAB_CONS and WIDTH to body_article_data
-- Used by the admin "Body Article Data" bulk upload card (Admin.tsx) alongside
-- the existing cmpt_cost / cmp_cost columns.

ALTER TABLE public.body_article_data
  ADD COLUMN IF NOT EXISTS fab_cons NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS width    NUMERIC(10,2);
