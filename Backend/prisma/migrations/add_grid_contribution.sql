-- Major Category Grid: contribution % (Bgt Cont% / Pd Cont% / Auto Cont%).
--
-- Each maj_cat_grid_values row (one attribute VALUE of one major category,
-- e.g. M_TEES_HS -> M_FIT -> REG_FIT) gets three percentages. Within one
-- (major_category, attribute_name) "block" each filled column sums to 100.
--
--   Bgt Cont%  — filled by the BGT creators, approved by each creator's own
--                paired BGT approver, then MDM applies it.
--   Pd Cont%   — same flow, but a completely separate set of PD creators /
--                approvers; the two hierarchies never overlap.
--   Auto Cont% — display only for now (will flow from Snowflake planning).
--
-- Who may fill / approve which column for which division is NOT the user's
-- own business_division (it doesn't match the business sheet) — it's the
-- explicit pairs in grid_contribution_assignments below, one row per line of
-- the "creator and approver" sheet of grid contribution.xlsx.
--
-- Requests ride the existing expense_change_requests workflow with
-- request_kind = BGT_CONT / PD_CONT, one request per block, and walk their
-- own chain 'major-category-grid#contribution' (CONT_APPROVER -> MDM).
--
-- Additive only, safe to re-run.

-- ── 1. the three percentage columns ─────────────────────────────────────────
ALTER TABLE "maj_cat_grid_values"
  ADD COLUMN IF NOT EXISTS "bgt_cont_pct"  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS "pd_cont_pct"   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS "auto_cont_pct" NUMERIC(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maj_cat_grid_values_cont_pct_range') THEN
    ALTER TABLE "maj_cat_grid_values" ADD CONSTRAINT "maj_cat_grid_values_cont_pct_range" CHECK (
      ("bgt_cont_pct"  IS NULL OR "bgt_cont_pct"  BETWEEN 0 AND 100) AND
      ("pd_cont_pct"   IS NULL OR "pd_cont_pct"   BETWEEN 0 AND 100) AND
      ("auto_cont_pct" IS NULL OR "auto_cont_pct" BETWEEN 0 AND 100)
    );
  END IF;
END $$;

-- ── 2. creator -> approver pairs per contribution kind and division ─────────
CREATE TABLE IF NOT EXISTS "grid_contribution_assignments" (
  "id"             SERIAL NOT NULL,
  "kind"           VARCHAR(10)  NOT NULL,   -- 'BGT' | 'PD'
  "division"       VARCHAR(20)  NOT NULL,   -- 'MENS' | 'LADIES' | 'KIDS'
  "creator_email"  VARCHAR(255) NOT NULL,
  "approver_email" VARCHAR(255) NOT NULL,
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "grid_contribution_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grid_contribution_assignments_kind_check" CHECK ("kind" IN ('BGT', 'PD')),
  CONSTRAINT "grid_contribution_assignments_division_check" CHECK ("division" IN ('MENS', 'LADIES', 'KIDS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "grid_contribution_assignments_kind_division_creator_key"
  ON "grid_contribution_assignments" ("kind", "division", "creator_email");
CREATE INDEX IF NOT EXISTS "grid_contribution_assignments_approver_email_idx"
  ON "grid_contribution_assignments" ("approver_email");

-- Seeded from the "creator and approver" sheet of grid contribution.xlsx.
INSERT INTO "grid_contribution_assignments" ("kind", "division", "creator_email", "approver_email") VALUES
  ('BGT', 'MENS',   'manish.singh@v2kart.com',   'anurag.srivastav@v2kart.com'),
  ('BGT', 'LADIES', 'deepansh.pratap@v2kart.com', 'abhishek.khemka@v2kart.com'),
  ('BGT', 'KIDS',   'manu.madhwar@v2kart.com',   'abhishek.khemka@v2kart.com'),
  ('BGT', 'KIDS',   'randhir.singh@v2kart.com',  'abhishek.khemka@v2kart.com'),
  ('BGT', 'KIDS',   'deepak6@v2kart.com',        'abhishek.khemka@v2kart.com'),
  ('BGT', 'KIDS',   'vishal.singh@v2kart.com',   'abhishek.khemka@v2kart.com'),
  ('BGT', 'LADIES', 'pooja.goyal@v2kart.com',    'jaikrishna.choudhary@v2kart.com'),
  ('BGT', 'MENS',   'apsara@v2kart.com',         'anurag.srivastav@v2kart.com'),
  ('BGT', 'KIDS',   'ashish.kumar@v2kart.com',   'abhishek.khemka@v2kart.com'),
  ('PD',  'KIDS',   'varinda.khanna@v2kart.com', 'arun.kapoor@v2kart.com'),
  ('PD',  'MENS',   'ajay.rana@v2kart.com',      'arun.kapoor@v2kart.com'),
  ('PD',  'LADIES', 'nilofer.begum@v2kart.com',  'arun.kapoor@v2kart.com'),
  ('PD',  'MENS',   'shilpi.singh@v2kart.com',   'arun.kapoor@v2kart.com')
ON CONFLICT ("kind", "division", "creator_email") DO NOTHING;

-- ── 3. expense_change_requests: contribution request fields ─────────────────
ALTER TABLE "expense_change_requests"
  -- NULL for ordinary row edits; 'BGT_CONT' / 'PD_CONT' for a contribution block.
  ADD COLUMN IF NOT EXISTS "request_kind" VARCHAR(20),
  -- "<major_category>||<attribute_name>" — the block a contribution request covers.
  ADD COLUMN IF NOT EXISTS "block_key" VARCHAR(300),
  -- The requester's paired approver, captured at creation (routes CONT_APPROVER).
  ADD COLUMN IF NOT EXISTS "routed_approver_email" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "expense_change_requests_request_kind_block_key_status_idx"
  ON "expense_change_requests" ("request_kind", "block_key", "status");
CREATE INDEX IF NOT EXISTS "expense_change_requests_routed_approver_email_idx"
  ON "expense_change_requests" ("routed_approver_email");

-- ── 4. the contribution chain: paired approver, then MDM ────────────────────
INSERT INTO "expense_approval_stages" ("table_key", "key", "label", "description", "sort_order", "is_active")
VALUES
  ('major-category-grid#contribution', 'CONT_APPROVER', 'Contribution Approver',
   'First sign-off on a Bgt Cont% / Pd Cont% block. Held only by the approver paired with the requesting creator in grid_contribution_assignments — BGT and PD have separate pairs. Nothing is applied at this point.',
   10, true),
  ('major-category-grid#contribution', 'MDM', 'MDM',
   'Final sign-off — writes the contribution % to maj_cat_grid_values. Held only by whoever is tagged Business Division MDM.',
   20, true)
ON CONFLICT ("table_key", "key") DO NOTHING;
