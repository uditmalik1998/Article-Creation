-- Migration: rename CMPT cost column to CMTP on body_article_data and extraction_results_flat
-- (matches Prisma field rename cmptCost -> cmtpCost)

ALTER TABLE public.body_article_data
  RENAME COLUMN cmpt_cost TO cmtp_cost;

ALTER TABLE public.extraction_results_flat
  RENAME COLUMN cmpt_cost TO cmtp_cost;
