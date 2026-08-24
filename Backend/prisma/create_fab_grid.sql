CREATE TABLE IF NOT EXISTS public.fabric_maj_cat_grid_values (
  id             SERIAL PRIMARY KEY,
  characteristic VARCHAR(50)  NOT NULL,
  code           VARCHAR(100) NOT NULL,
  full_form      VARCHAR(500) NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fabric_maj_cat_grid_values_characteristic_code_key UNIQUE (characteristic, code)
);
CREATE INDEX IF NOT EXISTS fabric_maj_cat_grid_values_characteristic_idx ON public.fabric_maj_cat_grid_values (characteristic);
