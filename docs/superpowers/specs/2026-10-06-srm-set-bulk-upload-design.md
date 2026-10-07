# SRM set article — bulk folder upload with AI sorting (design)

Date: 2026-10-06 · Owner: Piyush · Status: approved in chat, awaiting spec review

## Goal
A vendor presentation holds ~10 sets x 2-4 photos (20-40 photos). Uploading them must take minutes,
not a photo-by-photo session. Success: drop the set folders, the AI sorts every photo into
whole set / Top / other part with a major category, design numbers come from the folder name, and
the vendor types only price + garment weight per part and the shared details once per set.

## Scope
- SRM Lovable project V2-SRM (`a381fbb9-6fe5-4023-8259-c1b8bee9c82c`), preview only, no publish.
- Changed: `src/pages/srm/tabs/StockSubmissionForm.tsx`, `src/pages/srm/components/SetArticleCard.tsx`,
  new `src/pages/srm/components/SetFolderDropzone.tsx`, new `src/pages/srm/utils/setBulk.ts`,
  new edge function `supabase/functions/srm-set-classify`.
- Not changed: DB schema, submit / PRES numbering, `sync-presentation-to-mdm`, the Article Creation
  repo, the fast-track rail (`srm-fastppt-extract`), `types.ts`.

## Existing model this builds on
Set mode is on when the form's major category is a set category (`isSetCategory`: KURTI_ST, B_SUIT).
State: `sets: {id, name}[]` and `designs: DesignRow[]`; a set photo carries `setGroupId`, `setRole`
(`PARENT` | `TOP` | `PIECE`), `setDivision`, `setSubDivision`, `setMajorCategory`. The parent row is
derived (`deriveSetParents`: price and weight = sum of parts, other fields from the Top). Submit and
sync already send `set_group_id` / `set_role` / `set_name`. The bulk path only **creates this same
state**; everything after it is unchanged.

## 1. Entry
- In set mode, a "Bulk add sets" drop zone is shown above the set cards.
- Accepts several folders dragged at once (`DataTransferItem.webkitGetAsEntry`, read recursively one
  level) or a folder picker (`<input webkitdirectory>`). Rule: a folder that directly contains images
  is one set; a picked folder that contains only sub-folders yields one set per sub-folder.
- Each set = `{ id: crypto.randomUUID(), name: <folder name> }`. Images only, sorted by file name;
  existing `MAX_PHOTOS` (50 total) and `compressImageToLimit` apply; skipped files are reported in one toast.
- A folder with one image becomes a set with only a parent and a warning chip ("add parts").
- The existing manual "Choose whole-set photo" / "Add part" buttons stay.

## 2. AI: `srm-set-classify` edge function
- `POST { set_category, division, images: [{ key, mime, data }] }`, `data` = base64 JPEG thumbnail,
  longest side 768 px, made in the browser. Max 8 images per call.
- Auth: any signed-in SRM user (vendors use this form) — verify the JWT with `getClaims`; no staff check.
- Candidate categories: distinct `maj_cat` from `broader_menu_mirror` where `div = division`,
  excluding set categories (`KURTI_ST`, `B_SUIT` fragments). Read with the service role.
- One Gemini call (same key env, `FASTPPT_MODEL` default, temperature 0, same `withRetry` as
  fast-track). Prompt: the photos belong to one set; return JSON
  `[{ key, whole_set: bool, garment_count: int, part_kind: "TOP"|"BOTTOM"|"DUPATTA"|"OTHER", major_category }]`.
  Whole set = the photo showing all garments together; kurti / upper garment = TOP.
- Server normalisation: exactly one `whole_set` (if none: the photo with the highest
  `garment_count`, ties → the first; if several: keep the first); exactly one TOP among parts (if none: first
  part; if several: keep first, rest OTHER); `major_category` snapped to the candidates (same
  `snapToGrid` logic), else null.
- Response: `{ ok: true, items: [{ key, role: "PARENT"|"TOP"|"PIECE", part_kind, major_category,
  sub_div, div }], usd }`. `sub_div`/`div` come from the candidate row. No DB writes, no new table.
- Errors: `{ ok: false, error }` with 4xx/5xx; never throws raw.

## 3. Filling the form
- Rows are created at once with a fallback order: first image = PARENT, second = TOP, rest = PIECE;
  parts start with empty category. Set chip shows "AI sorting…".
- Classify calls run with at most 3 sets in parallel, 60 s timeout each.
- On response, each row's role / category / design number is overwritten **unless the user already
  changed that field** (track a per-row `touched` set for role, category, designNumber).
- Design numbers (`setBulk.ts`): parent = folder name; part = folder name + suffix by part kind:
  TOP `-T`, BOTTOM `-B`, DUPATTA `-D`, OTHER `-O`; a repeated kind gets a number (`-B2`).
- One-click switch: each part shows "Make whole set"; it swaps roles with the current parent (the old
  parent becomes a PIECE with empty category, the new parent takes the set category). If the swapped
  part was the TOP, the next part becomes TOP. Design numbers are recomputed for untouched rows.
- Chip states: "AI sorting…", "AI sorted" (hidden after 3 s), "AI failed — set roles manually".

## 4. Per-set details
- Each `SetArticleCard` gets a collapsible "Set details" strip: fabric, sizes, no. of colours,
  quantity, available date, sample size, PPT type, and an "Apply to parts" button that copies filled
  values to every part of that set.
- Per part only: price, garment weight, design number.
- Parent remains derived (`deriveSetParents`). The global Quick fill keeps working as today.

## 5. Errors and limits
- AI failure or timeout: fallback roles stay, toast names the set, vendor fixes roles by hand.
- Submit validation is unchanged (every part needs a major category; parent needs parts).
- Cost: one Gemini call per set (~10 per presentation); `usd` is logged to the function console.

## 6. Testing (preview)
1. Three KURTI_ST folders (whole set + kurti + plazo + dupatta) dropped together → 3 sets, correct
   roles, categories in the right division, design numbers `X`, `X-T`, `X-B`, `X-D`.
2. "Make whole set" swap and Top switch; AI result does not overwrite a field changed during sorting.
3. Per-set "Apply to parts" fills only that set.
4. Force an AI failure (bad set) → fallback roles + error chip, form still submittable after fixes.
5. Submit one presentation; in MDM `extraction_results_flat` each photo has the right
   `set_group_id`, `set_role`, `set_name` (read-only check).

## Out of scope / later
Fast-track set support, BRD SAP-side set flag / BOM, auto-filling attributes per part from the AI.
