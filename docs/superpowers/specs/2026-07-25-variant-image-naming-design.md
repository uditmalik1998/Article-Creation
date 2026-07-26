# Variant Image Naming in article-master Bucket

**Date:** 2026-07-25
**Status:** Approved

## Problem

When a variant article is approved and pushed to SAP, its image is copied to the `article-master` R2 bucket. Currently the key is `{sapArticleNumber}.{ext}` (e.g., `0000001110142284001.jpg`), which is opaque and not human-readable. The user wants variant images keyed by `{baseArticleNumber}-{color}.{ext}` (e.g., `1110142284-CHR_BLK.jpg`) so images are easy to identify by article and colour.

## Scope

- **In scope:** Change the dest key for variant articles only. Generic articles keep existing behaviour.
- **Out of scope:** Backfilling existing images already in `article-master`, changing the upload flow for generic articles, changing how `imageUrl` is stored in DB after upload.

## Design

### Approach: Add `colorCode` param to `uploadApprovedImageFromSourceUrl`

Add an optional `colorCode?: string` parameter (4th arg, after `labelData`) to `storageService.uploadApprovedImageFromSourceUrl`. Introduce a private `buildApprovedKey(articleNumber, ext, colorCode?)` helper that returns:
- `${safeArticleNumber}-${safeColor}.${ext}` when `colorCode` is present and non-empty
- `${safeArticleNumber}.${ext}` otherwise (existing behaviour)

`safeColor` is sanitized identically to `safeArticleNumber` — strip characters outside `[A-Za-z0-9_-]`.

All three upload code paths (direct S3 copy, S3 GetObject fallback, HTTP fetch fallback) call this helper to compute `destKey`, keeping the logic in one place.

### Call site — `ApproverController.syncApprovedToSap`

Before calling `uploadApprovedImageFromSourceUrl`, branch on `approvedItem.isGeneric`:

| Case | `articleNumber` arg | `colorCode` arg |
|------|---------------------|-----------------|
| Variant (`isGeneric = false`) | `approvedItem.articleNumber` | `approvedItem.variantColor \|\| approvedItem.colour \|\| undefined` |
| Generic (`isGeneric = true`) | `syncResult.sapArticleNumber` | _(omitted)_ |

### Key examples

| Article | Color | Resulting key |
|---------|-------|---------------|
| 1110142284 (variant) | CHR_BLK | `1110142284-CHR_BLK.jpg` |
| 1110142284 (variant) | CBN_BLK | `1110142284-CBN_BLK.jpg` |
| Generic article | _(none)_ | `0000001110142284001.jpg` (unchanged) |

## Files to Change

| File | Change |
|------|--------|
| `Backend/src/services/storageService.ts` | Add `colorCode?` param + `buildApprovedKey` helper; update all 3 dest-key assignments |
| `Backend/src/controllers/ApproverController.ts` | Branch on `isGeneric` at the `uploadApprovedImageFromSourceUrl` call site (~line 2350) |

## Error Handling

No new error cases introduced. If `variantColor` and `colour` are both null/empty on a variant, `colorCode` resolves to `undefined` and the key falls back to `{sapArticleNumber}.{ext}` — same as today.
