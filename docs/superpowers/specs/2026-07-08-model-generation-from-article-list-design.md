# AI Model Generation — "From Article List" (bulk, Cloudflare-sourced)

**Date:** 2026-07-08
**Status:** Approved design — ready for implementation plan
**Author:** Udit Malik

## 1. Goal

Add a second input mode to the existing **AI Model Generation** page. Instead of
uploading garment image files, the user uploads/pastes a **list of article codes**
(e.g. `IMAGES PENDING.xlsx`, one column `FINAL ART`, ~2,829 rows of the form
`{articleNumber}-{COLOR}` such as `1110097922-BLACK`).

For each code the system:
1. Pulls the existing source garment image from the **article-master (APPROVED) R2 bucket**.
2. Generates **5 Myntra-style model views** with Gemini.
3. Stores the outputs in the new **`model-images`** Cloudflare R2 bucket.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Source of garment image | APPROVED R2 bucket, key = **`{FINAL_ART}.jpg`** (full string incl. color) |
| Output location | New **`model-images`** bucket, key = **`{FINAL_ART}/{view}.jpg`** (folder per article) |
| Views (5, Myntra-style) | `front`, `back`, `side`, `three_quarter`, `closeup` |
| Model / framing settings | **One global** Gender + Body Type for the whole batch |
| Re-run behaviour | **Always regenerate & overwrite** |
| Restart safety | Worker **resumes unfinished tasks** on restart (job state persisted) |
| Throughput | **3 concurrent** Gemini calls + adaptive backoff (env-tunable) |
| Colour handling | **Preserve source colour** — `FINAL ART` already encodes the variant, no recolor |

## 3. Context — why source is the bucket, not the DB

Verified against the live database (2026-07-08): the `FINAL ART` codes are existing
**SAP master articles** and are essentially absent from this app's DB
(`article_360_flat` has 23,996 rows but only ~63–91 start with `1110…`; where
`image_url` is set it is UUID-named `.../srm-images/...` or `.../fashion-images/...`,
not keyed by article number).

Their images live in the **article-master (APPROVED) R2 bucket**, which
`storageService.uploadApprovedImageFromSourceUrl()` writes as
`{sanitizedArticleNumber}.{ext}` at the bucket root
(see `Backend/src/services/storageService.ts:427`). Because the sanitizer preserves
`-`, the key for `1110097922-BLACK` is `1110097922-BLACK.jpg`.

## 4. Reused components (unchanged)

- `runSingleGeneration()` — the Gemini fashion-model call — `Backend/src/services/modelGenerationService.ts`
- Job engine (queue, retry/backoff, cancel, progress, disk persistence) — `Backend/src/services/modelGenerationBulkService.ts`
- Status / cancel / download-zip endpoints — `Backend/src/routes/modelGenerationBulk.ts`
- R2 client + TLS-interception workaround — `Backend/src/services/storageService.ts`
- The existing job-progress UI on the Model Generation page

## 5. New / changed components

### 5.1 Environment (`.env` + `Backend/.env.example`)
Add the `model-images` bucket credentials:
```
MODEL_IMAGES_R2_ACCOUNT_ID=...
MODEL_IMAGES_R2_ACCESS_KEY_ID=...
MODEL_IMAGES_R2_SECRET_ACCESS_KEY=...
MODEL_IMAGES_R2_BUCKET_NAME=model-images
MODEL_IMAGES_R2_PUBLIC_URL_BASE=https://pub-....r2.dev
```
Tunables (with defaults): `MODELGEN_CONCURRENCY=3`, reuse `GEMINI_MIN_GAP_MS`,
`GEMINI_MAX_ATTEMPTS`.

### 5.2 `storageService.ts`
- `fetchApprovedImage(key: string): Promise<{ buffer: Buffer; mime: string } | null>` —
  `GetObject` from the APPROVED bucket; returns `null` on `NoSuchKey`/404.
- Third S3 client for `model-images` (built from `MODEL_IMAGES_R2_*`, falling back
  to primary creds when a shared account is used).
- `uploadModelImage(key: string, buffer: Buffer, mime: string): Promise<string>` —
  `PutObject` to `model-images`, returns the public URL.

