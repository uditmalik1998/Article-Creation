-- Migration: set_mc_master — SAP "S-" merchandise categories for set articles.
--
-- Source: MDM file "SET MC FINAL.xlsx", sheet BM-H (2) (Anand / Ajay, 14-Oct-2026).
-- A set's parent is created in SAP under its set MC (e.g. 131830101 S-JB_B_SUIT_SL)
-- and each part under the S- MC of that part within its set (e.g. JB_TEES_SL ->
-- 131830102 S-JB_TEES_SL). A major category is a set category when it has an
-- ACT PARENT row here; an ACT PART row is a part category allowed in that set.
--
-- Maintained from Admin > Set MC Master (upload replaces the table). Read by
-- Article Creation (setMcMasterService) and SRM (srm-set-master edge function).
--
-- Apply to the MDM project (hgdftqswlvkspzjtlrll) before deploying the code.

CREATE TABLE IF NOT EXISTS public.set_mc_master (
  id             SERIAL PRIMARY KEY,
  set_maj_cat    VARCHAR(200) NOT NULL,          -- e.g. JB_B_SUIT_SL
  row_type       VARCHAR(10)  NOT NULL,          -- PARENT | PART
  part_position  VARCHAR(10),                    -- UPPER | LOWER | OTHER (PART rows)
  part_maj_cat   VARCHAR(200),                   -- normal category of the part, e.g. JB_TEES_SL (PART rows)
  s_mc_code      VARCHAR(20)  NOT NULL,          -- e.g. 131830102
  s_mc_des       VARCHAR(200) NOT NULL,          -- e.g. S-JB_TEES_SL
  div            VARCHAR(100),
  sub_div        VARCHAR(100),                   -- sent as SUB_DIV (SAP derives the article type from it)
  hsn_code       VARCHAR(20),                    -- sent as HSN_CODE (control code)
  status         VARCHAR(10)  NOT NULL DEFAULT 'ACT', -- ACT | INACT
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_set_mc_master_row_type CHECK (row_type IN ('PARENT', 'PART')),
  CONSTRAINT chk_set_mc_master_status   CHECK (status IN ('ACT', 'INACT')),
  CONSTRAINT chk_set_mc_master_part     CHECK (row_type = 'PARENT' OR part_maj_cat IS NOT NULL)
);

-- One parent row per set, one row per (set, part category).
CREATE UNIQUE INDEX IF NOT EXISTS uq_set_mc_master_row
  ON public.set_mc_master (set_maj_cat, row_type, COALESCE(part_maj_cat, ''));

CREATE INDEX IF NOT EXISTS idx_set_mc_master_set ON public.set_mc_master (set_maj_cat);

-- Server-side only (Article Creation backend and SRM's service-role key). No anon access.
ALTER TABLE public.set_mc_master ENABLE ROW LEVEL SECURITY;
