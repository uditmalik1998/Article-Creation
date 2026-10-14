# Rough CMP Cost Master Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "CMP Cost Master" card from the Costs accordion to the "Fabric & Body" accordion (renamed "Rough CMP Cost Master"), and update the backend upload/export/template handlers + frontend column config to cover all 12 columns from the new Excel format.

**Architecture:** DB and Prisma schema already have the 8 new SAM/Val columns on `rough_cmp_cost_master` — no migration needed. We update the backend parser to read them, update the export/template to write them, update the EXPENSE_TABLE_REGISTRY and frontend column config, then move the card in Admin.tsx.

**Tech Stack:** TypeScript, Express, ExcelJS, Prisma, React

---

## Files to Touch

| File | Change |
|------|--------|
| `Backend/src/controllers/adminController.ts` | Update `CmpCostRow` type, `buildCmpCostMasterSheet`, `exportCmpCostMaster`, `uploadCmpCostMaster`, `EXPENSE_TABLE_REGISTRY['cmp-cost-master']` |
| `Frontend/src/features/admin/config/expenseTables.ts` | Add 8 new columns to `cmp-cost-master` config |
| `Frontend/src/features/admin/pages/Admin.tsx` | Remove card from Costs group; add card to Fabric & Body group |

---

### Task 1: Update backend `CmpCostRow` type and sheet builder

**Files:**
- Modify: `Backend/src/controllers/adminController.ts` (around lines 5840–5887)

- [ ] **Step 1: Replace `CmpCostRow` type and `CMP_SHEET_NAME` constant**

Find and replace:
```typescript
const CMP_SHEET_NAME = 'CMP COST';

type CmpCostRow = { div: string | null; subDiv: string | null; majCat: string; cmpCost: number | null };
```
With:
```typescript
const CMP_SHEET_NAME = 'CMP COST';

type CmpCostRow = {
  div: string | null;
  subDiv: string | null;
  majCat: string;
  cuttingSam: number | null;
  cuttingVal: number | null;
  stitchingSam: number | null;
  stitchingVal: number | null;
  ironingSam: number | null;
  ironingVal: number | null;
  finishingSam: number | null;
  finishingVal: number | null;
  cmpCost: number | null;
};
```

- [ ] **Step 2: Replace `buildCmpCostMasterSheet` function**

Find the entire `buildCmpCostMasterSheet` function body and replace with:
```typescript
function buildCmpCostMasterSheet(wb: any, rows: CmpCostRow[]): void {
  const ws = wb.addWorksheet(CMP_SHEET_NAME);

  const blue = (cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    cell.alignment = { horizontal: 'center' };
  };

  // Row 1 — title matching the source pivot layout.
  const titleRow = ws.addRow(['Average of TOTAL CMP COST']);
  blue(titleRow.getCell(1));

  // Row 2 — headers.
  const headerRow = ws.addRow([
    'DIV', 'SUB_DIV', 'MAJ_CAT',
    'CUTTING SAM', 'CUTTING VAL',
    'STITCHING SAM', 'STITCHING VAL',
    'IRONING SAM', 'IRONING VAL',
    'FINISHING SAM', 'FINISHING VAL',
    'CMP COST',
  ]);
  headerRow.eachCell((cell: any) => blue(cell));

  // Data rows.
  for (const r of rows) {
    ws.addRow([
      r.div ?? '', r.subDiv ?? '', r.majCat,
      r.cuttingSam ?? '', r.cuttingVal ?? '',
      r.stitchingSam ?? '', r.stitchingVal ?? '',
      r.ironingSam ?? '', r.ironingVal ?? '',
      r.finishingSam ?? '', r.finishingVal ?? '',
      r.cmpCost ?? '',
    ]);
  }

  const noteRowNo = CMP_FIRST_DATA_ROW + rows.length + 1;
  const noteRow = ws.getRow(noteRowNo);
  noteRow.getCell(1).value =
    'MANDATORY: figures are AVERAGE CMP costs by major category — have your costing team verify before relying on these for a specific article.';
  noteRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF9C0006' } };
  noteRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  ws.mergeCells(`A${noteRowNo}:L${noteRowNo}`);
  const note2Row = ws.getRow(noteRowNo + 1);
  note2Row.getCell(1).value =
    'Rows are matched by DIV + SUB_DIV + MAJ_CAT together — the same major category under a different sub-division is a separate row, not a duplicate.';
  note2Row.getCell(1).font = { italic: true, size: 10 };
  ws.mergeCells(`A${noteRowNo + 1}:L${noteRowNo + 1}`);

  ws.columns = [
    { width: 14 }, { width: 16 }, { width: 26 },
    { width: 14 }, { width: 14 },
    { width: 16 }, { width: 14 },
    { width: 14 }, { width: 14 },
    { width: 16 }, { width: 16 },
    { width: 14 },
  ];
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: CMP_HEADER_ROW }];
}
```

