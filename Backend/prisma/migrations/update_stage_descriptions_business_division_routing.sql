-- Expense Data workflow, phase 6 follow-up: stage descriptions were written
-- when CATEGORY_HEAD was role-only and MDM meant "any Admin". Both are now
-- routed by Business Division (see expenseAccessService.ts,
-- canActOnExpenseRequestStage) — update the copy to match.
--
-- Purely a content update, only where still at the OLD text (never
-- clobbers an admin's own edit). Re-runnable.

UPDATE "expense_approval_stages"
SET "description" = 'First sign-off. Held by the Category Head whose own Business Division matches the requester''s — a Mens request only reaches the Mens Category Head, never another division''s. Nothing is applied at this point, and they may adjust the proposed values before passing the request on.'
WHERE "key" = 'CATEGORY_HEAD'
  AND "description" = 'First sign-off. Anyone with the Category Head role already holds this — no grant needed. Nothing is applied at this point, and they may adjust the proposed values before passing the request on.';

UPDATE "expense_approval_stages"
SET "description" = 'Final sign-off — applies the change to the master, and so to SAP. Held only by whoever is tagged Business Division MDM, regardless of role — every division''s requests converge here, but Admin alone does not grant this.'
WHERE "key" = 'MDM'
  AND "description" = 'Final sign-off — applies the change to the master, and so to SAP. Anyone with the Admin role already holds this, on every stage, not just this one.';
