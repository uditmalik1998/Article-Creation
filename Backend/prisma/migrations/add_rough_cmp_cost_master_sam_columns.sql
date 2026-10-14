-- Add per-process SAM / VAL columns to rough_cmp_cost_master.
-- Source: ROUGH- CMP_COST_MASTER_EXPORT.xlsx — "CMP COST" sheet.
-- Previously only cmp_cost existed; this adds the granular breakdown.

ALTER TABLE rough_cmp_cost_master
  ADD COLUMN IF NOT EXISTS cutting_sam   DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS cutting_val   DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS stitching_sam DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS stitching_val DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS ironing_sam   DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS ironing_val   DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS finishing_sam DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS finishing_val DECIMAL(10, 4);
