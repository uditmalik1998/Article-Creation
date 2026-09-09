-- Expense Data workflow, phase 2:
--   1. add/delete requests (not just field edits) + a requester "wanted by" date
--   2. per-email access control, so approval rights land on specific people
--      (sub-division editors / category heads / MDM) rather than whole roles
--
-- Safe to re-run: every statement is guarded.

-- ── 1. add / delete operations ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_change_operation') THEN
    CREATE TYPE "expense_change_operation" AS ENUM ('UPDATE', 'CREATE', 'DELETE');
  END IF;
END $$;

ALTER TABLE "expense_change_requests"
  ADD COLUMN IF NOT EXISTS "operation" "expense_change_operation" NOT NULL DEFAULT 'UPDATE',
  ADD COLUMN IF NOT EXISTS "applied_row_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(3);

-- CREATE requests have no row yet, so row_id must be nullable.
ALTER TABLE "expense_change_requests" ALTER COLUMN "row_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "expense_change_requests_due_date_idx"
  ON "expense_change_requests"("due_date");

-- ── 2. per-email access control ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_access_level') THEN
    CREATE TYPE "expense_access_level" AS ENUM ('SUB_DIVISION', 'CATEGORY_HEAD', 'MDM');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "expense_access_grants" (
  "id"              SERIAL NOT NULL,
  "email"           VARCHAR(255) NOT NULL,
  "level"           "expense_access_level" NOT NULL,
  -- '*' = every expense table, otherwise one EXPENSE_TABLE_REGISTRY key
  "table_key"       VARCHAR(50) NOT NULL DEFAULT '*',
  "sub_division"    VARCHAR(100),
  "can_create"      BOOLEAN NOT NULL DEFAULT true,
  "can_update"      BOOLEAN NOT NULL DEFAULT true,
  "can_delete"      BOOLEAN NOT NULL DEFAULT true,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "note"            TEXT,
  "granted_by_id"   INTEGER,
  "granted_by_name" VARCHAR(200),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expense_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "expense_access_grants_email_level_table_key_key"
  ON "expense_access_grants"("email", "level", "table_key");
CREATE INDEX IF NOT EXISTS "expense_access_grants_email_idx"
  ON "expense_access_grants"("email");
CREATE INDEX IF NOT EXISTS "expense_access_grants_is_active_idx"
  ON "expense_access_grants"("is_active");
