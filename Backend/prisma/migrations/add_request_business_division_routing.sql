-- Expense Data workflow, phase 6: route the CATEGORY_HEAD stage by business
-- division instead of "any Category Head can act on any request", and make
-- the MDM (final) stage a business-division tag rather than an ADMIN-role
-- bypass — see Backend/src/services/expenseAccessService.ts,
-- canActOnExpenseRequestStage.
--
-- Adds `requester_business_division` to expense_change_requests, captured
-- once at creation from the requester's own User.businessDivision and never
-- changed afterward. No backfill: existing requests predate this routing
-- concept and will simply have it NULL (unreachable by the automatic
-- division match — an admin-managed grant, or manual attention, covers
-- that handful of rows rather than guessing a division for them).
--
-- Safe to re-run: every statement is guarded.

ALTER TABLE "expense_change_requests" ADD COLUMN IF NOT EXISTS "requester_business_division" VARCHAR(20);
CREATE INDEX IF NOT EXISTS "expense_change_requests_requester_business_division_idx" ON "expense_change_requests"("requester_business_division");
