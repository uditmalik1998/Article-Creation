-- Expense Data workflow, phase 3: make the approval chain's LENGTH editable.
--
-- Until now the chain was hardcoded at exactly two stages (Category Head then
-- MDM), baked into the `expense_change_status` enum (PENDING_APPROVER /
-- PENDING_FINAL) and a fixed pair of approver_*/final_* columns. This
-- replaces that with:
--   - expense_approval_stages: an admin-managed ordered list of stages
--     (seeded here with the existing two, so today's behaviour is unchanged)
--   - expense_change_requests.current_stage_key: which stage a request is
--     waiting on, replacing the two-value enum distinction
--   - expense_change_requests.approval_trail: a JSON log of every stage
--     action, replacing the fixed approver_*/final_* column pair so it scales
--     to any chain length
--   - expense_access_grants.level: enum -> free text, so a grant can
--     reference a stage the moment an admin creates it, no migration needed
--
-- Existing rows are carried forward: PENDING_APPROVER -> PENDING at
-- CATEGORY_HEAD, PENDING_FINAL -> PENDING at MDM, APPROVED/REJECTED lose
-- their now-terminal stage. Old approver_*/final_* data (none exists yet in
-- this environment) would need a manual backfill into approval_trail before
-- the DROP COLUMN below on any environment that already has real rows there.

-- ── 1. expense_approval_stages ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "expense_approval_stages" (
  "id"              SERIAL NOT NULL,
  "key"             VARCHAR(50) NOT NULL,
  "label"           VARCHAR(100) NOT NULL,
  "description"     TEXT,
  "sort_order"      INTEGER NOT NULL,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_by_id"   INTEGER,
  "created_by_name" VARCHAR(200),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expense_approval_stages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "expense_approval_stages_key_key" ON "expense_approval_stages"("key");
CREATE INDEX IF NOT EXISTS "expense_approval_stages_is_active_sort_order_idx" ON "expense_approval_stages"("is_active", "sort_order");

-- Seed the chain that was previously hardcoded, so nothing changes behaviourally
-- until an admin adds/reorders stages.
INSERT INTO "expense_approval_stages" ("key", "label", "description", "sort_order")
VALUES
  ('CATEGORY_HEAD', 'Category Head', 'First sign-off (stage 1). Nothing is applied at this point.', 10),
  ('MDM', 'MDM', 'Final sign-off — this is what actually applies the change to the master, and so to SAP.', 20)
ON CONFLICT ("key") DO NOTHING;

-- ── 2. expense_change_requests: add the new stage-tracking columns ──────────
ALTER TABLE "expense_change_requests"
  ADD COLUMN IF NOT EXISTS "current_stage_key" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "approval_trail" JSONB NOT NULL DEFAULT '[]';

-- Backfill current_stage_key for any row still mid-chain under the old
-- two-value status, and build an approval_trail entry from the old approver_*
-- columns if that stage had already been acted on (defensive — no such rows
-- exist as of this migration, but a re-run after partial data must not lose it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expense_change_requests' AND column_name = 'approver_action'
  ) THEN
    UPDATE "expense_change_requests"
    SET "current_stage_key" = 'CATEGORY_HEAD'
    WHERE "status"::text = 'PENDING_APPROVER' AND "current_stage_key" IS NULL;

    UPDATE "expense_change_requests"
    SET "current_stage_key" = 'MDM'
    WHERE "status"::text = 'PENDING_FINAL' AND "current_stage_key" IS NULL;

    UPDATE "expense_change_requests"
    SET "approval_trail" = "approval_trail" || jsonb_build_array(jsonb_build_object(
      'stageKey', 'CATEGORY_HEAD',
      'stageLabel', 'Category Head',
      'action', "approver_action",
      'byId', "approverId",
      'byName', "approver_name",
      'byEmail', "approver_email",
      'at', to_char("approver_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'comment', "approver_comment"
    ))
    WHERE "approver_action" IS NOT NULL;

    UPDATE "expense_change_requests"
    SET "approval_trail" = "approval_trail" || jsonb_build_array(jsonb_build_object(
      'stageKey', 'MDM',
      'stageLabel', 'MDM',
      'action', "final_action",
      'byId', "finalById",
      'byName', "final_by_name",
      'byEmail', "final_by_email",
      'at', to_char("final_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'comment', "final_comment"
    ))
    WHERE "final_action" IS NOT NULL;
  END IF;
END $$;

-- ── 3. expense_change_requests.status: collapse the two-stage enum ──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_change_status'
             AND 'PENDING_APPROVER' = ANY(enum_range(NULL::expense_change_status)::text[])) THEN
    ALTER TYPE "expense_change_status" RENAME TO "expense_change_status_old";
    CREATE TYPE "expense_change_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

    ALTER TABLE "expense_change_requests" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "expense_change_requests"
      ALTER COLUMN "status" TYPE "expense_change_status" USING (
        CASE "status"::text
          WHEN 'PENDING_APPROVER' THEN 'PENDING'
          WHEN 'PENDING_FINAL' THEN 'PENDING'
          ELSE "status"::text
        END
      )::"expense_change_status";
    ALTER TABLE "expense_change_requests" ALTER COLUMN "status" SET DEFAULT 'PENDING';

    DROP TYPE "expense_change_status_old";
  END IF;
END $$;

-- ── 4. expense_change_requests: drop the fixed approver_*/final_* columns ───
-- (superseded by approval_trail, backfilled above)
ALTER TABLE "expense_change_requests"
  DROP COLUMN IF EXISTS "approverId",
  DROP COLUMN IF EXISTS "approver_name",
  DROP COLUMN IF EXISTS "approver_email",
  DROP COLUMN IF EXISTS "approver_at",
  DROP COLUMN IF EXISTS "approver_comment",
  DROP COLUMN IF EXISTS "approver_action",
  DROP COLUMN IF EXISTS "finalById",
  DROP COLUMN IF EXISTS "final_by_name",
  DROP COLUMN IF EXISTS "final_by_email",
  DROP COLUMN IF EXISTS "final_at",
  DROP COLUMN IF EXISTS "final_comment",
  DROP COLUMN IF EXISTS "final_action";

CREATE INDEX IF NOT EXISTS "expense_change_requests_current_stage_key_idx" ON "expense_change_requests"("current_stage_key");

-- ── 5. expense_access_grants.level: enum -> free text ────────────────────────
-- Holds either the constant "SUB_DIVISION" or an expense_approval_stages.key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'expense_access_grants' AND column_name = 'level' AND udt_name = 'expense_access_level') THEN
    ALTER TABLE "expense_access_grants" ALTER COLUMN "level" TYPE VARCHAR(50) USING "level"::text;
  END IF;
END $$;

DROP TYPE IF EXISTS "expense_access_level";
