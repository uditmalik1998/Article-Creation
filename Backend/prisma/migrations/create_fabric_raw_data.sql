-- Migration: create fabric_raw_data table
-- Mirrors raw_articles columns + fabric-specific extras:
--   vendor_city, season, garment_weight, available_qty, approved_by, notes

CREATE TABLE IF NOT EXISTS public.fabric_raw_data (
  id                        TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  presentation_no           VARCHAR(100) NOT NULL,
  unique_key                TEXT        NOT NULL UNIQUE,
  vendor_code               VARCHAR(50),
  vendor_name               VARCHAR(200),
  vendor_city               VARCHAR(100),
  division                  VARCHAR(100),
  sub_division              VARCHAR(100),
  major_category            VARCHAR(200),
  presentations_type        TEXT,
  design_number             VARCHAR(255),
  article_number            VARCHAR(100),
  fabric                    VARCHAR(100),
  no_of_colors              INTEGER,
  price                     NUMERIC(10,2),
  image_url                 TEXT,
  source                    VARCHAR(50),
  season                    VARCHAR(50),
  garment_weight            NUMERIC(8,2),
  available_qty             NUMERIC(12,2),
  approved_by               VARCHAR(200),
  notes                     TEXT,
  status                    "RawArticleStatus"  NOT NULL DEFAULT 'PENDING'::"RawArticleStatus",
  retry_count               INTEGER             NOT NULL DEFAULT 0,
  error_message             TEXT,
  extracted_data            JSONB,
  extracted_at              TIMESTAMPTZ,
  flat_id                   TEXT,
  locked_until              TIMESTAMPTZ,
  presentation_received_date TIMESTAMPTZ,
  created_at                TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fabric_raw_data_presentation_no ON public.fabric_raw_data (presentation_no);
CREATE INDEX IF NOT EXISTS idx_fabric_raw_data_status          ON public.fabric_raw_data (status);
CREATE INDEX IF NOT EXISTS idx_fabric_raw_data_vendor_code     ON public.fabric_raw_data (vendor_code);
CREATE INDEX IF NOT EXISTS idx_fabric_raw_data_created_at      ON public.fabric_raw_data (created_at);

CREATE OR REPLACE FUNCTION public.set_fabric_raw_data_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fabric_raw_data_updated_at ON public.fabric_raw_data;
CREATE TRIGGER trg_fabric_raw_data_updated_at
  BEFORE UPDATE ON public.fabric_raw_data
  FOR EACH ROW EXECUTE FUNCTION public.set_fabric_raw_data_updated_at();
