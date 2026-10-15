-- GM Size Master: valid sizes per GM major category
CREATE TABLE IF NOT EXISTS public.gm_size_master (
  id         SERIAL PRIMARY KEY,
  seg        VARCHAR(50),
  div        VARCHAR(50),
  sub_div    VARCHAR(50),
  maj_cat    VARCHAR(100) NOT NULL,
  status     VARCHAR(20),
  size       VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_size_master_maj_cat ON public.gm_size_master (maj_cat);
CREATE INDEX IF NOT EXISTS idx_gm_size_master_div     ON public.gm_size_master (div);
