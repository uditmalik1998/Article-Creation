# Model Generation "From Article List" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "From Article List" mode to the AI Model Generation page — upload/paste a list of `FINAL ART` codes, pull each source garment image from the article-master (APPROVED) R2 bucket, generate 5 Myntra-style model views with Gemini, and store them in the new `model-images` R2 bucket.

**Architecture:** Reuse the existing bulk job engine (`modelGenerationBulkService.ts`) and Gemini generator (`runSingleGeneration`) unchanged in spirit. Extend the task model with an `r2key` source kind that reads from the APPROVED bucket and writes generated images to `model-images` instead of local disk. Add one new route (`POST /bulk/from-articles`) and one new frontend panel. Everything else (status/cancel/zip endpoints, progress UI, retry/backoff) is reused.

**Tech Stack:** Node + Express + TypeScript, `@aws-sdk/client-s3` (Cloudflare R2), `@google/genai` (Gemini `gemini-2.5-flash-image`), `xlsx` (SheetJS), `multer`; React + Vite + TypeScript frontend.

**Testing note:** This repo has **no jest/vitest harness**. The established pattern is standalone `ts-node` verification scripts under `Backend/scripts/` (e.g. `test-r2-connection.ts`). We follow that: each backend behavior gets a `scripts/test-*.ts` that asserts with node `assert` and exits non-zero on failure. Type safety is verified with `npm run lint` (`tsc --noEmit`). Frontend is verified by `tsc` (via `npm run build`/`lint`) and manual smoke.

**Reference spec:** `docs/superpowers/specs/2026-07-08-model-generation-from-article-list-design.md`

---

## File Structure

**Create:**
- `Backend/src/services/articleListParser.ts` — parse xlsx/csv/text → deduped `codes[]`; build source & output R2 keys.
- `Backend/scripts/test-article-list-parser.ts` — assertions for the parser + key builders.
- `Backend/scripts/test-model-images-bucket.ts` — round-trip `uploadModelImage` + `fetchApprovedImage` against R2.
- `Backend/scripts/test-source-probe.ts` — pre-flight: check N sample `{FINAL_ART}.jpg` keys exist in APPROVED bucket.
- `Frontend/src/features/model-generation/components/ArticleListPanel.tsx` — the new upload/paste UI panel.

**Modify:**
- `Backend/.env.example` — add `MODEL_IMAGES_R2_*` + `MODELGEN_CONCURRENCY`.
- `Backend/src/services/storageService.ts` — third R2 client + `fetchApprovedImage` + `uploadModelImage`.
- `Backend/src/services/modelGenerationService.ts` — add `side` + `three_quarter` to the prompt view map.
- `Backend/src/services/modelGenerationBulkService.ts` — `r2key` task kind, 5-view mode, worker branch, concurrency pool, restart-resume.
- `Backend/src/routes/modelGenerationBulk.ts` — new `POST /bulk/from-articles`.
- `Frontend/src/features/model-generation/pages/ModelGenerationPage.tsx` — mount `ArticleListPanel`, add mode toggle + submit handler.

---

## Task 1: Wire the `model-images` bucket into env

**Files:**
- Modify: `Backend/.env.example`
- Modify: `Backend/.env` (real values — not committed)

- [ ] **Step 1: Add the new bucket block to `.env.example`**

Append after the existing `APPROVED_R2_*` block (currently ends around `Backend/.env.example:78`):

```bash
# For AI-generated model images (separate bucket: model-images)
MODEL_IMAGES_R2_BUCKET_NAME=model-images
MODEL_IMAGES_R2_ACCOUNT_ID=your-r2-account-id
MODEL_IMAGES_R2_ACCESS_KEY_ID=your-model-images-access-key-id
MODEL_IMAGES_R2_SECRET_ACCESS_KEY=your-model-images-secret-access-key
MODEL_IMAGES_R2_PUBLIC_URL_BASE=https://pub-your-model-images-public-id.r2.dev

# Bulk model-generation throughput
MODELGEN_CONCURRENCY=3
```

- [ ] **Step 2: Add the real values to `Backend/.env`**

Fill the same five `MODEL_IMAGES_R2_*` keys with the real credentials for the
`model-images` bucket you created, plus `MODELGEN_CONCURRENCY=3`. (If the bucket
shares the same R2 account/keys as the primary bucket, reuse the account id +
access keys; only the bucket name and public URL differ.)

- [ ] **Step 3: Commit**

```bash
git add Backend/.env.example
git commit -m "chore: add model-images R2 bucket + concurrency env vars"
```

---

## Task 2: storageService — fetch source + upload generated image

**Files:**
- Modify: `Backend/src/services/storageService.ts`
- Test: `Backend/scripts/test-model-images-bucket.ts`