### 5.3 `modelGenerationBulkService.ts`
- Extend `BulkTask` with a source kind: existing `file` (local path) **plus** `r2key`
  (source key in APPROVED bucket) and the owning `articleCode`.
- Add the **5-view mode** (`imagesCount = '5'` → `['front','back','side','three_quarter','closeup']`).
  Add `three_quarter` to `buildPrompt`'s view map (rename existing `left_side` → `side`
  in the 5-view path; keep the legacy 4-view set intact for the upload flow).
- Worker per `r2key` task: `fetchApprovedImage({code}.jpg)` → (if null → FAIL with
  "source not found") → `runSingleGeneration(view)` → `uploadModelImage({code}/{view}.jpg)`
  → `outputUrl` = model-images public URL. **No local disk write** for this mode.
- **Concurrency pool = 3** (env `MODELGEN_CONCURRENCY`) with the existing adaptive
  429 backoff; keep a minimum start-gap as a floor.
- **Restart-resume**: on `rehydrateJobsFromDisk`, re-queue `PENDING`/`RUNNING` tasks of
  unfinished jobs instead of marking the job `FAILED`.

### 5.4 New route — `POST /bulk/from-articles` (in the bulk router)
- Accepts the list as a `.xlsx`/`.csv` upload **or** pasted text, plus `gender`,
  `bodytype`, `imagesCount=5`.
- Parses the `FINAL ART` column → trim, drop blanks/header, **dedupe** → `codes[]`.
- Creates a job (tasks = `codes × 5 views`, kind `r2key`), returns `202 { jobId, totalArticles, totalTasks }`.
- Reuses existing `GET /bulk/job/:id`, `POST /bulk/job/:id/cancel`, `GET /bulk/job/:id/download-zip`.

### 5.5 Frontend — new "Generate from Article List" section
- Drag-drop `.xlsx`/`.csv` **or** paste textarea; shows parsed count
  ("2,829 articles → 14,145 images").
- Checkbox: **"Generate model images & store to model-images bucket."**
- Global Gender + Body Type selectors (as today).
- Submit → `/bulk/from-articles` → reuse the existing live progress panel; each row
  links to its 5 `model-images` URLs; a **"source not found"** list surfaces skips.

### 5.6 Tests
- Unit: list parser (xlsx + paste → codes; dedupe/trim/header-strip), source-key
  builder, output-key builder.
- Unit (mocked S3): `fetchApprovedImage` 404 → null; `uploadModelImage` returns URL.
- Integration: 2–3 real codes end-to-end against a test/model-images bucket before the
  full run.

## 6. Data flow

```
list (xlsx/paste) → parse → codes[]
  → job(tasks = code × 5 views, kind=r2key)
    worker (×3, adaptive backoff):
      GET  APPROVED/{code}.jpg        (null → task FAILED "source not found")
      →   runSingleGeneration(view)   (Gemini, preserve source colour)
      →   PUT model-images/{code}/{view}.jpg
      →   outputUrl + progress
```

## 7. Error handling

- **Source missing** (`{code}.jpg` not in APPROVED bucket) → task `FAILED`
  ("source image not found in article-master bucket"); batch continues; shown in a
  not-found list.
- **Gemini 429 / rate limit** → existing exponential backoff + retry (max attempts).
- **Upload failure** → retried within the task's attempt budget.
- **Server restart** → unfinished tasks re-queued on rehydrate (§5.3).

## 8. Scale & cost

- 2,829 articles × 5 views = **14,145 generations**.
- Concurrency 3 → est. **~15–30 h** continuous (restart-safe for background runs).
- Gemini cost/quota is material at this volume — confirm the API tier sustains ~3
  concurrent image-gen calls; engine throttles on 429.

## 9. Pre-flight de-risk

Before the full 2,829 run: a tiny **probe** (≈10 codes) confirming
`{FINAL_ART}.jpg` exists in the APPROVED bucket and end-to-end write to `model-images`
succeeds. Cheap insurance against a wrong key assumption wasting hours.

## 10. Out of scope

- Skip-if-exists / idempotent mode (explicitly chose overwrite).
- Writing generated URLs back into the DB / SAP (not requested).
- Per-article gender auto-derivation (chose one global setting).