- [ ] **Step 3: Update `downloadCmpCostMasterTemplate` example row**

Find:
```typescript
    const example: CmpCostRow = { div: 'KIDS', subDiv: 'IB', majCat: 'IB_BERMUDA', cmpCost: 46.73 };
```
Replace with:
```typescript
    const example: CmpCostRow = {
      div: 'KIDS', subDiv: 'IB', majCat: 'IB_BERMUDA',
      cuttingSam: 2.5, cuttingVal: 3.75,
      stitchingSam: 18.0, stitchingVal: 27.0,
      ironingSam: 1.2, ironingVal: 1.8,
      finishingSam: 0.8, finishingVal: 1.2,
      cmpCost: 46.73,
    };
```

- [ ] **Step 4: Commit**

```bash
git add Backend/src/controllers/adminController.ts
git commit -m "feat: expand CmpCostRow type and sheet builder to 12 columns"
```

---

### Task 2: Update `exportCmpCostMaster` to include new columns

**Files:**
- Modify: `Backend/src/controllers/adminController.ts` (around lines 5940–5960)

- [ ] **Step 1: Replace the rows mapping in `exportCmpCostMaster`**

Find:
```typescript
    const rows: CmpCostRow[] = masters.map((m) => ({
      div: m.div,
      subDiv: m.subDiv,
      majCat: m.majCat,
      cmpCost: m.cmpCost === null ? null : Number(m.cmpCost),
    }));
```
Replace with:
```typescript
    const rows: CmpCostRow[] = masters.map((m) => ({
      div: m.div,
      subDiv: m.subDiv,
      majCat: m.majCat,
      cuttingSam: m.cuttingSam === null ? null : Number(m.cuttingSam),
      cuttingVal: m.cuttingVal === null ? null : Number(m.cuttingVal),
      stitchingSam: m.stitchingSam === null ? null : Number(m.stitchingSam),
      stitchingVal: m.stitchingVal === null ? null : Number(m.stitchingVal),
      ironingSam: m.ironingSam === null ? null : Number(m.ironingSam),
      ironingVal: m.ironingVal === null ? null : Number(m.ironingVal),
      finishingSam: m.finishingSam === null ? null : Number(m.finishingSam),
      finishingVal: m.finishingVal === null ? null : Number(m.finishingVal),
      cmpCost: m.cmpCost === null ? null : Number(m.cmpCost),
    }));
```

- [ ] **Step 2: Commit**

```bash
git add Backend/src/controllers/adminController.ts
git commit -m "feat: export all 12 columns from rough_cmp_cost_master"
```

---

### Task 3: Update `uploadCmpCostMaster` to parse all 12 columns

**Files:**
- Modify: `Backend/src/controllers/adminController.ts` (around lines 6006–6064)

- [ ] **Step 1: Replace column-index detection block**

