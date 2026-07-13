# PD → Pending Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the PD approval stage entirely and migrate the 322 articles currently stuck in the PD queue back to the Pending (New Articles) queue so approvers can process them directly to SAP.

**Architecture:** The PD flow is a two-step approval chain (Approver → PD → SAP). We collapse it into one step (Approver → SAP). This means: (1) resetting 322 DB records, (2) removing PD filter from backend queries, (3) removing the send-to-pd route/method, and (4) removing the PD tab/page/button from the frontend.

**Tech Stack:** Node.js + TypeScript + Prisma (PostgreSQL/Supabase), React + TypeScript (frontend), Express routes.

---

## File Map

| File | Action | What Changes |
|------|--------|-------------|
| `Backend/prisma/schema.prisma` | Keep | No schema change — `pdStatus` column stays (historical data) |
| `Backend/src/controllers/ApproverController.ts` | Modify | Remove `pd` pathType branch (lines 683–688); remove `sendToPd()` method (lines 1785–1839) |
| `Backend/src/routes/approver.ts` | Modify | Remove `POST /api/approver/send-to-pd` route (line 51) |
| `Frontend/src/AppModern.tsx` | Modify | Remove `PdRoute` guard (lines 91–102), remove `/approver/pd` routes (lines 419–437) |
| `Frontend/src/features/approver/pages/ApproverDashboard.tsx` | Modify | Remove "PD Approval" tab from tabs array |
| `Frontend/src/features/approver/components/ApproverArticleList.tsx` | Modify | Remove `pathType="pd"` handling |
| `Frontend/src/features/approver/components/VariantSubTable.tsx` | Modify | Remove `pathType="pd"` handling |

---

## Task 1: DB Migration — Reset 322 PD Articles to Pending

**Files:**
- Create: `Backend/prisma/migrations/20260629_reset_pd_to_pending/migration.sql`

**Context:** Articles with `pd_status = 'COMPLETED'` and `approval_status = 'PENDING'` are stuck in the PD queue. We reset them to `pd_status = 'PENDING'` so they appear in the New Articles / Pending queue.

- [ ] **Step 1: Write the migration SQL**

Create file `Backend/prisma/migrations/20260629_reset_pd_to_pending/migration.sql`:

```sql
-- Reset all PD-queued articles back to Pending
-- These are articles the approver sent to PD but PD never approved.
-- With PD flow removed, they should be visible in the New Articles queue.
UPDATE public.extraction_results_flat
SET pd_status = 'PENDING'
WHERE pd_status = 'COMPLETED'
  AND approval_status = 'PENDING';
```

- [ ] **Step 2: Verify count before running**

Run in Supabase SQL editor or psql:
```sql
SELECT COUNT(*) 
FROM public.extraction_results_flat
WHERE pd_status = 'COMPLETED' AND approval_status = 'PENDING';
-- Expected: ~322 rows
```

- [ ] **Step 3: Run the migration**

```sql
UPDATE public.extraction_results_flat
SET pd_status = 'PENDING'
WHERE pd_status = 'COMPLETED'
  AND approval_status = 'PENDING';
-- Expected: UPDATE 322
```

- [ ] **Step 4: Verify after migration**

```sql
SELECT COUNT(*) 
FROM public.extraction_results_flat
WHERE pd_status = 'COMPLETED' AND approval_status = 'PENDING';
-- Expected: 0

SELECT COUNT(*) 
FROM public.extraction_results_flat
WHERE pd_status = 'PENDING' AND approval_status = 'PENDING';
-- Should be 322 more than before
```

- [ ] **Step 5: Commit**

```bash
git add Backend/prisma/migrations/20260629_reset_pd_to_pending/migration.sql
git commit -m "migration: reset PD-queued articles back to PENDING — 322 records"
```

---

## Task 2: Backend — Remove PD PathType from getItems()

**Files:**
- Modify: `Backend/src/controllers/ApproverController.ts` (lines ~683–695)

**Context:** The `getItems()` method has a branch for `pathType === 'pd'` that filters `pdStatus=COMPLETED`. Remove this branch. Also remove the `pdStatus=PENDING` filter from the `new` branch so the New Articles queue shows ALL `approvalStatus=PENDING` articles regardless of `pdStatus`.

- [ ] **Step 1: Open the file and find the pathType branches**

File: `Backend/src/controllers/ApproverController.ts`

Find the block that looks like:
```typescript
} else if (pathType === 'new') {
    where.approvalStatus = ApprovalStatus.PENDING;
    where.pdStatus = PdStatus.PENDING;  // <-- REMOVE THIS LINE
    where.isOldArticle = false;
} else if (pathType === 'pd') {       // <-- REMOVE THIS ENTIRE BLOCK
    where.approvalStatus = ApprovalStatus.PENDING;
    where.pdStatus = PdStatus.COMPLETED;
    where.isOldArticle = false;
}
```

