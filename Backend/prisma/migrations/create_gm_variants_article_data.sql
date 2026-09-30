-- Migration: create gm_variants_article_data table
-- One row per GM article variant (size × color) under a parent GM article.
-- Similar to fabric_variants_article_data but with an additional variant_size column
-- since GM variants carry both a color and a size dimension.

CREATE TABLE IF NOT EXISTS public.gm_variants_article_data (
  id                      VARCHAR(100)   PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Parent GM article references
  generic_article_id      VARCHAR(100),
  generic_article_number  VARCHAR(100),

  -- Variant identity
  variant_color           VARCHAR(100),
  variant_size            VARCHAR(100),
  variant_article_number  VARCHAR(100),

  -- Article context (inherited from parent)
  division                VARCHAR(100),
  sub_division            VARCHAR(100),
  major_category          VARCHAR(200),
  mc_description          VARCHAR(200),
  vendor_name             VARCHAR(200),
  vendor_code             VARCHAR(100),
  design_number           VARCHAR(100),

  -- Pricing
  mrp                     DECIMAL(10, 2),
  rate                    DECIMAL(10, 2),

  -- Workflow
  approval_status         VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
  approved_at             TIMESTAMPTZ,
  approved_by             INTEGER,
  sap_sync_status         VARCHAR(20)    NOT NULL DEFAULT 'NOT_SYNCED',
  sap_sync_message        TEXT,

  -- Media
  image_url               TEXT,

  -- Audit
  user_name               VARCHAR(200),
  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_var_generic_article_id     ON public.gm_variants_article_data (generic_article_id);
CREATE INDEX IF NOT EXISTS idx_gm_var_generic_article_number ON public.gm_variants_article_data (generic_article_number);
CREATE INDEX IF NOT EXISTS idx_gm_var_approval_status        ON public.gm_variants_article_data (approval_status);
CREATE INDEX IF NOT EXISTS idx_gm_var_sap_sync_status        ON public.gm_variants_article_data (sap_sync_status);
CREATE INDEX IF NOT EXISTS idx_gm_var_variant_article_number ON public.gm_variants_article_data (variant_article_number);
CREATE INDEX IF NOT EXISTS idx_gm_var_created_at             ON public.gm_variants_article_data (created_at DESC);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.gm_variants_article_data_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gm_var_set_updated_at ON public.gm_variants_article_data;
CREATE TRIGGER gm_var_set_updated_at
  BEFORE UPDATE ON public.gm_variants_article_data
  FOR EACH ROW EXECUTE FUNCTION public.gm_variants_article_data_set_updated_at();
