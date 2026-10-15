# Precise Basic Trim Master Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Precise Basic Trim Master" card to the Precise accordion on the Admin → Expenses page, backed by the existing `basic_trim_master` table with full upload/download/template/view functionality.

**Architecture:** Mirrors the Precise Trim Master pattern exactly. Backend adds 4 handlers (status/template/export/upload) and a registry entry; routes file adds 4 routes; frontend adds an expenseTables config entry and the card in Admin.tsx with its state/handlers.

**Tech Stack:** TypeScript, Express, ExcelJS, Prisma (`basicTrimMaster`), React

---

## Files to Modify

| File | Change |
|------|--------|
| `Backend/src/controllers/adminController.ts` | Add BASIC TRIM MASTER section after `uploadPreciseTrimMaster` (~line 6418); add `'basic-trim-master'` to `EXPENSE_TABLE_REGISTRY` after `'precise-trim-master'` (~line 8748) |
| `Backend/src/routes/admin.ts` | Add 4 routes after precise-trim-master block (~line 237) |
| `Frontend/src/features/admin/config/expenseTables.ts` | Add `'basic-trim-master'` entry after `'precise-trim-master'` |
| `Frontend/src/features/admin/pages/Admin.tsx` | Interface, state, handlers, boot call, Precise group count/notUploaded, card, MASTER_DATA_COUNT |

---

### Task 1: Backend handlers in `adminController.ts`

**Files:**
- Modify: `Backend/src/controllers/adminController.ts`

**Excel format for upload** (`BASIC TRIMS 2 TYPE COSTING (1).xlsx`):
- Rows 1–2: empty
- Row 3: headers in columns 2–4 — `ATTRIBUTE NAME`, `TYPE`, `BT-1`
- Column 1: always empty
- Data: rows 4+ (85 rows)
- No BT-2 column — `bt2` will always be null

- [ ] **Step 1: Add BASIC TRIM MASTER section after `uploadPreciseTrimMaster`**

Find the comment line `// FABRIC ARTICLE DATA (fabric_article_data)` (around line 6420) and insert the entire block BEFORE it:

```typescript
// ═══════════════════════════════════════════════════════
// BASIC TRIM MASTER (basic_trim_master)
//
// BT-1 trim costs per SAP attribute name and type.
// Template / Download Data / Upload all speak the same four-column layout
// (ATTRIBUTE_NAME, TYPE, BT-1, BT-2), so a file downloaded here can be
// edited and uploaded straight back. The source Excel ("BASIC TRIMS 2 TYPE
// COSTING") only provides BT-1; BT-2 is nullable and defaults to null.
// Upload upserts by (attribute_name, type).
// ═══════════════════════════════════════════════════════

const BTM_SHEET_NAME = 'BASIC TRIM MASTER';

type BasicTrimRow = { attributeName: string; type: string; bt1: number | null; bt2: number | null };

function buildBasicTrimMasterSheet(wb: any, rows: BasicTrimRow[]): void {
  const ws = wb.addWorksheet(BTM_SHEET_NAME);

  const blue = (cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    cell.alignment = { horizontal: 'center' };
  };

  const headerRow = ws.addRow(['ATTRIBUTE_NAME', 'TYPE', 'BT-1', 'BT-2']);
  headerRow.eachCell((cell: any) => blue(cell));

  for (const r of rows) {
    ws.addRow([r.attributeName, r.type, r.bt1 ?? '', r.bt2 ?? '']);
  }

  ws.columns = [{ width: 26 }, { width: 28 }, { width: 14 }, { width: 14 }];
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

function buildBasicTrimMasterWorkbook(rows: BasicTrimRow[]): any {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  buildBasicTrimMasterSheet(wb, rows);
  return wb;
}

/** GET /admin/basic-trim-master/status */
export const getBasicTrimMasterStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.$queryRaw<{ total: bigint; attributes: bigint; last_updated: Date | null }[]>`
      SELECT COUNT(*)::bigint AS total,
             COUNT(DISTINCT attribute_name)::bigint AS attributes,
             MAX(updated_at) AS last_updated
      FROM basic_trim_master
    `;
    const r = rows[0] ?? { total: 0n, attributes: 0n, last_updated: null };
    res.json({
      success: true,
      data: {
        total: Number(r.total),
        attributes: Number(r.attributes),
        lastUpdated: r.last_updated ? r.last_updated.toISOString() : null,
      },
    });
  } catch (error: any) {
    console.error('[BasicTrimMaster] Status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /admin/basic-trim-master/template */
export const downloadBasicTrimMasterTemplate = async (_req: Request, res: Response): Promise<void> => {
  try {
    const example: BasicTrimRow = { attributeName: 'M_BTN_TYPE', type: 'DYE_CAST_BTN', bt1: 2.5, bt2: null };
    const wb = buildBasicTrimMasterWorkbook([example]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="BASIC_TRIM_MASTER_TEMPLATE.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('[BasicTrimMaster] Template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /admin/basic-trim-master/export — every stored row, same layout. */
export const exportBasicTrimMaster = async (_req: Request, res: Response): Promise<void> => {
  try {
    const masters = await prisma.basicTrimMaster.findMany({
      orderBy: [{ attributeName: 'asc' }, { type: 'asc' }],
    });
    const rows: BasicTrimRow[] = masters.map((m) => ({
      attributeName: m.attributeName,
      type: m.type,
      bt1: m.bt1 === null ? null : Number(m.bt1),
      bt2: m.bt2 === null ? null : Number(m.bt2),
    }));
    const wb = buildBasicTrimMasterWorkbook(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="BASIC_TRIM_MASTER_EXPORT.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('[BasicTrimMaster] Export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /admin/basic-trim-master/upload
 * Upserts by (attribute_name, type).
 * Source Excel has headers in row 3, col 1 empty, data from row 4.
 */
export const uploadBasicTrimMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded. Send a .xlsx file as "file" field.' });
      return;
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as any);

    const ws = wb.getWorksheet(BTM_SHEET_NAME) ?? wb.worksheets[0];
    if (!ws) {
      res.status(400).json({ success: false, error: 'No worksheets found in the uploaded Excel file.' });
      return;
    }

    const cellStr = (row: any, c: number): string => {
      let v = row.getCell(c).value;
      if (v && typeof v === 'object' && 'richText' in v) return (v as any).richText.map((t: any) => t.text).join('').trim();
      if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
      if (v && typeof v === 'object' && 'text' in v) v = (v as any).text;
      return v == null ? '' : String(v).trim();
    };

    const numOf = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
    };

    const cellNum = (row: any, c: number): number | null => {
      let v = row.getCell(c).value;
      if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
      return numOf(v);
    };

    // Auto-detect header row — looks for ATTRIBUTE and TYPE in first 5 rows
    let headerRowNo = 1;
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const line = [1, 2, 3, 4, 5].map((c) => cellStr(row, c).toUpperCase()).join(' ');
      if ((line.includes('ATTRIBUTE') || line.includes('ATTR')) && line.includes('TYPE')) {
        headerRowNo = r;
        break;
      }
    }

    // Default column indices match the source Excel layout (col 1 empty)
    let cAttr = 2, cType = 3, cBt1 = 4, cBt2 = 5;
    const hdr = ws.getRow(headerRowNo);
    for (let c = 1; c <= 8; c++) {
      const h = cellStr(hdr, c).toUpperCase().replace(/[-_ ]/g, '');
      if (h.includes('ATTRIBUTE') || h === 'ATTR' || h === 'ATTRNAME') cAttr = c;
      else if (h === 'TYPE') cType = c;
      else if (h === 'BT1') cBt1 = c;
      else if (h === 'BT2') cBt2 = c;
    }

    const rowsByKey = new Map<string, BasicTrimRow>();
    let skipped = 0;

    for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const attributeName = cellStr(row, cAttr);
      const type = cellStr(row, cType);
      if (!attributeName || !type || attributeName === '-' || type === '-') {
        skipped++;
        continue;
      }
      const key = `${attributeName.toUpperCase()}|${type.toUpperCase()}`;
      rowsByKey.set(key, { attributeName, type, bt1: cellNum(row, cBt1), bt2: cellNum(row, cBt2) });
    }

    const records = [...rowsByKey.values()];
    if (records.length === 0) {
      res.status(400).json({ success: false, error: 'No valid rows found in the Excel file.' });
      return;
    }

    const now = new Date();
    const CHUNK = 200;
    for (let i = 0; i < records.length; i += CHUNK) {
      const batch = records.slice(i, i + CHUNK);
      const values = batch.map((r) => Prisma.sql`(${r.attributeName}, ${r.type}, ${r.bt1}, ${r.bt2}, ${now}, ${now})`);
      await prisma.$executeRaw`
        INSERT INTO basic_trim_master (attribute_name, type, bt_1, bt_2, created_at, updated_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (attribute_name, type) DO UPDATE SET
          bt_1       = EXCLUDED.bt_1,
          bt_2       = EXCLUDED.bt_2,
          updated_at = EXCLUDED.updated_at
      `;
    }

    const total = await prisma.basicTrimMaster.count();
    const [attrRow] = await prisma.$queryRaw<[{ attributes: bigint }]>`
      SELECT COUNT(DISTINCT attribute_name)::bigint AS attributes FROM basic_trim_master
    `;
    const attributes = Number(attrRow.attributes);

    console.log(`[BasicTrimMaster] Upserted ${records.length} rows (${skipped} skipped)`);

    res.json({
      success: true,
      message: `Basic Trim Master updated: ${records.length} rows${skipped > 0 ? `, ${skipped} rows skipped` : ''}.`,
      data: { total, attributes, skipped, lastUpdated: now.toISOString() },
    });
  } catch (error: any) {
    console.error('[BasicTrimMaster] Upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
```

- [ ] **Step 2: Add `'basic-trim-master'` to EXPENSE_TABLE_REGISTRY**

Find the end of the `'precise-trim-master'` entry (look for `defaultSort: { field: 'attributeName', dir: 'asc' },` followed by `},`). Insert the new entry immediately after:

```typescript
  'basic-trim-master': {
    kind: 'prisma',
    delegateName: 'basicTrimMaster',
    idColumn: 'id',
    idIsNumeric: true,
    allowCreate: true,
    allowDelete: true,
    requiredOnCreate: ['attributeName', 'type'],
    columns: [
      { key: 'id', label: 'ID', editable: false },
      { key: 'attributeName', label: 'Attribute Name' },
      { key: 'type', label: 'Type' },
      { key: 'bt1', label: 'BT-1', align: 'right' },
      { key: 'bt2', label: 'BT-2', align: 'right' },
      { key: 'createdAt', label: 'Created At', editable: false },
      { key: 'updatedAt', label: 'Updated At', editable: false },
    ],
    searchColumns: ['attributeName', 'type'],
    displayColumns: ['attributeName', 'type'],
    defaultSort: { field: 'attributeName', dir: 'asc' },
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

```
cd Backend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add Backend/src/controllers/adminController.ts
git commit -m "feat: add Basic Trim Master upload/export/template/status handlers and registry entry"
```

---

### Task 2: Backend routes in `admin.ts`

**Files:**
- Modify: `Backend/src/routes/admin.ts`

- [ ] **Step 1: Add 4 routes after the precise-trim-master block**

Find this line:
```typescript
router.post('/precise-trim-master/upload', excelUpload.single('file'), h(adminController.uploadPreciseTrimMaster));
```

Insert immediately after it:
```typescript

// ═══════════════════════════════════════════════════════
// BASIC TRIM MASTER (basic_trim_master)
// ═══════════════════════════════════════════════════════
router.get('/basic-trim-master/status', h(adminController.getBasicTrimMasterStatus));
router.get('/basic-trim-master/template', h(adminController.downloadBasicTrimMasterTemplate));
router.get('/basic-trim-master/export', h(adminController.exportBasicTrimMaster));
router.post('/basic-trim-master/upload', excelUpload.single('file'), h(adminController.uploadBasicTrimMaster));
```

- [ ] **Step 2: Commit**

```bash
git add Backend/src/routes/admin.ts
git commit -m "feat: add basic-trim-master routes (status/template/export/upload)"
```

---

### Task 3: Frontend `expenseTables.ts`

**Files:**
- Modify: `Frontend/src/features/admin/config/expenseTables.ts`

- [ ] **Step 1: Add `'basic-trim-master'` entry after `'precise-trim-master'`**

Find the end of the `'precise-trim-master'` entry (its closing `},`). Insert the new entry immediately after:

```typescript
  'basic-trim-master': {
    title: 'Precise Basic Trim Master (BT-1 / BT-2 per Attribute)',
    description:
      "BT-1 and BT-2 trim costs per SAP attribute name and type, from the 'BASIC TRIMS 2 TYPE COSTING' workbook. Upserted by (ATTRIBUTE_NAME, TYPE).",
    rowKey: 'id',
    defaultSortBy: 'attributeName',
    defaultSortDir: 'asc',
    allowCreate: true,
    allowDelete: true,
    requiredOnCreate: ['attributeName', 'type'],
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'attributeName', title: 'Attribute Name', pickFromExisting: true, filterable: true },
      { dataIndex: 'type', title: 'Type', pickFromExisting: true, filterable: true },
      { dataIndex: 'bt1', title: 'BT-1', align: 'right' },
      { dataIndex: 'bt2', title: 'BT-2', align: 'right' },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
      { dataIndex: 'updatedAt', title: 'Updated At', type: 'date', editable: false },
    ],
  },