- [ ] **Step 2: Apply the change**

Remove `where.pdStatus = PdStatus.PENDING` from the `new` branch, and delete the entire `pd` branch:

```typescript
} else if (pathType === 'new') {
    where.approvalStatus = ApprovalStatus.PENDING;
    where.isOldArticle = false;
}
```

- [ ] **Step 3: Check if PdStatus import becomes unused**

Search for any remaining uses of `PdStatus` in `ApproverController.ts`. If `sendToPd()` is still there (Task 3 not done yet), `PdStatus` is still needed. Leave the import for now.

- [ ] **Step 4: Restart backend and test the New Articles endpoint**

```bash
# In Backend directory
npm run dev
```

Then call:
```
GET /api/approver/items?pathType=new
```
Expected: Returns articles that were previously in PD queue (now with pdStatus=PENDING after Task 1).

- [ ] **Step 5: Commit**

```bash
git add Backend/src/controllers/ApproverController.ts
git commit -m "feat: remove PD pathType filter — new articles queue shows all pending"
```

---

## Task 3: Backend — Remove sendToPd() Method and Route

**Files:**
- Modify: `Backend/src/controllers/ApproverController.ts` (lines ~1785–1839)
- Modify: `Backend/src/routes/approver.ts` (line ~51)

**Context:** The `sendToPd()` method sets `pdStatus=COMPLETED` and was called by "Save & Submit". With PD flow removed, this method and its route are dead code.

- [ ] **Step 1: Remove the route from approver.ts**

In `Backend/src/routes/approver.ts`, remove:
```typescript
router.post('/send-to-pd', requireApprovalRights, approverController.sendToPd);
```

- [ ] **Step 2: Remove the sendToPd() method from ApproverController.ts**

Delete the entire `sendToPd()` method (lines ~1785–1839). The method signature looks like:
```typescript
sendToPd = async (req: Request, res: Response): Promise<void> => {
  // ... entire method body
};
```

Delete from the opening `sendToPd =` line through its closing `};`.

- [ ] **Step 3: Remove PdStatus import if now unused**

Check remaining uses of `PdStatus` in `ApproverController.ts`. If no references remain:
```typescript
// Remove PdStatus from the Prisma import line, e.g.:
import { ..., PdStatus, ... } from '../generated/prisma';
// becomes:
import { ... } from '../generated/prisma';  // PdStatus removed
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd Backend
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add Backend/src/controllers/ApproverController.ts Backend/src/routes/approver.ts
git commit -m "feat: remove sendToPd endpoint — PD approval flow eliminated"
```

---

## Task 4: Frontend — Remove PD Route and PdRoute Guard

**Files:**
- Modify: `Frontend/src/AppModern.tsx` (lines ~91–102, ~419–437)

**Context:** `/approver/pd` and `/approver/pd/:id` routes are guarded by `PdRoute` which only allows ADMIN and PD roles. Both the routes and the guard must be removed.

- [ ] **Step 1: Remove PdRoute component (lines ~91–102)**

In `Frontend/src/AppModern.tsx`, find and delete the `PdRoute` component:
```typescript
const PdRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'PD')) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};
```

- [ ] **Step 2: Remove PD routes (lines ~419–437)**

Find and delete:
```typescript
<Route path="/approver/pd" element={
  <PdRoute>
    <ApproverDashboard pathType="pd" />
  </PdRoute>
} />
<Route path="/approver/pd/:id" element={
  <PdRoute>
    <ArticleDetailPage pathType="pd" />
  </PdRoute>
} />
```

- [ ] **Step 3: Verify no compile errors**

```bash
cd Frontend
npm run build 2>&1 | head -30
```
Expected: No TypeScript errors related to PdRoute or pd routes.

- [ ] **Step 4: Commit**

```bash
git add Frontend/src/AppModern.tsx
git commit -m "feat: remove PD route and PdRoute guard from app router"
```

---

## Task 5: Frontend — Remove PD Tab from ApproverDashboard

**Files:**
- Modify: `Frontend/src/features/approver/pages/ApproverDashboard.tsx`

**Context:** The dashboard has a "PD Approval" tab (pathType="pd"). Remove this tab. Also remove any "Save & Submit" / "Send to PD" button that called the `/api/approver/send-to-pd` endpoint.

- [ ] **Step 1: Find and remove the PD tab entry**

In `ApproverDashboard.tsx`, find the tabs array (looks like):
```typescript
const tabs = [
  { label: 'New Articles', pathType: 'new' },
  { label: 'Old Articles', pathType: 'old' },
  { label: 'PD Approval', pathType: 'pd' },   // <-- REMOVE THIS
  { label: 'Rejected', pathType: 'rejected' },
  { label: 'Created', pathType: 'created' },
  { label: 'Failed', pathType: 'failed' },
];
```

