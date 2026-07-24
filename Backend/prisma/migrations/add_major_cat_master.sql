-- Migration: create major_cat_master table
-- MAJ CAT master: name, division, ideal-for, and the model-image FRAME
-- (fw | upper | lower | set) used to frame the AI model photoshoot.
CREATE TABLE IF NOT EXISTS public.major_cat_master (
  id         SERIAL PRIMARY KEY,
  maj_cat    VARCHAR(100) NOT NULL,
  name       VARCHAR(200),
  div        VARCHAR(50),
  ideal_for  VARCHAR(50),
  frame      VARCHAR(20)  NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_major_cat_master_maj_cat UNIQUE (maj_cat)
);

CREATE INDEX IF NOT EXISTS idx_major_cat_master_frame ON public.major_cat_master (frame);
CREATE INDEX IF NOT EXISTS idx_major_cat_master_div   ON public.major_cat_master (div);
