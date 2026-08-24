-- Migration: create body_article_data table
-- Stores one row per body article created from the Body & Construction card

CREATE TABLE IF NOT EXISTS public.body_article_data (
  id                       VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Body & Construction attributes
  m_collar_type            VARCHAR(100),
  m_collar_style           VARCHAR(100),
  m_neck_type              VARCHAR(100),
  m_neck_style             VARCHAR(100),
  m_placket                VARCHAR(100),
  m_blt_type               VARCHAR(100),
  m_blt_style              VARCHAR(100),
  m_sleeves_main_style     VARCHAR(100),
  m_sleeve_fold            VARCHAR(100),
  m_btm_fold               VARCHAR(100),
  m_no_of_pocket           VARCHAR(100),
  m_pocket                 VARCHAR(100),
  m_extra_pocket           VARCHAR(100),
  m_fit                    VARCHAR(100),
  m_body_style             VARCHAR(100),
  m_length                 VARCHAR(100),
  m_set                    VARCHAR(100),

  -- Body article output
  body_article_number      VARCHAR(100),
  body_article_description VARCHAR(255),

  -- Article context
  flat_id                  VARCHAR(100),
  article_number           VARCHAR(100),
  division                 VARCHAR(100),
  sub_division             VARCHAR(100),
  major_category           VARCHAR(200),
  mc_code                  VARCHAR(50),
  vendor_name              VARCHAR(200),
  vendor_code              VARCHAR(100),
  season                   VARCHAR(50),
  year                     VARCHAR(10),
  hsn_tax_code             VARCHAR(50),

  -- Workflow
  approval_status          VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  approved_at              TIMESTAMPTZ,
  approved_by              INTEGER,
  sap_sync_status          VARCHAR(20)   NOT NULL DEFAULT 'NOT_SYNCED',
  sap_sync_message         TEXT,

  -- Audit
  user_name                VARCHAR(200),
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_article_data_approval_status  ON public.body_article_data (approval_status);
CREATE INDEX IF NOT EXISTS idx_body_article_data_sap_sync_status  ON public.body_article_data (sap_sync_status);
CREATE INDEX IF NOT EXISTS idx_body_article_data_body_art_number  ON public.body_article_data (body_article_number);
CREATE INDEX IF NOT EXISTS idx_body_article_data_major_category   ON public.body_article_data (major_category);
CREATE INDEX IF NOT EXISTS idx_body_article_data_division         ON public.body_article_data (division);
CREATE INDEX IF NOT EXISTS idx_body_article_data_flat_id          ON public.body_article_data (flat_id);
CREATE INDEX IF NOT EXISTS idx_body_article_data_article_number   ON public.body_article_data (article_number);
CREATE INDEX IF NOT EXISTS idx_body_article_data_created_at       ON public.body_article_data (created_at DESC);
