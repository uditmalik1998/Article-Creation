-- Master table for rough CMP cost by division / sub-division / major category.
-- Source: "SAM MASTER.xlsx" workbook, Sheet5 ("Average of TOTAL CMP COST" pivot:
-- DIV, SUB_DIV, MAJ_CAT, Total), loaded via the Admin -> Expenses "CMP Cost Master"
-- upload (adminController.uploadCmpCostMaster). Already live in production under
-- Prisma model RoughCmpCostMaster — this migration only documents/recreates it,
-- so a fresh database ends up with the same shape. Idempotent — safe to run more
-- than once.
--
-- Consumed by ApproverController.getRoughCmpCost / lookupBasicTrimCosts-style
-- major-category lookups to auto-fill body_article_data.cmp_cost on the New
-- Article (pending) page when an article has no CMP cost of its own yet.

CREATE TABLE IF NOT EXISTS rough_cmp_cost_master (
  id         SERIAL PRIMARY KEY,
  div        VARCHAR(50),
  sub_div    VARCHAR(50),
  maj_cat    VARCHAR(100) NOT NULL,
  cmp_cost   DECIMAL(10, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS rough_cmp_cost_master_uniq
  ON rough_cmp_cost_master (div, sub_div, maj_cat);

CREATE INDEX IF NOT EXISTS rough_cmp_cost_master_maj_cat_idx
  ON rough_cmp_cost_master (maj_cat);