```

- [ ] **Step 2: Commit**

```bash
git add Frontend/src/features/admin/config/expenseTables.ts
git commit -m "feat: add basic-trim-master expense table config"
```

---

### Task 4: Frontend `Admin.tsx` — state, handlers, card, counts

**Files:**
- Modify: `Frontend/src/features/admin/pages/Admin.tsx`

- [ ] **Step 1: Update `MASTER_DATA_COUNT`**

Find:
```typescript
/** Master-data upload cards on this page (Attributes 7, GM 2, Fabric & body 5, Precise 3, Costs 2, Hierarchy & menus 2). */
const MASTER_DATA_COUNT = 21;
```

Replace with:
```typescript
/** Master-data upload cards on this page (Attributes 7, GM 2, Fabric & body 5, Precise 4, Costs 2, Hierarchy & menus 2). */
const MASTER_DATA_COUNT = 22;
```

- [ ] **Step 2: Add `BasicTrimMasterMeta` interface**

Find:
```typescript
interface PreciseTrimMasterMeta {
  total?: number;
  attributes?: number;
  skipped?: number;
  lastUpdated?: string;
}
```

Insert immediately after it:
```typescript

interface BasicTrimMasterMeta {
  total?: number;
  attributes?: number;
  skipped?: number;
  lastUpdated?: string;
}
```

- [ ] **Step 3: Add state variables**

Find:
```typescript
  // Precise Trim Master (precise_trim_master)
  const [preciseTrimMasterMeta, setPreciseTrimMasterMeta] = useState<PreciseTrimMasterMeta | null>(null);
  const [preciseTrimMasterStatusLoading, setPreciseTrimMasterStatusLoading] = useState(false);
  const [preciseTrimMasterUploading, setPreciseTrimMasterUploading] = useState(false);
  const [preciseTrimMasterProgress, setPreciseTrimMasterProgress] = useState<number>(0);
  const preciseTrimMasterFileRef = useRef<HTMLInputElement | null>(null);
