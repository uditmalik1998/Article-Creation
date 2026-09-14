-- New approval-chain role, not yet assigned to any real user.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'PLANNING';

-- Scope expense_approval_stages per table. '*' is the shared default chain
-- every table walks unless it has rows of its own (see ALL_TABLES in
-- expenseAccessService.ts, the same sentinel expense_access_grants uses).
ALTER TABLE "expense_approval_stages" ADD COLUMN IF NOT EXISTS "table_key" VARCHAR(50) NOT NULL DEFAULT '*';

-- Replace the old key-only uniqueness with (table_key, key) — the same key
-- (e.g. 'CATEGORY_HEAD') can now appear once per table's own chain, plus
-- once in the shared '*' default.
DROP INDEX IF EXISTS "expense_approval_stages_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "expense_approval_stages_table_key_key_key"
  ON "expense_approval_stages" ("table_key", "key");

-- Segment Master and Size Master each get their own dedicated 3-stage
-- chain (Category Head -> Planning -> MDM); every other table keeps
-- falling through to the '*' default (Category Head -> MDM) untouched.
INSERT INTO "expense_approval_stages" ("table_key", "key", "label", "description", "sort_order", "is_active")
VALUES
  ('segment-master', 'CATEGORY_HEAD', 'Category Head',
   'First sign-off. Held by the Category Head whose own Business Division matches the requester''s — a Mens request only reaches the Mens Category Head, never another division''s. Nothing is applied at this point, and they may adjust the proposed values before passing the request on.',
   10, true),
  ('segment-master', 'PLANNING', 'Planning',
   'Second sign-off, after Category Head — held by whoever has the Planning role, company-wide rather than scoped to one Business Division. Nothing is applied at this point.',
   20, true),
  ('segment-master', 'MDM', 'MDM',
   'Final sign-off — applies the change to the master, and so to SAP. Held only by whoever is tagged Business Division MDM, regardless of role — every division''s requests converge here.',
   30, true),
  ('size-master', 'CATEGORY_HEAD', 'Category Head',
   'First sign-off. Held by the Category Head whose own Business Division matches the requester''s — a Mens request only reaches the Mens Category Head, never another division''s. Nothing is applied at this point, and they may adjust the proposed values before passing the request on.',
   10, true),
  ('size-master', 'PLANNING', 'Planning',
   'Second sign-off, after Category Head — held by whoever has the Planning role, company-wide rather than scoped to one Business Division. Nothing is applied at this point.',
   20, true),
  ('size-master', 'MDM', 'MDM',
   'Final sign-off — applies the change to the master, and so to SAP. Held only by whoever is tagged Business Division MDM, regardless of role — every division''s requests converge here.',
   30, true)
ON CONFLICT ("table_key", "key") DO NOTHING;
