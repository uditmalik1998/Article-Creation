# SRM set article — presentation folder bulk upload (design)

Date: 2026-10-09 · Owner: Piyush · Status: design approved in chat (sections 1-3), awaiting spec review
Supersedes: `2026-10-06-srm-set-bulk-upload-design.md` (same feature; adds a set category per set).

## Goal
A vendor presentation holds ~10 set articles x 2-4 photos. The uploader drops ONE presentation
folder; every sub-folder becomes one set article with its whole-set (parent) photo and part (child)
photos sorted by AI. One presentation may hold sets of DIFFERENT set major categories.
Success: for 10 sets x 3 parts the uploader drops the folder, confirms 10 categories, fills one
details strip per set, types price + weight per part, and submits — one PRES number, and the
existing MDM sync / Article Creation / SAP flow runs unchanged.

## Scope
- SRM Lovable project V2-SRM (`a381fbb9-6fe5-4023-8259-c1b8bee9c82c`), **preview only, no publish**
  (the set flow is already live on srm.v2retail.com; publishing this needs owner OK after testing).
- Changed: `src/pages/srm/tabs/StockSubmissionForm.tsx`, `src/pages/srm/components/SetArticleCard.tsx`,
  `src/pages/srm/utils/setBulk.ts` (+ its test), `supabase/functions/srm-set-classify/{index,normalize}.ts`
  (+ test). New: `src/pages/srm/components/SetFolderDropzone.tsx`, `src/pages/srm/components/SetDetailsStrip.tsx`,
  `src/pages/srm/utils/thumbnail.ts`, `src/pages/srm/utils/classifySet.ts`.
- Not changed: DB schema, submit / PRES numbering, `sync-presentation-to-mdm`, `types.ts`, the
  fast-track rail, the Article Creation repo, `setCategories.ts` list.

## What exists today (verified 2026-10-09)
- Form: one `division / subDivision / majorCategory` state; `setMode = isSetCategory(majorCategory)`;
  `sets: {id, name}[]`; each design row carries `setGroupId`, `setRole`, `setDivision`,
  `setSubDivision`, `setMajorCategory`; `catOf(d)` already resolves the category per design and
  submit + sync already send per-photo category, `set_group_id`, `set_role`, `set_name`.
  The parent row gets the form's `majorCategory` (form line ~554) and the card shows it as "(fixed)".
- Built, not wired: `setBulk.ts` (`groupFilesByFolder`, `renumberSet`, `normaliseSetRoles`,
  `applyClassification`, `makeWholeSet`, `setPartRole`, `markTouched`, `runPool`) with tests;
  `srm-set-classify` edge function v24 (parts only, no set category) with 6 Deno tests.
- `broader_menu_mirror` holds all 49 set categories (KIDS, LADIES, MENS).
- MDM / Article Creation link a set by `set_group_id` + `set_role`, not by the form category.

## 1. Upload and folder rules
- Section "2 · Set Details", a **"Bulk add sets"** drop zone between Quick fill and the first set card,
  shown in set mode. The top category is the **default** set category, no longer fixed for every set.
- Drag one or more folders, or click to pick a folder (`<input webkitdirectory>`; drag uses
  `webkitGetAsEntry`, read recursively). Every folder that directly holds images = one set named
  after that folder (`groupFilesByFolder`). Images sorted by file name; non-images skipped and listed
  in one toast; existing `MAX_PHOTOS` (50) and `compressImageToLimit` apply.
- A one-photo folder becomes a set with a parent only and an "add parts" warning chip.
- Manual "Add set" / "Choose whole-set photo" / "Add part" stay.
- Design numbers (`renumberSet`): parent = folder name; parts = folder + `-T` / `-B` / `-D` / `-O`,
  repeats numbered (`-B2`); editable, a hand-edited number is never overwritten.
- **Per-set category:** `sets` becomes `{ id, name, folder?, division, subDivision, majorCategory,
  catSource: "default" | "ai" | "user", catConfirmed: boolean, aiState }`. The parent row takes its
  set's category (not the form's). Each card shows a set-category picker (division cascade limited to
  set categories, `isSetCategory`) instead of "(fixed)". Manual "Add set" starts with the form's
  category, `catConfirmed = true`.
- `srm_presentations.major_category` keeps the form's top category (unchanged insert).

## 2. AI sorting (`srm-set-classify`, extended)
- Request adds nothing new from the browser: `{ set_category (default), division, images[] }`
  (max 8, 768 px JPEG thumbnails). Server builds two candidate lists from `broader_menu_mirror`
  for `division`: **set candidates** (`isSetCode` true) and **part candidates** (`isSetCode` false).
