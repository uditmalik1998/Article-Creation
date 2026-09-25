-- Adds a GSM (grams per square meter) column to body_fabric_consumption, one
-- value per major_category (duplicated across that category's fab_width rows,
-- same convention as fab_consumption). Sourced from the FAB CONSUMPTION MASTER
-- workbook's new GSM column. Consumed by ApproverController.getFabricGsmByMajorCategory
-- to auto-fill Fabric Article Data's GSM field on the New FG Article page.
-- Idempotent — safe to run more than once.

ALTER TABLE public.body_fabric_consumption
  ADD COLUMN IF NOT EXISTS gsm NUMERIC(10, 2);
