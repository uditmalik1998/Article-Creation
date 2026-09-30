-- Migration: add hsn_cd column to gm_major_category_details

ALTER TABLE public.gm_major_category_details
  ADD COLUMN IF NOT EXISTS hsn_cd VARCHAR(50);
