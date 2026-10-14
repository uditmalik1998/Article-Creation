# Precise Basic Trim Master Card — Precise Accordion

**Date:** 2026-10-14

## Overview

Add a new "Precise Basic Trim Master" card to the **Precise** accordion on the Admin → Expenses page. Backed by the existing `basic_trim_master` table. Follows the same pattern as the existing "Precise Trim Master" card (`precise_trim_master`).

## Excel Format (`BASIC TRIMS 2 TYPE COSTING (1).xlsx`)

- Sheet: Sheet1 (89 rows)
- Rows 1–2: empty — skip
- Row 3: headers in columns 2–4: `ATTRIBUTE NAME`, `TYPE`, `BT-1`
- Column 1: always empty — skip
- Data: rows 4+ (`attribute_name`, `type`, `bt_1`)
- `bt_2` is not in this Excel — will be null on upload (column is nullable)
- Upsert key: `(attribute_name, type)`

## Database

`basic_trim_master` table already exists with all required columns:
`id`, `attribute_name`, `type`, `bt_1`, `bt_2`, `created_at`, `updated_at`

Prisma model: `BasicTrimMaster` (fields: `id`, `attributeName`, `type`, `bt1`, `bt2`, `createdAt`, `updatedAt`)

No migration needed.

## Backend (`adminController.ts`)

New BASIC TRIM MASTER section:
- `BTM_SHEET_NAME = 'BASIC TRIM MASTER'`
- `BasicTrimRow` type: `{ attributeName: string; type: string; bt1: number | null; bt2: number | null }`
- `buildBasicTrimMasterSheet(wb, rows)` — 4-column Excel: `ATTRIBUTE_NAME`, `TYPE`, `BT-1`, `BT-2`
- `buildBasicTrimMasterWorkbook(rows)` — wraps sheet builder
- `getBasicTrimMasterStatus` — `COUNT(*)`, `COUNT(DISTINCT attribute_name)`, `MAX(updated_at)`
- `downloadBasicTrimMasterTemplate` — 1 example row
- `exportBasicTrimMaster` — all rows from `prisma.basicTrimMaster`
- `uploadBasicTrimMaster` — parses headers at row 3 (col 2–4); upserts by `(attribute_name, type)`; maps `bt_2` to null if absent

Add to `EXPENSE_TABLE_REGISTRY`:
```
'basic-trim-master': { kind: 'prisma', delegateName: 'basicTrimMaster', ... }
```
with columns: `id`, `attributeName`, `type`, `bt1`, `bt2`, `createdAt`, `updatedAt`

## Backend (`admin.ts` routes)

4 new routes:
- `GET /basic-trim-master/status`
- `GET /basic-trim-master/template`
- `GET /basic-trim-master/export`
- `POST /basic-trim-master/upload` (with `excelUpload.single('file')`)

## Frontend (`expenseTables.ts`)

New `'basic-trim-master'` entry — same 7 columns as `precise-trim-master`:
`id`, `attributeName` (pickFromExisting, filterable), `type` (pickFromExisting, filterable), `bt1` (right-align), `bt2` (right-align), `createdAt`, `updatedAt`

`allowCreate: true`, `allowDelete: true`, `requiredOnCreate: ['attributeName', 'type']`

## Frontend (`Admin.tsx`)

### State additions
- `BasicTrimMasterMeta` interface: `{ total?: number; attributes?: number; lastUpdated?: string | null }`
- State: `basicTrimMasterMeta`, `basicTrimMasterStatusLoading`, `basicTrimMasterUploading`, `basicTrimMasterProgress`
- Ref: `basicTrimMasterFileRef`
- Handlers: `loadBasicTrimMasterStatus`, `downloadBasicTrimMasterFile`, `handleBasicTrimMasterUpload`
- Call `loadBasicTrimMasterStatus()` in initial load effect

### Precise MasterGroup
- Count: 3 → 4
- Add `basicTrimMasterMeta` term to `notUploaded` calc
- Add "Precise Basic Trim Master" card after the "Precise Trim Master" card

### MASTER_DATA_COUNT
- 21 → 22

## Out of Scope

- No lookup endpoint (Precise Trim Master has one; not needed here)
- No changes to existing precise-trim-master or any other card
