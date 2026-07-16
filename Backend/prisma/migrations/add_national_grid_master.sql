-- Migration: create national_grid_master table
CREATE TABLE IF NOT EXISTS public.national_grid_master (
  id             SERIAL PRIMARY KEY,
  attribute_name VARCHAR(100) NOT NULL,
  code           VARCHAR(100) NOT NULL,
  full_form      VARCHAR(500),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_national_grid_attr_code UNIQUE (attribute_name, code)
);

CREATE INDEX IF NOT EXISTS idx_national_grid_attribute_name
  ON public.national_grid_master (attribute_name);
