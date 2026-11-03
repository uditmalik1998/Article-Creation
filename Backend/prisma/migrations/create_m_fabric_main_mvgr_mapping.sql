-- MVGR-1 -> MVGR-2 mapping for fabric main MVGR (from "MVGR1 AND MVGR2 MAPPING.xlsx").
-- Re-uploaded from Admin > Expenses > FG Attributes & Grid > Fabric Main MVGR Mapping (replaces the table).
CREATE TABLE IF NOT EXISTS public.m_fabric_main_mvgr_mapping (
  id               SERIAL PRIMARY KEY,
  mvgr1            VARCHAR(50)  NOT NULL,
  mvgr1_full_form  VARCHAR(200),
  mvgr2            VARCHAR(50)  NOT NULL UNIQUE,
  mvgr2_full_form  VARCHAR(200),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_m_fabric_main_mvgr_mapping_mvgr1 ON public.m_fabric_main_mvgr_mapping (mvgr1);
ALTER TABLE public.m_fabric_main_mvgr_mapping ENABLE ROW LEVEL SECURITY;
-- The initial 39 rows were loaded from the Excel file in the Supabase migration
-- create_m_fabric_main_mvgr_mapping.