Find:
```typescript
    let cDiv = 1, cSubDiv = 2, cMajCat = 3, cCost = 4;
    const hdr = ws.getRow(headerRowNo);
    for (let c = 1; c <= 8; c++) {
      const h = cellStr(hdr, c).toUpperCase().replace(/[-_ ]/g, '');
      if (h === 'DIV' || h === 'DIVISION') cDiv = c;
      else if (h.includes('SUBDIV')) cSubDiv = c;
      else if (h.includes('MAJCAT') || h === 'MC') cMajCat = c;
      else if (h === 'TOTAL' || h.includes('CMPCOST') || h === 'CMP') cCost = c;
    }
```
Replace with:
```typescript
    let cDiv = 1, cSubDiv = 2, cMajCat = 3;
    let cCuttingSam = 4, cCuttingVal = 5;
    let cStitchingSam = 6, cStitchingVal = 7;
    let cIroningSam = 8, cIroningVal = 9;
    let cFinishingSam = 10, cFinishingVal = 11;
    let cCost = 12;

    const hdr = ws.getRow(headerRowNo);
    for (let c = 1; c <= 15; c++) {
      const h = cellStr(hdr, c).toUpperCase().replace(/[-_ ]/g, '');
      if (h === 'DIV' || h === 'DIVISION') cDiv = c;
      else if (h.includes('SUBDIV')) cSubDiv = c;
      else if (h.includes('MAJCAT') || h === 'MC') cMajCat = c;
      else if (h === 'CUTTINGSAM') cCuttingSam = c;
      else if (h === 'CUTTINGVAL') cCuttingVal = c;
      else if (h === 'STITCHINGSAM') cStitchingSam = c;
      else if (h === 'STITCHINGVAL') cStitchingVal = c;
      else if (h === 'IRONINGSAM') cIroningSam = c;
      else if (h === 'IRONINGVAL') cIroningVal = c;
      else if (h === 'FINISHINGSAM') cFinishingSam = c;
      else if (h === 'FINISHINGVAL') cFinishingVal = c;
      else if (h === 'TOTAL' || h === 'CMPCOST' || h === 'CMP') cCost = c;
    }
```

- [ ] **Step 2: Replace `rowsByKey` and row parsing block**

Find:
```typescript
    const rowsByKey = new Map<string, CmpCostRow>();
    let skipped = 0;

    for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const majCat = cellStr(row, cMajCat);
      // Below the data the workbook may carry legend/instruction lines merged
      // across the full width — a real major category is a single code, never
      // a sentence, and never part of a merged range.
      if (!majCat || row.getCell(cMajCat).isMerged || /\s/.test(majCat) || majCat.length > 100) {
        if (majCat) skipped++;
        continue;
      }

      const div = cellStr(row, cDiv) || null;
      const subDiv = cellStr(row, cSubDiv) || null;
      let costRaw = row.getCell(cCost).value;
      if (costRaw && typeof costRaw === 'object' && 'result' in costRaw) costRaw = (costRaw as any).result;
      const cmpCost = numOf(costRaw);

      const key = `${(div ?? '').toUpperCase()}|${(subDiv ?? '').toUpperCase()}|${majCat.toUpperCase()}`;
      rowsByKey.set(key, { div, subDiv, majCat, cmpCost });
    }
```
Replace with:
```typescript
    const rowsByKey = new Map<string, CmpCostRow>();
    let skipped = 0;

    const rawNum = (row: any, col: number): number | null => {
      let v = row.getCell(col).value;
      if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
      return numOf(v);
    };

    for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const majCat = cellStr(row, cMajCat);
      // Below the data the workbook may carry legend/instruction lines merged
      // across the full width — a real major category is a single code, never
      // a sentence, and never part of a merged range.
      if (!majCat || row.getCell(cMajCat).isMerged || /\s/.test(majCat) || majCat.length > 100) {
        if (majCat) skipped++;
        continue;
      }

      const div = cellStr(row, cDiv) || null;
      const subDiv = cellStr(row, cSubDiv) || null;

      const key = `${(div ?? '').toUpperCase()}|${(subDiv ?? '').toUpperCase()}|${majCat.toUpperCase()}`;
      rowsByKey.set(key, {
        div,
        subDiv,
        majCat,
        cuttingSam: rawNum(row, cCuttingSam),
        cuttingVal: rawNum(row, cCuttingVal),
        stitchingSam: rawNum(row, cStitchingSam),
        stitchingVal: rawNum(row, cStitchingVal),
        ironingSam: rawNum(row, cIroningSam),
        ironingVal: rawNum(row, cIroningVal),
        finishingSam: rawNum(row, cFinishingSam),
        finishingVal: rawNum(row, cFinishingVal),
        cmpCost: rawNum(row, cCost),
      });
    }
```