- [ ] **Step 1: Add the model-images client fields + constructor wiring**

In `Backend/src/services/storageService.ts`, add fields to the `StorageService`
class (next to the approved-client fields near line 54):

```typescript
    private modelImagesS3Client: S3Client;
    private modelImagesBucket: string;
    private modelImagesPublicUrlBase: string | undefined;
```

At the end of the `constructor` (after `this.approvedS3Client = ...`, ~line 127),
add:

```typescript
        const modelAccountId = this.normalizeAccountId(process.env.MODEL_IMAGES_R2_ACCOUNT_ID) || accountId;
        const modelAccessKeyId = this.normalizeEnv(process.env.MODEL_IMAGES_R2_ACCESS_KEY_ID) || accessKeyId;
        const modelSecretAccessKey = this.normalizeEnv(process.env.MODEL_IMAGES_R2_SECRET_ACCESS_KEY) || secretAccessKey;
        this.modelImagesBucket = this.normalizeEnv(process.env.MODEL_IMAGES_R2_BUCKET_NAME) || 'model-images';
        this.modelImagesPublicUrlBase = this.normalizeEnv(process.env.MODEL_IMAGES_R2_PUBLIC_URL_BASE);

        this.modelImagesS3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${modelAccountId}.r2.cloudflarestorage.com`,
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            requestHandler: s3RequestHandler,
            credentials: {
                accessKeyId: modelAccessKeyId || '',
                secretAccessKey: modelSecretAccessKey || '',
            },
        });
