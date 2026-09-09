-- Expense Data workflow, phase 4: CATEGORY_HEAD and MDM become role-bound
-- (CATEGORY_HEAD role, ADMIN role respectively — see
-- Backend/src/services/expenseAccessService.ts, ROLE_BASED_APPROVAL_STAGES).
--
-- Purely a content update — only touches the two seeded stages' descriptions,
-- and only if still at their original seed text, so it never clobbers an
-- admin's own edit. Re-runnable.

UPDATE "expense_approval_stages"
SET "description" = 'First sign-off. Anyone with the Category Head role already holds this — no grant needed. Nothing is applied at this point, and they may adjust the proposed values before passing the request on.'
WHERE "key" = 'CATEGORY_HEAD'
  AND ("description" IS NULL OR "description" = 'First sign-off (stage 1). Nothing is applied at this point.');

UPDATE "expense_approval_stages"
SET "description" = 'Final sign-off — applies the change to the master, and so to SAP. Anyone with the Admin role already holds this, on every stage, not just this one.'
WHERE "key" = 'MDM'
  AND ("description" IS NULL OR "description" = 'Final sign-off — this is what actually applies the change to the master, and so to SAP.');