```

Insert immediately after:
```typescript

  // Basic Trim Master (basic_trim_master)
  const [basicTrimMasterMeta, setBasicTrimMasterMeta] = useState<BasicTrimMasterMeta | null>(null);
  const [basicTrimMasterStatusLoading, setBasicTrimMasterStatusLoading] = useState(false);
  const [basicTrimMasterUploading, setBasicTrimMasterUploading] = useState(false);
  const [basicTrimMasterProgress, setBasicTrimMasterProgress] = useState<number>(0);
  const basicTrimMasterFileRef = useRef<HTMLInputElement | null>(null);
```

- [ ] **Step 4: Add handlers**

Find:
```typescript
  // ─────────────────────────────── National Grid Master ───────────────────────────────
```

Insert immediately before it:
```typescript
  // ─────────────────────────────── Basic Trim Master ───────────────────────────────
  const loadBasicTrimMasterStatus = useCallback(async () => {
    setBasicTrimMasterStatusLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/basic-trim-master/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load basic trim master status');
      setBasicTrimMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load basic trim master status');
    } finally {
      setBasicTrimMasterStatusLoading(false);
    }
  }, []);

  const downloadBasicTrimMasterFile = (kind: 'template' | 'export') => {
    const token = localStorage.getItem('authToken');
    const url = `${APP_CONFIG.api.baseURL}/admin/basic-trim-master/${kind}`;
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = kind === 'template' ? 'BASIC_TRIM_MASTER_TEMPLATE.xlsx' : 'BASIC_TRIM_MASTER_EXPORT.xlsx';
        a.click();
      })
      .catch(() => message.error(kind === 'template' ? 'Failed to download template' : 'Failed to export basic trim master'));
  };

  const handleBasicTrimMasterUpload = async (file: File) => {
    setBasicTrimMasterUploading(true);
    setBasicTrimMasterProgress(0);
    try {
      const token = localStorage.getItem('authToken');
      const formData = new FormData();
      formData.append('file', file);
      const progressInterval = setInterval(() => {
        setBasicTrimMasterProgress((prev) => Math.min(prev + 5, 90));
      }, 500);
      const res = await fetch(`${APP_CONFIG.api.baseURL}/admin/basic-trim-master/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      clearInterval(progressInterval);
      setBasicTrimMasterProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      message.success(data.message);
      setBasicTrimMasterMeta(data.data);
    } catch (err: any) {
      message.error(err?.message || 'Upload failed');
    } finally {
      setBasicTrimMasterUploading(false);
      setTimeout(() => setBasicTrimMasterProgress(0), 1500);
      if (basicTrimMasterFileRef.current) basicTrimMasterFileRef.current.value = '';
    }
  };

```

- [ ] **Step 5: Add to boot `useEffect`**

Find:
```typescript
    loadPreciseTrimMasterStatus();
    loadPreciseFabricArticleStatus();
```

Replace with:
```typescript
    loadPreciseTrimMasterStatus();
    loadBasicTrimMasterStatus();
    loadPreciseFabricArticleStatus();
```

Also find the deps array for the same `useEffect`. It will have `loadPreciseTrimMasterStatus` and `loadPreciseFabricArticleStatus` adjacent in it. Add `loadBasicTrimMasterStatus` between them:

Find in the deps array:
```
loadPreciseTrimMasterStatus, loadPreciseFabricArticleStatus
```
Replace with:
```
loadPreciseTrimMasterStatus, loadBasicTrimMasterStatus, loadPreciseFabricArticleStatus
```

- [ ] **Step 6: Update Precise MasterGroup opening tag**

Find:
```tsx
          <MasterGroup title="Precise" count={3} notUploaded={((preciseBodyArticleTotal ? preciseBodyArticleTotal.total : null) === 0 ? 1 : 0) + ((preciseTrimMasterMeta ? (preciseTrimMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((preciseFabricArticleMeta ? preciseFabricArticleMeta.total : null) === 0 ? 1 : 0)}>
```

Replace with:
```tsx
          <MasterGroup title="Precise" count={4} notUploaded={((preciseBodyArticleTotal ? preciseBodyArticleTotal.total : null) === 0 ? 1 : 0) + ((preciseTrimMasterMeta ? (preciseTrimMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((basicTrimMasterMeta ? (basicTrimMasterMeta.total ?? 0) : null) === 0 ? 1 : 0) + ((preciseFabricArticleMeta ? preciseFabricArticleMeta.total : null) === 0 ? 1 : 0)}>
```

- [ ] **Step 7: Add the new card after the Precise Trim Master card**

Find the closing `/>` of the Precise Trim Master card followed immediately by the Precise Fabric Article Data card:
```tsx
            />
            <MasterDataCard
              title="Precise Fabric Article Data"
```

Insert the new card between them:
```tsx
            />
            <MasterDataCard
              title="Precise Basic Trim Master"
              description="BT-1 / BT-2 Trim Costs per Attribute &amp; Type"
              rows={basicTrimMasterMeta ? (basicTrimMasterMeta.total ?? 0) : null}
              lastUpload={basicTrimMasterMeta?.lastUpdated ?? null}
              loading={basicTrimMasterStatusLoading}
              busy={basicTrimMasterUploading}
              onView={() => navigate('/admin/expense/basic-trim-master')}
              onDownload={() => downloadBasicTrimMasterFile('export')}
              onTemplate={() => downloadBasicTrimMasterFile('template')}
              onRefresh={loadBasicTrimMasterStatus}
              details={
                <>
                  {basicTrimMasterMeta && (basicTrimMasterMeta.total ?? 0) > 0 ? (
                    <Descriptions bordered>
                      {basicTrimMasterMeta.lastUpdated && (
                        <Descriptions.Item label="Last Updated">
                          {new Date(basicTrimMasterMeta.lastUpdated).toLocaleString('en-IN', {
                            dateStyle: 'medium', timeStyle: 'short',
                          })}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Attribute Names">
                        <Badge variant="info">{(basicTrimMasterMeta.attributes ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Rows">
                        <Badge variant="success">{(basicTrimMasterMeta.total ?? 0).toLocaleString()}</Badge>
                      </Descriptions.Item>
                      {basicTrimMasterMeta.skipped != null && (basicTrimMasterMeta.skipped ?? 0) > 0 && (
                        <Descriptions.Item label="Skipped">
                          <Badge variant="warning">{(basicTrimMasterMeta.skipped ?? 0).toLocaleString()}</Badge>
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="No basic trim master data loaded"
                      description="Upload an Excel with columns: ATTRIBUTE_NAME, TYPE, BT-1, BT-2. Row 3 = headers, data from row 4. Upserts by (ATTRIBUTE_NAME, TYPE)."
                    />
                  )}
                </>
              }
              upload={
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-1 font-semibold">Upload Basic Trim Master Excel</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Row 3: headers (<strong>ATTRIBUTE NAME, TYPE, BT-1</strong>). Row 4+: data.{' '}
                      <strong>Upserts by (ATTRIBUTE_NAME + TYPE)</strong> — existing rows are updated, new rows are inserted.
                    </div>

                    <input
                      ref={basicTrimMasterFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBasicTrimMasterUpload(file);
                      }}
                    />

                    {basicTrimMasterUploading ? (
                      <div>
                        <div className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">
                          <RefreshCw className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" />
                          Uploading &amp; upserting rows...
                        </div>
                        <Progress value={basicTrimMasterProgress} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => basicTrimMasterFileRef.current?.click()}
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
            <MasterDataCard
              title="Precise Fabric Article Data"
```

- [ ] **Step 8: Verify TypeScript compiles clean**

```
cd Frontend && npx tsc --noEmit 2>&1 | grep "Admin.tsx" | head -20
```

Expected: no errors from Admin.tsx.

- [ ] **Step 9: Commit**

```bash
git add Frontend/src/features/admin/pages/Admin.tsx
git commit -m "feat: add Precise Basic Trim Master card to Precise accordion"
```

---

## Self-Review

**Spec coverage:**
- ✅ Backend handlers (status/template/export/upload) → Task 1 Step 1
- ✅ EXPENSE_TABLE_REGISTRY entry → Task 1 Step 2
- ✅ Routes → Task 2
- ✅ expenseTables config → Task 3
- ✅ `BasicTrimMasterMeta` interface → Task 4 Step 2
- ✅ State vars + ref → Task 4 Step 3
- ✅ 3 handlers → Task 4 Step 4
- ✅ Boot load call + deps → Task 4 Step 5
- ✅ Precise MasterGroup count 3→4 + notUploaded → Task 4 Step 6
- ✅ Card in Precise accordion → Task 4 Step 7
- ✅ MASTER_DATA_COUNT 21→22 → Task 4 Step 1
- ✅ Excel parsing: headers row 3, col 1 empty, col 2=attr, col 3=type, col 4=bt1, bt2=null

**Placeholder scan:** None found. All steps have complete code.

**Type consistency:** `BasicTrimRow` defined in Task 1 → used in export map + upload parser in same task. `BasicTrimMasterMeta` defined in Task 4 Step 2 → used in state (Step 3), handlers (Step 4), card JSX (Step 7). `loadBasicTrimMasterStatus` defined in Task 4 Step 4 → called in boot (Step 5), used as `onRefresh` in card (Step 7). All consistent.

**DB column names confirmed:** `basic_trim_master` uses `attribute_name`, `type`, `bt_1`, `bt_2` (underscored). The INSERT SQL uses these exact names. Prisma model uses camelCase `bt1`/`bt2` mapping from `bt_1`/`bt_2`.