```

- [ ] **Step 2: Add `fetchApprovedImage` + `uploadModelImage` methods**

Add these two public methods inside the class (before the closing `}` of the
class, ~line 532):

```typescript
    /**
     * Download a source garment image from the article-master (APPROVED) bucket by key.
     * Returns null when the object does not exist (404 / NoSuchKey) so callers can
     * mark the task "source not found" and continue the batch.
     */
    async fetchApprovedImage(key: string): Promise<{ buffer: Buffer; mime: string } | null> {
        try {
            const res = await this.approvedS3Client.send(
                new GetObjectCommand({ Bucket: this.approvedBucket, Key: key })
            );
            const chunks: Uint8Array[] = [];
            for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
            return { buffer: Buffer.concat(chunks), mime: res.ContentType || 'image/jpeg' };
        } catch (error: any) {
            const code = String(error?.Code || error?.name || '').toLowerCase();
            const status = Number(error?.$metadata?.httpStatusCode || 0);
            if (code.includes('nosuchkey') || code.includes('notfound') || status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Upload a generated model image to the model-images bucket at the given key
     * (e.g. "1110097922-BLACK/front.jpg"). Returns the public URL when a public
     * base is configured, otherwise a 7-day signed URL.
     */
    async uploadModelImage(key: string, buffer: Buffer, mime = 'image/jpeg'): Promise<string> {
        await this.modelImagesS3Client.send(new PutObjectCommand({
            Bucket: this.modelImagesBucket,
            Key: key,
            Body: buffer,
            ContentType: mime,
        }));
        if (this.modelImagesPublicUrlBase) {
            return this.buildPublicUrl(this.modelImagesPublicUrlBase, this.modelImagesBucket, key);
        }
        return getSignedUrl(
            this.modelImagesS3Client,
            new GetObjectCommand({ Bucket: this.modelImagesBucket, Key: key }),
            { expiresIn: 604800 }
        );
    }
```

- [ ] **Step 3: Write the failing round-trip verification script**

Create `Backend/scripts/test-model-images-bucket.ts`:

```typescript
import 'dotenv/config';
import assert from 'assert';
import { storageService } from '../src/services/storageService';

async function main() {
  const key = `__selftest__/roundtrip-${Date.now()}.txt`;
  const body = Buffer.from('model-images roundtrip ok');

  const url = await storageService.uploadModelImage(key, body, 'text/plain');
  console.log('uploaded ->', url);
  assert.ok(url && url.length > 0, 'uploadModelImage must return a URL');

  // fetchApprovedImage on a definitely-missing key must return null, not throw.
  const missing = await storageService.fetchApprovedImage(`__definitely_missing__/${Date.now()}.jpg`);
  assert.strictEqual(missing, null, 'fetchApprovedImage must return null for a missing key');

  console.log('PASS: model-images upload + approved-miss handling');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

- [ ] **Step 4: Run it — expect FAIL first (methods not yet compiled / creds), then PASS**

Run: `cd Backend && npx ts-node scripts/test-model-images-bucket.ts`
Expected after Steps 1–2 and real `.env` creds: prints `PASS: ...` and exits 0.
If creds are missing it fails loudly — fix `.env`, not the code.

- [ ] **Step 5: Type-check**

Run: `cd Backend && npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add Backend/src/services/storageService.ts Backend/scripts/test-model-images-bucket.ts
git commit -m "feat(storage): fetchApprovedImage + uploadModelImage for model-images bucket"
```

---

## Task 3: Article-list parser + R2 key builders

**Files:**
- Create: `Backend/src/services/articleListParser.ts`
- Test: `Backend/scripts/test-article-list-parser.ts`

- [ ] **Step 1: Write the failing parser test**

Create `Backend/scripts/test-article-list-parser.ts`:

```typescript
import assert from 'assert';
import * as XLSX from 'xlsx';
import { parseArticleCodesFromText, parseArticleCodesFromXlsx, sourceKeyFor, outputKeyFor } from '../src/services/articleListParser';

// text parsing: strip header, trim, dedupe, drop blanks
const text = 'FINAL ART\n1110097922-BLACK\n 1110106859-DARK GREY \n1110097922-BLACK\n\n';
const fromText = parseArticleCodesFromText(text);
assert.deepStrictEqual(fromText, ['1110097922-BLACK', '1110106859-DARK GREY'], 'text parse/dedupe/trim/header-strip');

// xlsx parsing: single column named FINAL ART
const ws = XLSX.utils.aoa_to_sheet([['FINAL ART'], ['1110111001-MEDIUM MAROON'], ['1110111002-ROSE PINK']]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
const fromXlsx = parseArticleCodesFromXlsx(buf);
assert.deepStrictEqual(fromXlsx, ['1110111001-MEDIUM MAROON', '1110111002-ROSE PINK'], 'xlsx parse');

// key builders
assert.strictEqual(sourceKeyFor('1110097922-BLACK'), '1110097922-BLACK.jpg', 'source key');
assert.strictEqual(outputKeyFor('1110097922-BLACK', 'front'), '1110097922-BLACK/front.jpg', 'output key');

console.log('PASS: article list parser + key builders');
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Backend && npx ts-node scripts/test-article-list-parser.ts`
Expected: FAIL — `Cannot find module '../src/services/articleListParser'`.

- [ ] **Step 3: Implement the parser**

Create `Backend/src/services/articleListParser.ts`:

```typescript
import * as XLSX from 'xlsx';

const HEADER_TOKENS = new Set(['final art', 'article', 'article number', 'code', 'final article']);

function normalize(raw: unknown): string {
  return String(raw ?? '').trim();
}

/** Dedupe while preserving first-seen order; drop blanks and header-looking rows. */
function cleanCodes(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = normalize(r);
    if (!v) continue;
    if (HEADER_TOKENS.has(v.toLowerCase())) continue;
    const keyLower = v.toLowerCase();
    if (seen.has(keyLower)) continue;
    seen.add(keyLower);
    out.push(v);
  }
  return out;
}

/** Parse pasted text — one code per line (or comma-separated). */
export function parseArticleCodesFromText(text: string): string[] {
  const rows = String(text || '')
    .split(/[\r\n,]+/)
    .map(normalize);
  return cleanCodes(rows);
}

/** Parse an uploaded .xlsx/.xls buffer — reads the first column of the first sheet. */
export function parseArticleCodesFromXlsx(buffer: Buffer): string[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  const firstCol = matrix.map((row) => normalize(row?.[0]));
  return cleanCodes(firstCol);
}

/** Source garment image key in the APPROVED bucket: "{FINAL_ART}.jpg". */
export function sourceKeyFor(code: string): string {
  return `${code}.jpg`;
}

/** Output key in the model-images bucket: "{FINAL_ART}/{view}.jpg". */
export function outputKeyFor(code: string, view: string): string {
  return `${code}/${view}.jpg`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Backend && npx ts-node scripts/test-article-list-parser.ts`
Expected: `PASS: article list parser + key builders`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add Backend/src/services/articleListParser.ts Backend/scripts/test-article-list-parser.ts
git commit -m "feat: article-list parser (xlsx/text) + R2 key builders"
```

---

## Task 4: Add `side` + `three_quarter` views to the prompt

**Files:**
- Modify: `Backend/src/services/modelGenerationService.ts:54-61`

- [ ] **Step 1: Replace the conditional `viewMap` with a full map**

In `buildPrompt`, replace the current `viewMap` block (lines 54–61) with a single
map that always contains every supported view (backward compatible — the caller's
`views` array still decides which are used):

```typescript
  const viewMap: Record<string, string> = {
    front: 'Front-facing model pose showing the front of the garment clearly.',
    back: 'Back-facing model pose showing the back of the garment clearly.',
    left_side: 'Left side profile model pose showing the side fit of the garment.',
    side: 'Side profile model pose showing the side fit and full silhouette of the garment.',
    three_quarter: 'Three-quarter (45-degree) angle model pose showing the front and one side together.',
    closeup: 'Close-up fashion shot highlighting fabric texture, stitching and details.',
  };
```

- [ ] **Step 2: Type-check**

Run: `cd Backend && npm run lint`
Expected: no TypeScript errors. (No behavior change for existing 1- and 4-view callers.)

- [ ] **Step 3: Commit**

```bash
git add Backend/src/services/modelGenerationService.ts
git commit -m "feat(modelgen): add side + three_quarter prompt views"
```

---

## Task 5: Bulk service — `r2key` task kind + 5-view mode

**Files:**
- Modify: `Backend/src/services/modelGenerationBulkService.ts`

- [ ] **Step 1: Add a shared `viewsForCount` helper**

Near the top of the file (after the `sleep` helper, ~line 33), add:

```typescript
export function viewsForCount(imagesCount: string): string[] {
  if (imagesCount === '5') return ['front', 'back', 'side', 'three_quarter', 'closeup'];
  if (imagesCount === '1') return ['front'];
  return ['front', 'back', 'left_side', 'closeup'];
}
```

- [ ] **Step 2: Extend `BulkTask` with a source kind**

Replace the `BulkTask` interface (lines 39–48) with:

```typescript
export interface BulkTask {
  id: string;
  fileName: string;
  sourcePath?: string;   // set for kind 'file'
  sourceKey?: string;    // set for kind 'r2key' — key in the APPROVED bucket
  articleCode?: string;  // set for kind 'r2key' — the FINAL ART code
  kind: 'file' | 'r2key';
  view: string;
  status: TaskStatus;
  outputUrl?: string;
  error?: string;
  attempts: number;
}
```

- [ ] **Step 3: Use `viewsForCount` in `createJob` (file mode)**

In `createJob` replace the local `views` computation (lines 174–176) with:

```typescript
  const views = viewsForCount(args.params.imagesCount);
```

And in the task-push loop (lines 179–189) set the new fields — replace the loop body with:

```typescript
  for (const src of args.sourceImagePaths) {
    for (const view of views) {
      tasks.push({
        id: crypto.randomBytes(6).toString('hex'),
        fileName: path.basename(src),
        sourcePath: src,
        kind: 'file',
        view,
        status: 'PENDING',
        attempts: 0,
      });
    }
  }
```

- [ ] **Step 4: Add `createArticleJob` for the r2key path**

Add this exported function after `createJob` (~line 214):

```typescript
export function createArticleJob(args: {
  id: string;
  userId?: number | string;
  jobDir: string;
  inputDir: string;
  outputDir: string;
  codes: string[];
  sourceKeys: string[];          // parallel to codes: APPROVED-bucket keys
  params: BulkJobParams;
}): BulkJob {
  const views = viewsForCount(args.params.imagesCount);
  const tasks: BulkTask[] = [];
  for (let i = 0; i < args.codes.length; i++) {
    for (const view of views) {
      tasks.push({
        id: crypto.randomBytes(6).toString('hex'),
        fileName: args.codes[i],
        sourceKey: args.sourceKeys[i],
        articleCode: args.codes[i],
        kind: 'r2key',
        view,
        status: 'PENDING',
        attempts: 0,
      });
    }
  }
  const job: BulkJob = {
    id: args.id,
    userId: args.userId,
    status: 'QUEUED',
    total: tasks.length,
    done: 0,
    failed: 0,
    params: args.params,
    tasks,
    inputDir: args.inputDir,
    outputDir: args.outputDir,
    jobDir: args.jobDir,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  persistJob(job);
  return job;
}
```

- [ ] **Step 5: Type-check**

Run: `cd Backend && npm run lint`
Expected: TS errors ONLY inside `runTaskWithRetry` (it still reads `task.sourcePath`
unconditionally). That is fixed in Task 6. If errors appear elsewhere, fix them here.

- [ ] **Step 6: Commit**

```bash
git add Backend/src/services/modelGenerationBulkService.ts
git commit -m "feat(bulk): r2key task kind, createArticleJob, 5-view mode"
```

---

## Task 6: Bulk worker — generate from R2 source, upload to model-images

**Files:**
- Modify: `Backend/src/services/modelGenerationBulkService.ts` (`runTaskWithRetry`, lines 255–327)

- [ ] **Step 1: Import the storage service**

At the top of the file (after the `runSingleGeneration` import, line 4), add:

```typescript
import { storageService } from './storageService';
import { outputKeyFor } from './articleListParser';
```

- [ ] **Step 2: Branch `runTaskWithRetry` on task kind**

Replace the source-buffer setup at the start of `runTaskWithRetry` (lines 256–264)
with a kind-aware loader. Replace:

```typescript
  const imgBuf = fs.readFileSync(task.sourcePath);
  const imgMime = mimeFromPath(task.sourcePath);
```

with:

```typescript
  let imgBuf: Buffer;
  let imgMime: string;
  if (task.kind === 'r2key') {
    const src = await storageService.fetchApprovedImage(task.sourceKey!);
    if (!src) {
      task.status = 'FAILED';
      task.error = `source image not found in article-master bucket (${task.sourceKey})`;
      return;
    }
    imgBuf = src.buffer;
    imgMime = src.mime;
  } else {
    imgBuf = fs.readFileSync(task.sourcePath!);
    imgMime = mimeFromPath(task.sourcePath!);
  }
```

- [ ] **Step 3: Branch the success/output handling on task kind**

In the `try` block, replace the local-disk output section (lines 292–300) with:

```typescript
      if (task.kind === 'r2key') {
        const key = outputKeyFor(task.articleCode!, task.view);
        const url = await storageService.uploadModelImage(key, buf, 'image/png');
        task.status = 'DONE';
        task.outputUrl = url;
        task.error = undefined;
        return;
      }

      const safeName = path.basename(task.fileName, path.extname(task.fileName)).replace(/[^a-zA-Z0-9_-]/g, '_');
      const outName = `${safeName}_${task.view.replace(/\s+/g, '_')}_${task.id.slice(0, 6)}.png`;
      const outPath = path.join(job.outputDir, outName);
      fs.writeFileSync(outPath, buf);
      task.status = 'DONE';
      task.outputUrl = `/uploads/model-generation/jobs/${job.id}/output/${outName}`;
      task.error = undefined;
      return;
```

- [ ] **Step 4: Type-check**

Run: `cd Backend && npm run lint`
Expected: no TypeScript errors now (the `sourcePath` access is guarded).

- [ ] **Step 5: Commit**

```bash
git add Backend/src/services/modelGenerationBulkService.ts
git commit -m "feat(bulk): worker fetches R2 source + uploads outputs to model-images"
```

---

## Task 7: Bulk worker — concurrency pool + restart-resume

**Files:**
- Modify: `Backend/src/services/modelGenerationBulkService.ts` (`startJob` ~329, `rehydrateJobsFromDisk` ~99)

- [ ] **Step 1: Add concurrency constant**

Near the other config constants (top of file, ~line 11), add:

```typescript
const CONCURRENCY = Math.max(1, parseInt(process.env.MODELGEN_CONCURRENCY || '3', 10));
```

- [ ] **Step 2: Replace the sequential loop in `startJob` with a worker pool**

In `startJob`, replace the `for (const task of job.tasks) { ... }` loop
(lines 341–364) with a fixed pool of `CONCURRENCY` workers pulling from a shared index:

```typescript
    let nextIndex = 0;
    const runWorker = async (): Promise<void> => {
      while (true) {
        if (cancelFlags.has(job.id)) return;
        const i = nextIndex++;
        if (i >= job.tasks.length) return;
        const task = job.tasks[i];
        if (task.status !== 'PENDING') continue;

        task.status = 'RUNNING';
        persistJob(job);

        await runTaskWithRetry(job, task);

        const finalStatus = task.status as TaskStatus;
        if (finalStatus === 'DONE') job.done++;
        else if (finalStatus === 'FAILED') job.failed++;
        persistJob(job);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorker()));

    // Any tasks left PENDING because the job was cancelled → mark FAILED.
    if (cancelFlags.has(job.id)) {
      for (const t of job.tasks) {
        if (t.status === 'PENDING') { t.status = 'FAILED'; t.error = 'Cancelled'; job.failed++; }
      }
    }
```

> Note: the global Gemini pacing (`acquireGeminiSlot` + `MIN_GAP_MS`) still serializes
> the *start* of each Gemini call, so `CONCURRENCY` workers overlap the download/upload
> and retry-wait phases without exceeding the rate floor. Adaptive 429 backoff is unchanged.

- [ ] **Step 3: Make rehydrate resume unfinished jobs instead of failing them**

In `rehydrateJobsFromDisk`, replace the `if (job.status === 'QUEUED' || job.status === 'RUNNING') { ... }`
block (lines 108–120) with a resume path:

```typescript
      if (job.status === 'QUEUED' || job.status === 'RUNNING') {
        // Reset in-flight tasks back to PENDING and re-queue the job so a restart resumes it.
        for (const t of job.tasks) {
          if (t.status === 'RUNNING') t.status = 'PENDING';
        }
        job.status = 'QUEUED';
        persistJob(job);
        jobs.set(job.id, job);
        if (process.env.MODELGEN_AUTO_RESUME !== 'false') {
          console.log(`[ModelGenBulk] Resuming job ${job.id} — ${job.tasks.filter(t => t.status === 'PENDING').length} pending task(s)`);
          startJob(job.id);
        }
        restored++;
        continue;
      }
```

> `startJob` is defined later in the module but hoisted (function declaration), so
> calling it from `rehydrateJobsFromDisk` at import time is safe.

- [ ] **Step 4: Type-check**

Run: `cd Backend && npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add Backend/src/services/modelGenerationBulkService.ts
git commit -m "feat(bulk): concurrency pool + restart-resume of unfinished jobs"
```

---

## Task 8: New route — `POST /bulk/from-articles`

**Files:**
- Modify: `Backend/src/routes/modelGenerationBulk.ts`

- [ ] **Step 1: Add imports + a memory-storage multer for the list file**

At the top of `Backend/src/routes/modelGenerationBulk.ts`, extend the service import
(lines 6–17) to include the article-job helpers, and add the parser import:

```typescript
import {
  newJobId,
  createJobDirs,
  createJob,
  createArticleJob,
  startJob,
  getJob,
  cancelJob,
  summarizeJob,
  isSupportedImagePath,
  listRecentJobsForUser,
  listItem,
} from '../services/modelGenerationBulkService';
import { parseArticleCodesFromXlsx, parseArticleCodesFromText, sourceKeyFor } from '../services/articleListParser';
```

Below the existing `bulkUpload` multer (after line 69), add a small memory-storage
uploader for the list file:

```typescript
const listUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname)
      || file.mimetype.includes('spreadsheet')
      || file.mimetype === 'text/csv';
    return ok ? cb(null, true) : cb(new Error('Upload an .xlsx, .xls, or .csv file'));
  },
});
```

- [ ] **Step 2: Add the route handler**

Add this route before `export default router;` (line 280):

```typescript
// ─── POST /bulk/from-articles — list of article codes → generate from R2 source ──
router.post('/bulk/from-articles', listUpload.single('list'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gender, bodytype, imagesCount, codesText } = req.body as Record<string, string>;
    if (!gender || !bodytype) {
      res.status(400).json({ success: false, error: 'gender and bodytype are required.' });
      return;
    }

    let codes: string[] = [];
    if (req.file) {
      codes = /\.csv$/i.test(req.file.originalname)
        ? parseArticleCodesFromText(req.file.buffer.toString('utf-8'))
        : parseArticleCodesFromXlsx(req.file.buffer);
    } else if (codesText) {
      codes = parseArticleCodesFromText(codesText);
    }

    if (codes.length === 0) {
      res.status(400).json({ success: false, error: 'No article codes found. Upload a file or paste codes.' });
      return;
    }

    const jobId = newJobId();
    const dirs = createJobDirs(jobId); // reused only for job.json persistence
    const job = createArticleJob({
      id: jobId,
      userId: (req as any).user?.id,
      jobDir: dirs.jobDir,
      inputDir: dirs.inputDir,
      outputDir: dirs.outputDir,
      codes,
      sourceKeys: codes.map(sourceKeyFor),
      params: {
        gender,
        bodytype,
        imagesCount: imagesCount || '5',
      },
    });

    startJob(job.id);

    res.status(202).json({
      success: true,
      jobId: job.id,
      totalArticles: codes.length,
      totalTasks: job.total,
      status: job.status,
    });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Type-check**

Run: `cd Backend && npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 4: Smoke-test the endpoint with a 2-code paste**

Start the backend (`cd Backend && npm run dev`) in one shell. In another, using a
valid bearer token, POST two codes and confirm a `202` with a `jobId`, then poll:

```bash
# replace $TOKEN and two REAL codes that exist in the APPROVED bucket
curl -s -X POST http://localhost:5001/api/model-generation/bulk/from-articles \
  -H "Authorization: Bearer $TOKEN" \
  -F gender=Female -F bodytype=Full-Body -F imagesCount=5 \
  -F 'codesText=1110097922-BLACK
1110106859-DARK GREY'
# then, with the returned jobId:
curl -s http://localhost:5001/api/model-generation/bulk/job/<JOB_ID> -H "Authorization: Bearer $TOKEN"
```
Expected: `202 { success:true, jobId, totalArticles:2, totalTasks:10 }`, and the job
status endpoint shows tasks moving PENDING → RUNNING → DONE (or a clear
"source image not found" error if the key is wrong — that surfaces the key format
issue early).

- [ ] **Step 5: Commit**

```bash
git add Backend/src/routes/modelGenerationBulk.ts
git commit -m "feat(api): POST /bulk/from-articles — generate model images from article list"
```

---

## Task 9: Pre-flight probe script (de-risk the source key)

**Files:**
- Create: `Backend/scripts/test-source-probe.ts`

- [ ] **Step 1: Write the probe**

Create `Backend/scripts/test-source-probe.ts`:

```typescript
import 'dotenv/config';
import { storageService } from '../src/services/storageService';
import { sourceKeyFor } from '../src/services/articleListParser';

// Paste ~10 real FINAL ART codes from IMAGES PENDING.xlsx here before running.
const SAMPLE = [
  '1110097922-BLACK',
  '1110106859-DARK GREY',
  '1110109892-BLACK',
  '1110111001-MEDIUM MAROON',
  '1110111002-ROSE PINK',
];

async function main() {
  let found = 0;
  for (const code of SAMPLE) {
    const key = sourceKeyFor(code);
    const img = await storageService.fetchApprovedImage(key);
    const ok = !!img;
    if (ok) found++;
    console.log(`${ok ? 'FOUND' : 'MISS '}  ${key}${ok ? `  (${img!.buffer.length} bytes, ${img!.mime})` : ''}`);
  }
  console.log(`\n${found}/${SAMPLE.length} source images found with key format "{FINAL_ART}.jpg".`);
  if (found === 0) {
    console.error('All misses — the key format is likely wrong. Inspect real filenames in the APPROVED bucket before the full run.');
    process.exit(1);
  }
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

- [ ] **Step 2: Run the probe**

Run: `cd Backend && npx ts-node scripts/test-source-probe.ts`
Expected: most/all `FOUND`. If all `MISS`, STOP and inspect real bucket filenames —
do not launch the full 2,829-code run until this passes. (This is the §9 de-risk gate.)

- [ ] **Step 3: Commit**

```bash
git add Backend/scripts/test-source-probe.ts
git commit -m "test: pre-flight probe for APPROVED-bucket source key format"
```

---

## Task 10: Frontend — the "From Article List" panel

**Files:**
- Create: `Frontend/src/features/model-generation/components/ArticleListPanel.tsx`
- Modify: `Frontend/src/features/model-generation/pages/ModelGenerationPage.tsx`

- [ ] **Step 1: Create the panel component**

Create `Frontend/src/features/model-generation/components/ArticleListPanel.tsx`:

```tsx
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

export interface ArticleListSubmit {
  file: File | null;
  codesText: string;
  gender: string;
  bodytype: string;
}

interface Props {
  submitting: boolean;
  onSubmit: (payload: ArticleListSubmit) => void;
}

// Client-side preview parse (backend re-parses authoritatively).
function previewCount(text: string): number {
  return Array.from(new Set(
    text.split(/[\r\n,]+/).map(s => s.trim())
      .filter(v => v && v.toLowerCase() !== 'final art')
      .map(v => v.toLowerCase())
  )).length;
}

export function ArticleListPanel({ submitting, onSubmit }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [codesText, setCodesText] = useState('');
  const [gender, setGender] = useState('Female');
  const [bodytype, setBodytype] = useState('Full-Body');
  const [generate, setGenerate] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);

  const pastedCount = useMemo(() => previewCount(codesText), [codesText]);
  const articleCount = file ? (fileCount ?? 0) : pastedCount;
  const imageCount = articleCount * 5;

  async function handleFile(f: File | null) {
    setFile(f);
    setFileCount(null);
    if (!f) return;
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
    const codes = Array.from(new Set(
      matrix.map(r => String(r?.[0] ?? '').trim())
        .filter(v => v && v.toLowerCase() !== 'final art')
        .map(v => v.toLowerCase())
    ));
    setFileCount(codes.length);
  }

  const canSubmit = generate && !submitting && articleCount > 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Article list (.xlsx / .csv)</label>
        <input type="file" accept=".xlsx,.xls,.csv"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">…or paste codes (one FINAL ART per line)</label>
        <textarea rows={5} className="w-full border rounded p-2"
          placeholder={'1110097922-BLACK\n1110106859-DARK GREY'}
          value={codesText} onChange={(e) => setCodesText(e.target.value)} disabled={!!file} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Gender</label>
          <select className="w-full border rounded p-2" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option>Female</option><option>Male</option><option>Kid Boy</option><option>Kid Girl</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Body Type</label>
          <select className="w-full border rounded p-2" value={bodytype} onChange={(e) => setBodytype(e.target.value)}>
            <option>Full-Body</option><option>Upper-Body</option><option>Lower-Body</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} />
        Generate model images &amp; store to <code>model-images</code> bucket
      </label>

      {articleCount > 0 && (
        <p className="text-sm text-gray-600">
          {articleCount.toLocaleString()} articles → {imageCount.toLocaleString()} images (5 views each)
        </p>
      )}

      <button
        className="px-4 py-2 rounded bg-orange-500 text-white disabled:opacity-50"
        disabled={!canSubmit}
        onClick={() => onSubmit({ file, codesText, gender, bodytype })}
      >
        {submitting ? 'Starting…' : 'Generate from list'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire the panel + submit handler into the page**

In `Frontend/src/features/model-generation/pages/ModelGenerationPage.tsx`:

Add the import near the other imports:

```tsx
import { ArticleListPanel, type ArticleListSubmit } from '../components/ArticleListPanel';
```

Add a submit handler (place it beside the existing bulk-upload handler that posts to
`/model-generation/bulk/upload`, ~line 482). It reuses the existing job-polling state
by setting the same `jobId` the upload flow uses:

```tsx
  async function handleArticleListSubmit(payload: ArticleListSubmit) {
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token'); // match how the existing calls read the token
      const form = new FormData();
      form.append('gender', payload.gender);
      form.append('bodytype', payload.bodytype);
      form.append('imagesCount', '5');
      if (payload.file) form.append('list', payload.file);
      else form.append('codesText', payload.codesText);

      const res = await fetch(`${API_BASE}/model-generation/bulk/from-articles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start job');
      setJobId(data.jobId); // triggers the existing progress poller
    } catch (e: any) {
      alert(e.message || 'Failed to start article-list job');
    } finally {
      setSubmitting(false);
    }
  }
```

> Match the real local variable/state names used by the existing handler in this file
> (`submitting`/`setSubmitting`, `jobId`/`setJobId`, and the token accessor). If the
> file uses a context/auth hook instead of `localStorage.getItem('token')`, use that
> same accessor — grep the file for `Bearer` to copy the exact pattern.

Render a simple mode toggle above the existing "Generation Settings" card so the user
can switch between "Upload Garments" (existing) and "From Article List" (new), showing
`<ArticleListPanel submitting={submitting} onSubmit={handleArticleListSubmit} />` in the
new mode. Reuse the existing results/progress panel unchanged for both modes.

- [ ] **Step 3: Type-check the frontend**

Run: `cd Frontend && npm run build`
Expected: build succeeds with no TypeScript errors. (If `build` is heavy, run the
type-check step your project uses — check `Frontend/package.json` scripts for `tsc`.)

- [ ] **Step 4: Manual smoke**

Start backend + frontend, open the Model Generation page, switch to "From Article
List", paste 2 real codes, tick the checkbox, click "Generate from list". Confirm the
progress panel appears and tasks complete, with output URLs pointing at the
`model-images` public base.

- [ ] **Step 5: Commit**

```bash
git add Frontend/src/features/model-generation/components/ArticleListPanel.tsx Frontend/src/features/model-generation/pages/ModelGenerationPage.tsx
git commit -m "feat(ui): 'From Article List' panel for bulk model generation"
```

---

## Task 11: Full-run runbook (documentation, no code)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-model-generation-from-article-list.md` (this section is the runbook)

- [ ] **Step 1: Confirm the de-risk gate passed** — Task 9 probe shows source images FOUND.
- [ ] **Step 2: Set throughput** — `MODELGEN_CONCURRENCY=3` (raise/lower per observed 429 rate).
- [ ] **Step 3: Kick off** the full `IMAGES PENDING.xlsx` via the UI (or curl with `-F list=@"IMAGES PENDING.xlsx"`).
- [ ] **Step 4: Monitor** via `GET /bulk/job/:id` and backend logs. Expect ~15–30h wall-clock for ~14k generations; a restart auto-resumes (`MODELGEN_AUTO_RESUME` default on).
- [ ] **Step 5: Review the not-found list** at the end — codes whose source image was absent in the APPROVED bucket. Re-run those separately if their images get added later.

---

## Self-Review

**Spec coverage:**
- §5.1 env → Task 1. §5.2 storageService → Task 2. §5.3 bulk service (5-view/three_quarter/r2key/concurrency/resume) → Tasks 3–7. §5.4 route → Task 8. §5.5 frontend → Task 10. §5.6 tests → Tasks 2, 3, 8 (smoke). §7 error handling (source-missing/429/restart) → Tasks 6, 7. §8 scale (concurrency) → Task 7. §9 pre-flight probe → Task 9. §10 out-of-scope respected (no skip-if-exists, no DB writeback, no per-article gender). All covered.

**Type consistency:** `viewsForCount`, `createArticleJob`, `fetchApprovedImage`, `uploadModelImage`, `sourceKeyFor`, `outputKeyFor`, `BulkTask.kind/'file'|'r2key'`, `articleCode`, `sourceKey`, `sourcePath?` are named identically across Tasks 2–10. `imagesCount='5'` string is consistent (route default, `viewsForCount`, frontend form).

**Placeholders:** none — every code step shows full code; the one intentional human input is pasting real codes into the Task 9 probe (called out explicitly).

**Known adaptation:** frontend variable/token accessor names must be matched to the existing page (flagged in Task 10 Step 2) since the full current page body was not quoted here.
