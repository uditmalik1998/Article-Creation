-- Migration: create gm_raw_data table
-- Similar to fabric_raw_data but without retry_count and extracted_data columns.

CREATE TABLE IF NOT EXISTS public.gm_raw_data (
  id                            VARCHAR(100)   PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Presentation / SRM fields
  presentation_no               VARCHAR(100)   NOT NULL,
  unique_key                    VARCHAR(500)   NOT NULL UNIQUE,

  -- Vendor info
  vendor_code                   VARCHAR(50),
  vendor_name                   VARCHAR(200),
  vendor_city                   VARCHAR(100),

  -- Classification
  division                      VARCHAR(100),
  sub_division                  VARCHAR(100),
  major_category                VARCHAR(200),
  presentations_type            TEXT,

  -- Article details
  design_number                 VARCHAR(255),
  article_number                VARCHAR(100),
  fabric                        VARCHAR(100),
  no_of_colors                  INTEGER,
  price                         DECIMAL(10, 2),
  image_url                     TEXT,
  source                        VARCHAR(50),

  -- GM-specific extras
  season                        VARCHAR(50),
  garment_weight                DECIMAL(8, 2),
  available_qty                 DECIMAL(12, 2),
  approved_by                   VARCHAR(200),
  notes                         TEXT,

  -- Pipeline tracking (no retry_count, no extracted_data)
  status                        VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
  error_message                 TEXT,
  extracted_at                  TIMESTAMPTZ,
  flat_id                       VARCHAR(100),
  locked_until                  TIMESTAMPTZ,

  -- Dates
  presentation_received_date    TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_raw_presentation_no ON public.gm_raw_data (presentation_no);
CREATE INDEX IF NOT EXISTS idx_gm_raw_status          ON public.gm_raw_data (status);
CREATE INDEX IF NOT EXISTS idx_gm_raw_vendor_code     ON public.gm_raw_data (vendor_code);
CREATE INDEX IF NOT EXISTS idx_gm_raw_created_at      ON public.gm_raw_data (created_at);

CREATE OR REPLACE FUNCTION public.gm_raw_data_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gm_raw_set_updated_at ON public.gm_raw_data;
CREATE TRIGGER gm_raw_set_updated_at
  BEFORE UPDATE ON public.gm_raw_data
  FOR EACH ROW EXECUTE FUNCTION public.gm_raw_data_set_updated_at();
