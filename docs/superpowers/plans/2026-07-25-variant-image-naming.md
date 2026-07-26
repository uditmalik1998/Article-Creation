# Variant Image Naming in article-master Bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save variant article images to the `article-master` R2 bucket with key `{baseArticleNumber}-{color}.{ext}` (e.g., `1110142284-CHR_BLK.jpg`) instead of `{sapArticleNumber}.{ext}`; generic articles keep existing behaviour.

**Architecture:** Add a private `buildApprovedKey(safeArticleNumber, ext, safeColor?)` helper to `StorageService` that computes the dest key. All three upload code paths call this helper. The call site in `ApproverController.syncApprovedToSap` branches on `isGeneric` to pass the right article number and color.

**Tech Stack:** TypeScript, AWS SDK v3 (S3Client), Cloudflare R2, Prisma

---

### Task 1: Add `buildApprovedKey` helper + `colorCode` param to `storageService.ts`

**Files:**
- Modify: `Backend/src/services/storageService.ts`

- [ ] **Step 1: Add the private `buildApprovedKey` helper method**

Open `Backend/src/services/storageService.ts`. After the `buildApprovedUrl` method (around line 435), add:

```typescript
private buildApprovedKey(safeArticleNumber: string, ext: string, safeColor?: string): string {
    if (safeColor) {
        return `${safeArticleNumber}-${safeColor}.${ext}`;
    }
    return `${safeArticleNumber}.${ext}`;
}

private sanitizeColor(color: string): string {
    return color.trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9_\-]/g, '').toUpperCase();
}
```

- [ ] **Step 2: Add `colorCode` param to `uploadApprovedImageFromSourceUrl` signature**

Change the method signature from:
```typescript
async uploadApprovedImageFromSourceUrl(sourceImageUrl: string, articleNumber: string, labelData?: WatermarkLabel): Promise<UploadResult>
```
to:
```typescript
async uploadApprovedImageFromSourceUrl(sourceImageUrl: string, articleNumber: string, labelData?: WatermarkLabel, colorCode?: string): Promise<UploadResult>
```

- [ ] **Step 3: Compute `safeColor` at the top of the method body**

Right after `const wantWatermark = !!labelData;` (around line 451), add:

```typescript
const safeColor = colorCode ? this.sanitizeColor(colorCode) : undefined;
```

- [ ] **Step 4: Replace dest key construction in Path 1 (direct S3 copy)**

Find the block starting with `if (sourceKey && !wantWatermark)`. Change:
```typescript
const destKey = `${safeArticleNumber}.${extension}`;
```
to:
```typescript
const destKey = this.buildApprovedKey(safeArticleNumber, extension, safeColor);
```

- [ ] **Step 5: Replace dest key construction in Path 2 (S3 GetObject fallback)**

Find `const fallbackDestKey = \`${safeArticleNumber}.${fallbackExt}\`;`. Change to:
```typescript
const fallbackDestKey = this.buildApprovedKey(safeArticleNumber, fallbackExt, safeColor);
```

Also in the `if (wantWatermark)` branch inside Path 2, change:
```typescript
destKey = `${safeArticleNumber}.${stamped.extension}`;
```
to:
```typescript
destKey = this.buildApprovedKey(safeArticleNumber, stamped.extension, safeColor);
```

- [ ] **Step 6: Replace dest key construction in Path 3 (HTTP fetch fallback)**

Find `const key = \`${safeArticleNumber}.${extension}\`;` (around line 529). The watermark block above it updates `extension` in place, so only this one line needs changing:
```typescript
const key = this.buildApprovedKey(safeArticleNumber, extension, safeColor);
```

- [ ] **Step 7: TypeScript check**

```bash
cd Backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add Backend/src/services/storageService.ts
git commit -m "feat: add colorCode param to uploadApprovedImageFromSourceUrl for variant key naming"
```

---

### Task 2: Update call site in `ApproverController.ts`

**Files:**
- Modify: `Backend/src/controllers/ApproverController.ts`

- [ ] **Step 1: Branch on `isGeneric` at the call site**

Find the `uploadApprovedImageFromSourceUrl` call inside `syncApprovedToSap` (around line 2350). Replace:

```typescript
const approvedImageUpload = await storageService.uploadApprovedImageFromSourceUrl(
    String(approvedItem.imageUrl),
    String(syncResult.sapArticleNumber),
    labelData,
);
```

with:

```typescript
const isVariant = !approvedItem.isGeneric;
const imageArticleNumber = isVariant
    ? String(approvedItem.articleNumber)
    : String(syncResult.sapArticleNumber);
const imageColorCode = isVariant
    ? (approvedItem.variantColor || approvedItem.colour || undefined)
    : undefined;

const approvedImageUpload = await storageService.uploadApprovedImageFromSourceUrl(
    String(approvedItem.imageUrl),
    imageArticleNumber,
    labelData,
    imageColorCode ?? undefined,
);
```

- [ ] **Step 2: TypeScript check**

```bash
cd Backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Verify key output with a console log (temporary)**

Inside the try block just after computing `imageColorCode`, add temporarily:
```typescript
console.log(`[IMAGE_KEY] isVariant=${isVariant} articleNumber=${imageArticleNumber} color=${imageColorCode}`);
```
This lets you confirm the right values flow through on the next approval test. Remove after verifying.

- [ ] **Step 4: Commit**

```bash
git add Backend/src/controllers/ApproverController.ts
git commit -m "feat: use article-number+color key for variant images in article-master bucket"
```

---

### Task 3: Remove debug log + final verification

**Files:**
- Modify: `Backend/src/controllers/ApproverController.ts`

- [ ] **Step 1: Remove the temporary console.log added in Task 2 Step 3**

Delete the line:
```typescript
console.log(`[IMAGE_KEY] isVariant=${isVariant} articleNumber=${imageArticleNumber} color=${imageColorCode}`);
```

- [ ] **Step 2: Final TypeScript check**

```bash
cd Backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add Backend/src/controllers/ApproverController.ts
git commit -m "chore: remove debug log from variant image key naming"
```
