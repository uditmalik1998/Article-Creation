-- Expense Data workflow, phase 5: a durable, queryable audit log of the
-- WHOLE lifecycle (raised, each stage's action, and the final apply or
-- failure) — not just the moment data changes. See ExpenseAuditLog's doc
-- comment in schema.prisma for what each event type means.
--
-- Safe to re-run: every statement is guarded.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_audit_event_type') THEN
    CREATE TYPE "expense_audit_event_type" AS ENUM (
      'REQUESTED', 'STAGE_APPROVED', 'STAGE_REJECTED', 'APPLIED', 'APPLY_FAILED', 'AUTO_REJECTED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "expense_audit_log" (
  "id"          SERIAL NOT NULL,
  "request_id"  VARCHAR(36) NOT NULL,
  "table_key"   VARCHAR(50) NOT NULL,
  "row_id"      VARCHAR(100),
  "operation"   "expense_change_operation" NOT NULL,
  "event_type"  "expense_audit_event_type" NOT NULL,
  "stage_key"   VARCHAR(50),
  "stage_label" VARCHAR(100),
  "actor_id"    INTEGER,
  "actor_name"  VARCHAR(200),
  "actor_email" VARCHAR(255),
  "comment"     TEXT,
  "details"     JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expense_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "expense_audit_log_request_id_idx"  ON "expense_audit_log"("request_id");
CREATE INDEX IF NOT EXISTS "expense_audit_log_table_key_row_id_idx" ON "expense_audit_log"("table_key", "row_id");
CREATE INDEX IF NOT EXISTS "expense_audit_log_event_type_idx" ON "expense_audit_log"("event_type");
CREATE INDEX IF NOT EXISTS "expense_audit_log_occurred_at_idx" ON "expense_audit_log"("occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "expense_audit_log_actor_email_idx" ON "expense_audit_log"("actor_email");
