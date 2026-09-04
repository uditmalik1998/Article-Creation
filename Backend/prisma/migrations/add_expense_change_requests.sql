-- Expense Data change-request workflow (Creator -> Approver -> Category Head/PD).
-- One row = the complete lifecycle + audit trail of a single field edit.

CREATE TYPE "expense_change_status" AS ENUM ('PENDING_APPROVER', 'PENDING_FINAL', 'APPROVED', 'REJECTED');

CREATE TABLE "expense_change_requests" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "table_key" VARCHAR(50) NOT NULL,
  "row_id" VARCHAR(100) NOT NULL,
  "row_label" VARCHAR(300),
  "changes" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "expense_change_status" NOT NULL DEFAULT 'PENDING_APPROVER',

  "requestedById" INTEGER NOT NULL,
  "requested_by_name" VARCHAR(200) NOT NULL,
  "requested_by_email" VARCHAR(255) NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "approverId" INTEGER,
  "approver_name" VARCHAR(200),
  "approver_email" VARCHAR(255),
  "approver_at" TIMESTAMP(3),
  "approver_comment" TEXT,
  "approver_action" VARCHAR(20),

  "finalById" INTEGER,
  "final_by_name" VARCHAR(200),
  "final_by_email" VARCHAR(255),
  "final_at" TIMESTAMP(3),
  "final_comment" TEXT,
  "final_action" VARCHAR(20),

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "expense_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_change_requests_table_key_row_id_idx" ON "expense_change_requests"("table_key", "row_id");
CREATE INDEX "expense_change_requests_status_idx" ON "expense_change_requests"("status");
CREATE INDEX "expense_change_requests_requestedById_idx" ON "expense_change_requests"("requestedById");