- One Gemini call per set returns per photo `{ key, whole_set, garment_count, part_kind,
  major_category }` plus one `set_category` for the set. `set_category` is snapped to the set
  candidates (`snapToGrid`), else the request's `set_category`. Response adds
  `set: { major_category, sub_div, div, source: "ai" | "default" }`.
- Normalisation unchanged (exactly one whole set, exactly one Top, part categories snapped).
- Browser: at most 3 sets in parallel (`runPool`), 60 s timeout; `applyClassification` never
  overwrites a touched role / category / design number; the set category is applied only if the
  user has not picked one.
- **Confirmation:** an AI-set category shows an amber "AI picked — check" chip; ✓ or picking a
  category sets `catConfirmed = true`. **Submit is blocked** while any set has `catConfirmed = false`,
  naming those sets.
- Changing a set's category to another division re-runs `srm-set-classify` for that set with the
  new division (parts' categories re-sorted unless touched).
- Failure / timeout: set keeps the default (top) category with `catConfirmed = true`, since the
  user chose it; roles by file order (1st = parent, 2nd = Top), red chip
  "AI failed — set roles manually"; other sets unaffected.
- Auth: signed-in user (JWT `getClaims`), as today. No DB writes. Cost: one call per set.

## 3. Details per set and per part
- Per part: Price, Garment Weight, Design Number.
- Per set: collapsible "Set details" strip (`SetDetailsStrip`) — Fabric, Sizes, No. of Colors,
  Delivery Date, Sample Size, PPT Type — "Apply to parts" copies filled values to that set's parts only.
- Quick fill → Apply to all and Approved By unchanged. Parent row stays derived
  (`deriveSetParents`: price and weight = sum of parts, rest from the Top), read-only.
- Submit validation unchanged plus the confirmation rule above.

## 4. Testing (preview)
1. Unit: `setBulk` tests extended (per-set category, confirmation, folder with sub-folders);
   `normalize` Deno tests extended (`set_category` snapping, fallback to default).
2. Drop one presentation folder with 3 sub-folders — a Ladies kurti set, a second kurti set, a
   co-ord set — top division LADIES: 3 set cards named after the sub-folders, each with an
   AI-picked category + amber chip, correct whole set / Top, design numbers `X`, `X-T`, `X-B`, `X-D`.
3. Submit with one unconfirmed set → blocked with its name; confirm → submits, one PRES number.
4. Change one set to a KIDS category → its parts re-sorted to KIDS categories.
5. Force an AI failure → fallback roles + red chip, still submittable after fixes.
6. Read-only checks: SRM `srm_presentation_images` rows have per-set `major_category`,
   `set_group_id`, `set_role`, `set_name`; MDM `raw_articles` / `extraction_results_flat` match.
7. Regression: manual set upload and a normal (non-set) upload still work.

## Out of scope
Set categories from folder names, mixing divisions in one AI call, fast-track rail, SAP-side
set flag / BOM, auto-filling attributes per part from the AI, publishing.

## Amendment 2026-10-15 — the Set MC Master replaces the hard-coded set lists
MDM's set master (`set_mc_master` in the MDM DB, Admin > Set MC Master) now decides what is a set and
which parts each set allows. Changes to this design:
- **"Is a set" / set categories** come from the master through `srm-set-master` (hook `useSetMaster`);
  `isSetCategory`, `SET_MAJOR_CATEGORIES` and `SET_CATEGORY_FRAGMENTS` no longer exist.
- **Set category per set card** is picked from the master's active sets: `DivisionCascadeSelect`
  `onlyCategories={setMaster.setCategories}` (the `filterCategory` prop in section 1 is `onlyCategories`).
- **Part pickers** list only the parts the card's own set allows (`onlyCategories` = that set's allowed parts).
- **AI sorter** (`srm-set-classify`): the set candidates are the master's active sets that exist in the
  chosen division; part candidates are the union of those sets' parts, then `restrictToSet` clears any part
  category the chosen set does not allow (the uploader picks one). Response adds `set`.
- **Submit** checks each set against its own category: it is an active set, has allowed parts, and every
  part category is one of them (plus the "AI picked — check" confirmation).
- Sets whose category has no parts in the master (M_SUIT, MW_TRACK_SUIT, IB_ROMPER_SUIT) cannot be submitted.