Remove the `{ label: 'PD Approval', pathType: 'pd' }` entry.

- [ ] **Step 2: Find and remove the "Send to PD" / "Save & Submit" button**

Search for any button that calls `send-to-pd`:
```bash
grep -n "send-to-pd\|sendToPd\|Send to PD\|Save.*Submit\|Submit.*PD" \
  Frontend/src/features/approver/pages/ApproverDashboard.tsx
```

Remove the button and its click handler / API call entirely.

- [ ] **Step 3: Remove any pd-specific conditional logic**

Search for `pathType === 'pd'` in `ApproverDashboard.tsx` and remove those branches:
```bash
grep -n "pathType.*pd\|pd.*pathType" \
  Frontend/src/features/approver/pages/ApproverDashboard.tsx
```

- [ ] **Step 4: Verify no compile errors**

```bash
cd Frontend
npm run build 2>&1 | head -30
```
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add Frontend/src/features/approver/pages/ApproverDashboard.tsx
git commit -m "feat: remove PD Approval tab and Send to PD button from dashboard"
```

---

## Task 6: Frontend — Remove PD pathType Handling from Child Components

**Files:**
- Modify: `Frontend/src/features/approver/components/ApproverArticleList.tsx`
- Modify: `Frontend/src/features/approver/components/VariantSubTable.tsx`

**Context:** These components have conditional logic for `pathType === 'pd'`. With PD removed, clean up dead branches.

- [ ] **Step 1: Clean ApproverArticleList.tsx**

Search for pd references:
```bash
grep -n "pd" Frontend/src/features/approver/components/ApproverArticleList.tsx
```

Remove all `pathType === 'pd'` conditional branches. If the component receives `pathType` as a prop, ensure the type definition no longer includes `'pd'`:
```typescript
// Change from:
pathType: 'new' | 'old' | 'pd' | 'rejected' | 'created' | 'failed'
// To:
pathType: 'new' | 'old' | 'rejected' | 'created' | 'failed'
```

- [ ] **Step 2: Clean VariantSubTable.tsx**

```bash
grep -n "pd" Frontend/src/features/approver/components/VariantSubTable.tsx
```

Remove all `pathType === 'pd'` conditional branches and update the `pathType` prop type.

- [ ] **Step 3: Clean ArticleDetailPage.tsx**

```bash
grep -n "pd" Frontend/src/features/approver/pages/ArticleDetailPage.tsx
```

Remove `pathType="pd"` handling and update prop types.

- [ ] **Step 4: Final build verification**

```bash
cd Frontend
npm run build
```
Expected: Zero TypeScript errors, zero warnings about `pd`.

- [ ] **Step 5: Commit**

```bash
git add Frontend/src/features/approver/components/ApproverArticleList.tsx \
        Frontend/src/features/approver/components/VariantSubTable.tsx \
        Frontend/src/features/approver/pages/ArticleDetailPage.tsx
git commit -m "feat: remove PD pathType from article list and variant components"
```

---

## Task 7: Smoke Test & Verification

- [ ] **Step 1: Start both servers**

```bash
# Terminal 1
cd Backend && npm run dev

# Terminal 2
cd Frontend && npm run dev
```

- [ ] **Step 2: Verify 322 articles appear in New Articles tab**

1. Log in as an Approver
2. Navigate to `/approver`
3. Open "New Articles" tab
4. Confirm the count includes the previously-PD articles (should see ~322 more than before)

- [ ] **Step 3: Verify PD page is gone**

1. Navigate to `/approver/pd`
2. Expected: Redirected to `/dashboard` (or 404)
3. Confirm no "PD Approval" tab appears in the nav

- [ ] **Step 4: Verify Send to PD button is gone**

1. Open any article in New Articles
2. Confirm there is NO "Save & Submit" / "Send to PD" button
3. The approval flow should go directly to "Approve" → SAP

- [ ] **Step 5: Verify PD role users**

1. Log in as a PD role user
2. Expected: No access to approval tabs (redirect to dashboard)
3. PD_DESIGNER role: Model generation still works

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: PD flow removal complete — smoke test passed"
```

---

## Summary Roadmap

```
Task 1 → DB Migration (reset 322 records)          [~5 min]
Task 2 → Backend: remove PD query filter            [~10 min]
Task 3 → Backend: remove sendToPd route/method      [~10 min]
Task 4 → Frontend: remove PD route + PdRoute guard  [~10 min]
Task 5 → Frontend: remove PD tab + Send to PD btn   [~15 min]
Task 6 → Frontend: clean child components           [~10 min]
Task 7 → Smoke test                                 [~10 min]
                                            Total: ~70 min
```

**Risk:** Tasks 1 and 2 must be done together — if Task 2 is done before Task 1, the 322 articles will still not appear in New Articles (they'd be invisible with pdStatus=COMPLETED filtered out). Always run the DB migration first.
