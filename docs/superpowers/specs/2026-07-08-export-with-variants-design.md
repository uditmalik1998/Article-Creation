# Export with Variants — Created Articles

**Date:** 2026-07-08
**Status:** Approved design — ready for implementation
**Page:** Approver → Created Articles (`Frontend/src/features/approver/pages/ApproverDashboard.tsx`)

## 1. Goal

Add a second export button, **"Export + Variants"**, to the Created Articles page.
The existing "Export (N)" button exports **generic** articles only (backend
`exportAll` hard-filters `isGeneric: true`). The new button exports each generic
**followed immediately by its variant articles**, in one continuous series, as a
single Excel sheet.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| New button | Separate "Export + Variants" button beside the existing Export |
| Row layout | Generic row → its variants in series → next generic (continuous) |
| Distinguishing columns | **4 new columns**, inserted right after `Article Number`: `Row Type` (Generic/Variant), `Parent Article No`, `Variant Size`, `Variant Colour` |
| Which variants | **Only SAP-created** = variants whose own article number is non-empty |
| Variant order within a generic | colour, then size |
| Scope/filters | Identical to the current Export (respects Division / Sub-Div / Major Category / Source / SAP Sync / date / search / pathType) |
| Excel tech | Reuse existing `exportToExcel` (ExcelJS); no new library |

## 3. Current state (verified)

- Button "Export (N)" → `handleExportAll` (`ApproverDashboard.tsx:313`) →
  `GET /approver/items/export-all` → `exportToExcel(...)`.
- `ApproverController.exportAll` (`Backend/src/controllers/ApproverController.ts:985`)
  builds a `where` from query params (RBAC, division/subDiv/majorCategory, pathType,
  status, date, search), then forces `where.isGeneric = true`, `imageUrl != ''`, an
  SRM gate, and selects ~65 fields (lines 1123–1223).
- Variants live in the **same** `ExtractionResultFlat` table: `isGeneric=false`,
  `genericArticleId` = parent generic `id`, plus `variantSize`/`variantColor`; a
  SAP-created variant carries its own `articleNumber`/`sapArticleId`.
- Existing variant fetch: `getVariants` (`ApproverController.ts:2385`) —
  `where: { genericArticleId, isGeneric:false }, orderBy:[variantColor, variantSize]`.
- Frontend row→export-object mapping: `buildApproverExportData`
  (`ApproverDashboard.tsx:~250-303`); headers: `SIMPLE_APPROVER_EXPORT_HEADERS`
  (line 54) + approver columns for the created tab (`exportHeaders`, line 306).

## 4. Backend

### 4.1 Refactor (no behavior change)
Extract the `where`-building block of `exportAll` (everything from reading
`req.query` through the `isGeneric=true` / `imageUrl` / SRM-gate clauses,
~lines 987–1118) into a private helper:
```
private static buildExportWhere(req: Request): any
```
`exportAll` calls it, then runs its existing `findMany`. This keeps the two export
endpoints filter-identical.

### 4.2 New endpoint
`GET /api/approver/items/export-all-with-variants` →
`ApproverController.exportAllWithVariants`, mounted in `Backend/src/routes/approver.ts`
right after the existing `items/export-all` route (same `h(...)` wrapper, no extra
middleware — matches `exportAll`).

Logic:
1. `const where = ApproverController.buildExportWhere(req);`
2. Fetch generics with the **same `select`** as `exportAll` (must include `id` and
   `articleNumber`), same `orderBy` (created tab → `approvedAt desc nulls last`, else
   `createdAt desc`).
3. `const genericIds = generics.map(g => g.id);`
4. Fetch variants (chunk `genericIds` into batches of 1000 to bound the `in` clause):
   ```
   where: {
     genericArticleId: { in: chunk },
     isGeneric: false,
     articleNumber: { not: null },   // "SAP-created": has its own article number
     NOT: { articleNumber: '' },
   }
   select: <same fields as generics> + variantSize + variantColor + sapArticleId + genericArticleId
   orderBy: [{ variantColor: 'asc' }, { variantSize: 'asc' }]
   ```
5. Group variants by `genericArticleId` (Map).
6. Build the interleaved output array, preserving generic order:
   for each generic → push `{ ...generic, _rowType: 'Generic', _parentArticleNumber: '' }`,
   then for each of its variants → push
   `{ ...variant, _rowType: 'Variant', _parentArticleNumber: generic.articleNumber }`.
7. `return res.json({ data: rows, meta: { total: rows.length } });`
   Respect the existing `if (res.headersSent) return;` timeout guard used by `exportAll`.

Scale note: 10.8k generics + variants → tens of thousands of rows. The narrow
`select` (already used by `exportAll`) keeps this within heap, as documented at
`ApproverController.ts:1120-1122`.

## 5. Frontend (`ApproverDashboard.tsx`)

1. **Headers:** derive `exportHeadersWithVariants` from `exportHeaders` by inserting
   `'Row Type', 'Parent Article No', 'Variant Size', 'Variant Colour'` immediately
   after `'Article Number'`.
2. **`handleExportAllWithVariants`** — clone of `handleExportAll` except:
   - hits `/approver/items/export-all-with-variants`,
   - maps rows with the base `buildApproverExportData`, then augments each object with
     the 4 new keys from the corresponding raw row
     (`Row Type` ← `_rowType`, `Parent Article No` ← `_parentArticleNumber`,
     `Variant Size` ← `variantSize`, `Variant Colour` ← `variantColor`),
   - passes `exportHeadersWithVariants`,
   - filename suffix ` - with Variants`,
   - uses its own busy flag `exportingAllWithVariants`.
   Variant rows already carry their own `articleNumber` → the existing
   `'Article Number'` mapping shows the variant article number automatically.
3. **Button:** add a Button beside the existing Export (line ~493), label
   **"Export + Variants"**, `disabled={exportingAllWithVariants}`, `onClick={handleExportAllWithVariants}`.

## 6. Error handling
Mirror `handleExportAll`: loading toast, `try/catch` with an error toast, `finally`
clears the busy flag. Empty result → "No records found" warning. Backend errors → 500
handled by the existing `h(...)` wrapper.

## 7. Verification
- Backend: a small `ts-node` script (or `execute_sql`) confirming, for a sample
  generic, that only variants with a non-empty article number are returned and that
  interleave order is generic-then-variants.
- Frontend: `tsc` clean; manual export of a filtered Created page → open the .xlsx and
  confirm generic rows are each followed by their SAP-created variants with the 4 new
  columns populated.

## 8. Out of scope
- "Export Selected + variants" (this adds only the all/filtered button).
- Changing the existing generics-only export or its columns.
