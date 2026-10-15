# Rough CMP Cost Master Card — Fabric & Body Section

**Date:** 2026-10-14

## Overview

Move the "CMP Cost Master" card out of the **Costs** accordion and replace it with a richer "Rough CMP Cost Master" card in the **Fabric & Body** accordion. The underlying `rough_cmp_cost_master` table gains 8 new SAM/Val breakdown columns to match the new Excel format (`ROUGH- CMP_COST_MASTER_EXPORT.xlsx`).

## Excel Format

- Row 1: title row (`Average of TOTAL CMP COST`) — skip
- Row 2: headers — `DIV`, `SUB_DIV`, `MAJ_CAT`, `CUTTING SAM`, `CUTTING VAL`, `STITCHING SAM`, `STITCHING VAL`, `IRONING SAM`, `IRONING VAL`, `FINISHING SAM`, `FINISHING VAL`, `CMP COST`
- Row 3+: data (814 rows in sample)

## Database

**Migrate `rough_cmp_cost_master`** — add 8 nullable numeric columns:

| New Column       | Excel Header    |
|------------------|-----------------|
| `cutting_sam`    | CUTTING SAM     |
| `cutting_val`    | CUTTING VAL     |
| `stitching_sam`  | STITCHING SAM   |
| `stitching_val`  | STITCHING VAL   |
| `ironing_sam`    | IRONING SAM     |
| `ironing_val`    | IRONING VAL     |
| `finishing_sam`  | FINISHING SAM   |
| `finishing_val`  | FINISHING VAL   |

Existing columns (`id`, `div`, `sub_div`, `maj_cat`, `cmp_cost`, `created_at`, `updated_at`) unchanged. Upsert key stays `(div, sub_div, maj_cat)`.

## Backend (`adminController.ts`)

- **`uploadCmpCostMaster`**: parse row 2 as headers, row 3+ as data; map all 12 columns; upsert with new fields
- **`exportCmpCostMaster`**: include all 12 columns in export sheet
- **`getCmpCostMasterTemplate`**: template headers updated to all 12 columns
- **`getCmpCostMasterStatus`**: no change needed
- **`EXPENSE_TABLE_REGISTRY['cmp-cost-master']`**: add 8 new columns to the registry entry

## Frontend (`expenseTables.ts`)

Add 8 new `align: 'right'` columns to `cmp-cost-master` config after `majCat`:
`cuttingSam`, `cuttingVal`, `stitchingSam`, `stitchingVal`, `ironingSam`, `ironingVal`, `finishingSam`, `finishingVal`

## Frontend (`Admin.tsx`)

### Costs MasterGroup
- Remove "CMP Cost Master" card
- Count: 3 → 2
- Remove `cmpCostMasterMeta` term from `notUploaded` calc

### Fabric & Body MasterGroup
- Add "Rough CMP Cost Master" card (same state variables: `cmpCostMasterMeta`, `cmpCostMasterUploading`, etc.)
- Count: 4 → 5
- Add `cmpCostMasterMeta` term to `notUploaded` calc
- Upload description: row 2 = headers, row 3+ = data, 12 columns

## Prisma Schema

Add 8 new optional `Float?` fields to `RoughCmpCostMaster` model.

## Out of Scope

- No change to routes (`/admin/cmp-cost-master/*`)
- No change to how Body Articles auto-fill `cmpCost` (still reads from same table/column)
- Existing "Costs" card state variables are reused, not renamed
