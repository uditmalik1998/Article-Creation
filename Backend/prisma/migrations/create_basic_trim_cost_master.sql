-- Master tables for per-piece basic trim / packaging / thread costs by major category.
-- Source: "MAJ CAT WISE BASIC ACCESSORIES DETAILS" workbook (ACC LIST + Packaging Master
-- sheets), loaded by scripts/import-basic-trim-cost-master.ts. The workbook is not kept in
-- the repo — the script takes its path as an argument and upserts by maj_cat, so a newer
-- workbook can be re-imported at any time.
--
-- basic_trims_cost is the workbook's own "BASIC & TRIMS COST" column (packaging + thread) and
-- is the value auto-filled into body_article_data.basic_trim_cost for articles with no value
-- of their own. trims_total / packaging_total / thread_cost and basic_trim_cost_component keep
-- the full breakdown so the figure can be recomposed differently later without re-importing.
-- Idempotent — safe to run more than once.

CREATE TABLE IF NOT EXISTS basic_trim_cost_master (
  id               SERIAL PRIMARY KEY,
  div              VARCHAR(50),
  sub_div          VARCHAR(50),
  maj_cat          VARCHAR(100) NOT NULL,
  trims_total      DECIMAL(10, 4),
  packaging_total  DECIMAL(10, 4),
  thread_cost      DECIMAL(10, 4),
  basic_trims_cost DECIMAL(10, 4),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS basic_trim_cost_master_maj_cat_key
  ON basic_trim_cost_master (maj_cat);

CREATE INDEX IF NOT EXISTS basic_trim_cost_master_maj_cat_idx
  ON basic_trim_cost_master (maj_cat);

CREATE TABLE IF NOT EXISTS basic_trim_cost_component (
  id        SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES basic_trim_cost_master (id) ON DELETE CASCADE,
  kind      VARCHAR(20) NOT NULL,
  component VARCHAR(50) NOT NULL,
  qty       DECIMAL(10, 4),
  rate      DECIMAL(10, 4),
  value     DECIMAL(10, 4)
);

CREATE UNIQUE INDEX IF NOT EXISTS basic_trim_cost_component_master_id_component_key
  ON basic_trim_cost_component (master_id, component);

CREATE INDEX IF NOT EXISTS basic_trim_cost_component_master_id_idx
  ON basic_trim_cost_component (master_id);
