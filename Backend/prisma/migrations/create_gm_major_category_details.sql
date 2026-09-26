-- Migration: create gm_major_category_details table
-- Source: GM HIERARCHY_new.xlsx
-- Stores GM major category hierarchy with LOB/SEG/DIV/SUB_DIV, MC codes, archetypes, and family codes.
-- Each row = one major category × family code combination.

CREATE TABLE IF NOT EXISTS public.gm_major_category_details (
  id            SERIAL PRIMARY KEY,
  seg           VARCHAR(50),
  div           VARCHAR(50),
  sub_div       VARCHAR(100),
  maj_cat_nm    VARCHAR(200),
  mc_cd         VARCHAR(50),
  maj_cat_desc  VARCHAR(500),
  mj_status     VARCHAR(20),
  archetype     VARCHAR(100),
  archetype_nm  VARCHAR(200),
  family_code   VARCHAR(100),
  family_name   VARCHAR(200),
  status        VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_mc_details_maj_cat_nm   ON public.gm_major_category_details (maj_cat_nm);
CREATE INDEX IF NOT EXISTS idx_gm_mc_details_mc_cd        ON public.gm_major_category_details (mc_cd);
CREATE INDEX IF NOT EXISTS idx_gm_mc_details_div          ON public.gm_major_category_details (div);
CREATE INDEX IF NOT EXISTS idx_gm_mc_details_family_code  ON public.gm_major_category_details (family_code);
CREATE INDEX IF NOT EXISTS idx_gm_mc_details_seg          ON public.gm_major_category_details (seg);