- [ ] **Step 3: Replace the upsert INSERT statement**

Find:
```typescript
      const values = batch.map((r) => Prisma.sql`(${r.majCat}, ${r.div}, ${r.subDiv}, ${r.cmpCost}, ${now}, ${now})`);
      await prisma.$executeRaw`
        INSERT INTO rough_cmp_cost_master (maj_cat, div, sub_div, cmp_cost, created_at, updated_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (div, sub_div, maj_cat) DO UPDATE SET
          cmp_cost   = EXCLUDED.cmp_cost,
          updated_at = EXCLUDED.updated_at
      `;
```
Replace with:
```typescript
      const values = batch.map((r) => Prisma.sql`(
        ${r.majCat}, ${r.div}, ${r.subDiv},
        ${r.cuttingSam}, ${r.cuttingVal},
        ${r.stitchingSam}, ${r.stitchingVal},
        ${r.ironingSam}, ${r.ironingVal},
        ${r.finishingSam}, ${r.finishingVal},
        ${r.cmpCost}, ${now}, ${now}
      )`);
      await prisma.$executeRaw`
        INSERT INTO rough_cmp_cost_master
          (maj_cat, div, sub_div,
           cutting_sam, cutting_val,
           stitching_sam, stitching_val,
           ironing_sam, ironing_val,
           finishing_sam, finishing_val,
           cmp_cost, created_at, updated_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (div, sub_div, maj_cat) DO UPDATE SET
          cutting_sam   = EXCLUDED.cutting_sam,
          cutting_val   = EXCLUDED.cutting_val,
          stitching_sam = EXCLUDED.stitching_sam,
          stitching_val = EXCLUDED.stitching_val,
          ironing_sam   = EXCLUDED.ironing_sam,
          ironing_val   = EXCLUDED.ironing_val,
          finishing_sam = EXCLUDED.finishing_sam,
          finishing_val = EXCLUDED.finishing_val,
          cmp_cost      = EXCLUDED.cmp_cost,
          updated_at    = EXCLUDED.updated_at
      `;
```

- [ ] **Step 4: Commit**

```bash
git add Backend/src/controllers/adminController.ts
git commit -m "feat: parse and upsert all 12 columns in uploadCmpCostMaster"
```

---

### Task 4: Update EXPENSE_TABLE_REGISTRY for `cmp-cost-master`

**Files:**
- Modify: `Backend/src/controllers/adminController.ts` (around lines 8651–8671)

- [ ] **Step 1: Replace the `cmp-cost-master` registry columns**

Find:
```typescript
    columns: [
      { key: 'id', label: 'ID', editable: false },
      { key: 'div', label: 'Division' },
      { key: 'subDiv', label: 'Sub Division' },
      { key: 'majCat', label: 'Major Category' },
      { key: 'cmpCost', label: 'CMP Cost (Rs/pc)', align: 'right' },
      { key: 'createdAt', label: 'Created At', editable: false },
      { key: 'updatedAt', label: 'Updated At', editable: false },
    ],
```
Replace with:
```typescript
    columns: [
      { key: 'id', label: 'ID', editable: false },
      { key: 'div', label: 'Division' },
      { key: 'subDiv', label: 'Sub Division' },
      { key: 'majCat', label: 'Major Category' },
      { key: 'cuttingSam', label: 'Cutting SAM', align: 'right' },
      { key: 'cuttingVal', label: 'Cutting Val', align: 'right' },
      { key: 'stitchingSam', label: 'Stitching SAM', align: 'right' },
      { key: 'stitchingVal', label: 'Stitching Val', align: 'right' },
      { key: 'ironingSam', label: 'Ironing SAM', align: 'right' },
      { key: 'ironingVal', label: 'Ironing Val', align: 'right' },
      { key: 'finishingSam', label: 'Finishing SAM', align: 'right' },
      { key: 'finishingVal', label: 'Finishing Val', align: 'right' },
      { key: 'cmpCost', label: 'CMP Cost (Rs/pc)', align: 'right' },
      { key: 'createdAt', label: 'Created At', editable: false },
      { key: 'updatedAt', label: 'Updated At', editable: false },
    ],
```

- [ ] **Step 2: Commit**

```bash
git add Backend/src/controllers/adminController.ts
git commit -m "feat: add SAM/Val columns to cmp-cost-master expense table registry"
```

---

### Task 5: Update frontend `expenseTables.ts`

**Files:**
- Modify: `Frontend/src/features/admin/config/expenseTables.ts` (around lines 542–561)

- [ ] **Step 1: Replace `cmp-cost-master` columns array**

Find:
```typescript
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'div', title: 'Division', pickFromExisting: true, filterable: true },
      { dataIndex: 'subDiv', title: 'Sub Division', pickFromExisting: true, filterable: true },
      { dataIndex: 'majCat', title: 'Major Category', pickFromExisting: true, filterable: true },
      { dataIndex: 'cmpCost', title: 'CMP Cost (Rs/pc)', align: 'right' },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
      { dataIndex: 'updatedAt', title: 'Updated At', type: 'date', editable: false },
    ],
```
Replace with:
```typescript
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'div', title: 'Division', pickFromExisting: true, filterable: true },
      { dataIndex: 'subDiv', title: 'Sub Division', pickFromExisting: true, filterable: true },
      { dataIndex: 'majCat', title: 'Major Category', pickFromExisting: true, filterable: true },
      { dataIndex: 'cuttingSam', title: 'Cutting SAM', align: 'right' },
      { dataIndex: 'cuttingVal', title: 'Cutting Val', align: 'right' },
      { dataIndex: 'stitchingSam', title: 'Stitching SAM', align: 'right' },
      { dataIndex: 'stitchingVal', title: 'Stitching Val', align: 'right' },
      { dataIndex: 'ironingSam', title: 'Ironing SAM', align: 'right' },
      { dataIndex: 'ironingVal', title: 'Ironing Val', align: 'right' },
      { dataIndex: 'finishingSam', title: 'Finishing SAM', align: 'right' },
      { dataIndex: 'finishingVal', title: 'Finishing Val', align: 'right' },
      { dataIndex: 'cmpCost', title: 'CMP Cost (Rs/pc)', align: 'right' },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
      { dataIndex: 'updatedAt', title: 'Updated At', type: 'date', editable: false },
    ],
```

Also update the `title` and `description` for `cmp-cost-master`:

Find:
```typescript
  'cmp-cost-master': {
    title: 'CMP Cost Master (Rough CMP Cost per Major Category)',
    description:
      'Average CMP cost per major category from the "SAM MASTER.xlsx" workbook (Sheet5). Auto-fills a Body Article's CMP Cost on the New Article page the first time a pending article of that major category is opened.',
```
Replace with:
```typescript
  'cmp-cost-master': {
    title: 'Rough CMP Cost Master (SAM Breakdown per Major Category)',
    description:
      'Cutting/Stitching/Ironing/Finishing SAM & Val plus total CMP Cost per major category. Auto-fills a Body Article\'s CMP Cost on the New Article page the first time a pending article of that major category is opened.',
```

- [ ] **Step 2: Commit**

```bash
git add Frontend/src/features/admin/config/expenseTables.ts
git commit -m "feat: add 8 SAM/Val columns to cmp-cost-master expense table config"
```

---

### Task 6: Move card in `Admin.tsx` — remove from Costs, add to Fabric & Body

**Files:**
- Modify: `Frontend/src/features/admin/pages/Admin.tsx` (lines 3744, 4384, 4563–4653)

- [ ] **Step 1: Update "Costs" MasterGroup — remove CMP card and fix count**

Find:
```tsx
          <MasterGroup title="Costs" count={3} notUploaded={((vaacTotal ? vaacTotal.total : null) === 0 ? 1 : 0) + ((basicAccessoriesMeta ? (basicAccessoriesMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((cmpCostMasterMeta ? (cmpCostMasterMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
```
Replace with:
```tsx
          <MasterGroup title="Costs" count={2} notUploaded={((vaacTotal ? vaacTotal.total : null) === 0 ? 1 : 0) + ((basicAccessoriesMeta ? (basicAccessoriesMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
```

Then delete the entire `<MasterDataCard` block for "CMP Cost Master" (lines 4563–4653, from `<MasterDataCard` through its closing `/>`) up to but not including `</MasterGroup>`.

- [ ] **Step 2: Update "Fabric & body" MasterGroup — add CMP card and fix count**

Find:
```tsx
          <MasterGroup title="Fabric & body" count={4} notUploaded={((fabricArticleDataMeta ? (fabricArticleDataMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((fabricArticleMasterMeta ? (fabricArticleMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((bodyFabConsTotal ? bodyFabConsTotal.total : null) === 0 ? 1 : 0) + ((bodyArticleDataMeta ? (bodyArticleDataMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
```
Replace with:
```tsx
          <MasterGroup title="Fabric & body" count={5} notUploaded={((fabricArticleDataMeta ? (fabricArticleDataMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((fabricArticleMasterMeta ? (fabricArticleMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((bodyFabConsTotal ? bodyFabConsTotal.total : null) === 0 ? 1 : 0) + ((bodyArticleDataMeta ? (bodyArticleDataMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((cmpCostMasterMeta ? (cmpCostMasterMeta.total ?? 0) : null) === 0 ? 1 : 0)}>
```

- [ ] **Step 3: Add the new card before the closing `</MasterGroup>` of Fabric & body**

Find the closing tag of the Fabric & body MasterGroup (the `</MasterGroup>` at line 4135 that comes after the last card in that group — the Precise section precedes it). Locate the end of the last card in "Fabric & body" (before `</MasterGroup>`) and add the new card just before `</MasterGroup>`:

```tsx
            <MasterDataCard
              title="Rough CMP Cost Master"
              description="SAM Breakdown & CMP Cost per Major Category"
              rows={cmpCostMasterMeta ? (cmpCostMasterMeta.total ?? 0) : null}
              lastUpload={cmpCostMasterMeta?.lastUpdated ?? null}
              loading={cmpCostMasterStatusLoading}
              busy={cmpCostMasterUploading}
              onView={() => navigate('/admin/expense/cmp-cost-master')}
              onDownload={() => downloadCmpCostMasterFile('export')}
              onTemplate={() => downloadCmpCostMasterFile('template')}
              onRefresh={loadCmpCostMasterStatus}
              details={
                <>
                  {cmpCostMasterMeta && (cmpCostMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {cmpCostMasterMeta.lastUpdated && (
                        <Descriptions.Item label="Last Updated">
                          {new Date(cmpCostMasterMeta.lastUpdated).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
                          }) + ' IST'}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Major Categories">
                        <Badge variant="info">{(cmpCostMasterMeta.categories ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{(cmpCostMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {cmpCostMasterMeta.skipped != null && (cmpCostMasterMeta.skipped ?? 0) > 0 && (
                        <Descriptions.Item label="Rows Skipped">
                          <Badge variant="warning">{(cmpCostMasterMeta.skipped ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No Rough CMP cost master data"
                      description="Upload the Rough CMP Cost Excel (row 1 = title, row 2 = headers: DIV, SUB_DIV, MAJ_CAT, CUTTING SAM, CUTTING VAL, STITCHING SAM, STITCHING VAL, IRONING SAM, IRONING VAL, FINISHING SAM, FINISHING VAL, CMP COST). Upserts by DIV + SUB_DIV + MAJ_CAT."
                    />
                  )}
                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Rough CMP Cost Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Row 1: title. Row 2: headers (<strong>DIV, SUB_DIV, MAJ_CAT, CUTTING SAM, CUTTING VAL, STITCHING SAM, STITCHING VAL, IRONING SAM, IRONING VAL, FINISHING SAM, FINISHING VAL, CMP COST</strong>). Row 3+: data.{' '}
                      <strong>Upserts by DIV + SUB_DIV + MAJ_CAT</strong> — combinations not in the file are left untouched.
                    </div>

                    <input
                      ref={cmpCostMasterFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCmpCostMasterUpload(file);
                      }}
                    />

                    {cmpCostMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Parsing Excel &amp; updating CMP costs...
                        </div>
                        <Progress value={cmpCostMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => cmpCostMasterFileRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-500/10"
                      >
                        <Inbox className="mb-2 h-8 w-8 text-slate-600 dark:text-slate-300" />
                        <p className="text-[13px]">
                          Click to upload <strong>.xlsx</strong> file
                        </p>
                        <p className="text-[11px] text-muted-foreground">Only Excel files. Max 50 MB.</p>
                      </button>
                    )}
                  </div>
                </>
              }
            />
```

- [ ] **Step 4: Update `MASTER_DATA_COUNT`**

Find:
```typescript
const MASTER_DATA_COUNT = 18;
```
Replace with:
```typescript
const MASTER_DATA_COUNT = 18;
```
(No change needed — a card moved between groups doesn't change the total count.)

- [ ] **Step 5: Commit**

```bash
git add Frontend/src/features/admin/pages/Admin.tsx
git commit -m "feat: move Rough CMP Cost Master card from Costs to Fabric & body accordion"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Remove CMP Cost Master from Costs accordion → Task 6 Step 1
- ✅ Add Rough CMP Cost Master to Fabric & Body accordion → Task 6 Steps 2–3
- ✅ Backend upload parses all 12 columns → Task 3
- ✅ Backend export includes all 12 columns → Task 2
- ✅ Template includes all 12 columns → Task 1 Step 3
- ✅ EXPENSE_TABLE_REGISTRY updated → Task 4
- ✅ Frontend expenseTables config updated → Task 5
- ✅ DB migration not needed (columns already exist)
- ✅ Prisma schema not needed (fields already exist)

**Placeholder check:** None found. All steps contain exact code.

**Type consistency:** `CmpCostRow` defined in Task 1 used identically in Tasks 2 and 3. Column keys in Task 4 (`cuttingSam`, etc.) match Task 5 (`dataIndex: 'cuttingSam'`). Insert SQL column names (`cutting_sam`, etc.) match existing DB columns confirmed via Supabase query.

**Where to insert the new card in Fabric & Body (Task 6 Step 3):** The Fabric & body MasterGroup ends just before line 4135 (`</MasterGroup>`). The last card inside it is the "Body Article Data" card. Insert the new `<MasterDataCard` block between the end of that card's `/>` and the `</MasterGroup>` closing tag.
