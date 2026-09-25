-- Migration: create reference_article_data table
-- Stores one row per reference article, combining Construction & Fabric and Body & Construction attributes

CREATE TABLE IF NOT EXISTS public.reference_article_data (
  id                       VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Construction & Fabric card attributes (SAP attribute names in lowercase)
  m_fab_div                VARCHAR(100),
  m_yarn                   VARCHAR(100),
  m_fab_main_mvgr_1        VARCHAR(100),
  m_fab_main_mvgr_2        VARCHAR(100),
  m_fab_vdr                VARCHAR(100),
  m_weave_01               VARCHAR(100),
  m_weave_02               VARCHAR(100),
  m_count                  VARCHAR(100),
  m_gsm                    VARCHAR(100),
  m_ounz                   VARCHAR(100),
  m_construction           VARCHAR(100),
  m_composition            VARCHAR(100),
  m_finish                 VARCHAR(100),
  m_width                  VARCHAR(100),
  m_lycra                  VARCHAR(100),

  -- Body & Construction card attributes (SAP attribute names in lowercase)
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

  -- Linked article references
  fabric_article_no        VARCHAR(100),
  fabric_article_description VARCHAR(500),
  body_article_no          VARCHAR(100),
  body_article_description VARCHAR(500),

  -- Reference article output
  reference_article_no     VARCHAR(100),
  reference_article_description VARCHAR(500),

  -- Article context (mirrored from parent extraction_results_flat row)
  flat_id                  VARCHAR(100),
  division                 VARCHAR(100),
  sub_division             VARCHAR(100),
  major_category           VARCHAR(200),
  mc_code                  VARCHAR(50),
  vendor_name              VARCHAR(200),
  vendor_code              VARCHAR(100),
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

CREATE INDEX IF NOT EXISTS idx_ref_art_data_approval_status   ON public.reference_article_data (approval_status);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_sap_sync_status   ON public.reference_article_data (sap_sync_status);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_reference_art_no  ON public.reference_article_data (reference_article_no);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_fabric_article_no ON public.reference_article_data (fabric_article_no);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_body_article_no   ON public.reference_article_data (body_article_no);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_major_category    ON public.reference_article_data (major_category);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_division          ON public.reference_article_data (division);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_flat_id           ON public.reference_article_data (flat_id);
CREATE INDEX IF NOT EXISTS idx_ref_art_data_created_at        ON public.reference_article_data (created_at DESC);
