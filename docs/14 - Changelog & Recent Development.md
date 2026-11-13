# Changelog & Recent Development

> Rolling log of significant development. Newest entries first.
> Detailed subsystem docs live in the numbered notes ([[00 - Index]]); this note records *what changed and when*.

---

## 2026-11-13 — FG FAB card: picking FABRIC ARTICLE NO. no longer changes the FAB attributes

- Selecting a row in the FABRIC ARTICLE NO. dropdown now sets only `fabricArticleNumber` + `fabricArticleDescription`. M_FAB_DIV, M_YARN, MVGR 1/2, CONSTRUCTION, OUNZ, WIDTH, WEAVE 1/2, COUNT, COMPOSITION, FINISH, GSM, LYCRA stay as the user set them (was: all overwritten, empty values cleared). Same as the DESC dropdown (which also sets AUTO-BGT).
- Typing a number + Enter is unchanged (saves the number only). Frontend only (ApproverArticleList.tsx).

## 2026-11-13 — FG FAB card: FABRIC ARTICLE NO. / DESC search Fabric Article › Created rows

- `searchFabricArticleData` (`/approver/fabric-article-data/search`) now reads `fabric_article_data` where `fabric_article_type = 'Fabric Article'` and `approval_status = 'APPROVED'` (the Fabric Article › Created page rows, 205 today) instead of `precise_fabric_article_data`.
- Text search: description contains the text, or the fabric article number starts with the typed digits (was: exact number). Attribute search (`byAttrs=1`) unchanged, same filter applied.
- Unchanged (still `precise_fabric_article_data`): the no-result attribute rate fallback inside the same endpoint and `/fabric-article-data/rough-v2-rate`.
- Backend only.

## 2026-11-13 — FG Save & Submit requires PKG COST saved first

- Save & Submit is blocked with "PKG COST: not saved (click Save on the PKG COST card)" until the user saves PKG COST with the card's own Save button. The default rates the card shows don't count, and typed-but-unsaved values block too (the mandatory check runs before the unsaved-cards popup, so PKG is never auto-saved by Save & Submit).
- `PkgCostCard` publishes a live saved flag per article (`getLivePkgSaved` / `useLivePkgSavedVersion`, new `articleId` prop): saved tab and no unsaved edits. Card off screen → saved `pkgCostType` present.
- Files: PkgCostCard.tsx, ApproverArticleList.tsx, ArticleDetailPage.tsx. Frontend only.

## 2026-11-13 — FG Save & Submit requires B TRIM + V. ADD TOTAL ACT-V2

- Save & Submit is blocked with "B TRIM: TOTAL ACT-V2" / "V. ADD: TOTAL ACT-V2" when that card's TOTAL row ACT-V2 is empty (the typed override, else the sum of the row ACT-V2 values).
- Same pattern as CMP COST: `CostingGridCard` publishes the live total per article + card (`getLiveCostActTotal(articleId, totalField)` / `useLiveCostActVersion`, via the new `articleId` prop), so unsaved typed values count — Save & Submit saves the card first. When the card is not on screen, the saved `bTrimTotalRoughV2` / `vaddTotalRoughV2` is used.
- Files: CostingGridCard.tsx, ApproverArticleList.tsx (passes `articleId`), ArticleDetailPage.tsx (approveBlockedReasons). Frontend only.

## 2026-11-12 — FG Created page: M_FAB_VDR showed "Required" although the DB had a value

- Cause: `ApproverController.getItems` and `getById` use explicit Prisma `select` lists that never included `fabVdr` (column `m_fab_vdr`), so the page got `undefined`.
- New page hid it: the PENDING-only default effect fills NON-NOMINATED locally. Created (APPROVED) articles have no such default, so the mandatory row showed Required.
- Fix: added `fabVdr: true` to both selects (Backend/src/controllers/ApproverController.ts). Backend-only deploy.

## 2026-11-12 — Fabric Article › Created: "Uploader" toggle

- New switch next to the SAP SYNC chips (Created page only). On → list shows `fabric_article_type = 'UPLOADER'` rows (12,553 copied fabric master rows); off → normal SRM fabric articles. Starts off (or on with `?uploader=1`).
- Same source applies to the list, All / With variants exports and card → detail navigation (`source=UPLOADER`). Division tabs, filters, SAP SYNC chips and user scoping still apply.
- Backend: `buildFabricArticleDataWhere` — `source=UPLOADER` → `{ fabricArticleType: 'UPLOADER' }`.
- Files: `Frontend/src/features/fabric-article/pages/FabricArticleDashboard.tsx`, `Backend/src/controllers/ApproverController.ts`.

## 2026-11-12 — precise_fabric_article_data copied into fabric_article_data as UPLOADER (data only)

- INSERT … SELECT DISTINCT ON (fabric_article_number) from precise_fabric_article_data (latest id per number), skipping numbers already in fabric_article_data → **12,553 rows**.
- Set: fabric_article_type='UPLOADER', approval_status='APPROVED', approved_at=now(), sap_sync_status='SYNCED' (real SAP fabrics). number / vendor_code cast to text; all 14 m_* + desc, div, sub-div, MC, vendor, fabric_rate copied.
- Not shown on any page (FG pages = type FG, Fabric pages = source SRM). Effects: FG "Create Fabric Article" now finds these APPROVED descriptions and fills the existing number (409); fabric SAP creation blocks a new fabric whose description matches one of them.
- One-off copy: later Admin uploads of precise_fabric_article_data do not update these rows.
- Table now: UPLOADER APPROVED 12,553 · FG APPROVED 3,237 · FG PENDING 31 · Fabric Article PENDING 1,017 · Fabric Article APPROVED 194.

## 2026-11-12 — fabric_article_data: 346 orphan PENDING rows deleted (data only)

- User ran `DELETE … WHERE source IS NULL AND fabric_article_type IS NULL AND approval_status='PENDING'` — 346 rows (16 Sep–6 Oct 2026), shown on no page (not SRM, not FG). No variants; 14 FG articles keep the fabric numbers as text.
- Then the user also deleted the 406 broken rows (NULL source/type, approval_status holding attribute values like N_LYC / 2W_LYC — columns shifted by an old upload).
- Table now: FG APPROVED 3,230 · FG PENDING 31 · SRM Fabric Article PENDING 1,023 · SRM Fabric Article APPROVED 188 — every row is shown on a page.

## 2026-11-12 — fabric_article_data: SRM rows with NULL type → 'Fabric Article'

- `UPDATE fabric_article_data SET fabric_article_type='Fabric Article' WHERE fabric_article_type IS NULL AND source='SRM'` — 583 rows.
- Now: FG 3,260 (source NULL) · Fabric Article 1,211 (all SRM) · NULL 752 (source NULL, old rows, untouched).
- Code: `fabricRawDataService.ts` — new SRM fabric rows default to 'Fabric Article' when SRM sends no presentationsType (was NULL).

## 2026-11-12 — fabric_article_data: 'uploader' rows deleted (data only)

- User ran `DELETE FROM fabric_article_data WHERE fabric_article_type = 'uploader'` — 148 rows (22 APPROVED), no backup. Last written 2026-09-11 by an old Excel upload.
- Remaining types: FG 3,260 · NULL 1,335 · Fabric Article (SRM) 628.
- 11 FG articles in extraction_results_flat still hold those fabric article numbers (text only, no FK). precise_fabric_article_data (FABRIC ARTICLE DESC search) untouched.

## 2026-11-12 — fabric_article_master.div: Denim/Knits/Woven → D/K/W (data only)

- `UPDATE fabric_article_master` (run in Supabase): Denim → D (9 rows), Knits → K (72), Woven → W (61). No code change.
- Effect: Fabric Article Division dropdown now shows D / K / W, and new fabric articles store D / K / W (matches most of `fabric_article_data`, which already used single letters). Fabric user scoping matches on the first letter, so unaffected.
- Existing `fabric_article_data.division` values (Knits 464, Woven 650, Denim 1, KNITS 2, WOVEN 5) not changed.
- Note: Admin › Fabric Major Category upload replaces the whole table — a re-upload with full words brings them back.

## 2026-11-12 — FG FAB card: ACT-V2 mandatory + fills empty AUTO-BGT

- ACT-V2 (`roughV2`) row now has the red * on the FG FAB card; Save & Submit blocked with "ACT-V2" in the ⚠ list / popup when empty (`getMissingMandatoryFields` in ArticleDetailPage).
- Typing an ACT-V2 value while AUTO-BGT is empty saves the same value into AUTO-BGT in the same request (`handleSave`). AUTO-BGT with a value is never overwritten. Automatic ACT-V2 rate lookups don't trigger it.
- Files: `Frontend/src/features/approver/components/ApproverArticleList.tsx`, `Frontend/src/features/approver/pages/ArticleDetailPage.tsx`.

## 2026-11-12 — FG FAB card: VENDOR COST no longer auto-fills empty AUTO-BGT / ACT-V2

- Removed the "vendor-cost fallback" effect that copied VENDOR COST into AUTO-BGT and ACT-V2 (roughV2) when they were empty.
- AUTO-BGT / ACT-V2 still fill from their own lookups (fabric pick / attribute rate). Values already saved by the old fallback are left as they are.
- File: `Frontend/src/features/approver/components/ApproverArticleList.tsx`.

## 2026-11-12 — FG FAB card: FABRIC ARTICLE DESC dropdown searches by card attribute values

- Problem: the page rebuilds FABRIC ARTICLE DESC from the FAB values in its own order, while `precise_fabric_article_data.fabric_article_description` stores them in another order (e.g. 2111076553) → clicking the field showed "No Fabric Article found".
- Now: opening the field calls `GET /approver/fabric-article-data/search?byAttrs=1&mFabDiv=…` — rows whose columns **exactly** (case-insensitive) equal every filled FAB card value; empty card values skipped; up to 15 rows. User chose exact match only.
- Columns: m_fab_div, m_yarn, m_fab_main_mvgr_1/2, m_construction, m_ounz, m_width, m_weave_01/02, m_count, m_composition, m_finish, m_gsm, m_lycra.
- No card values yet → old text search on open. Typing still does the text search (desc contains / exact number); Enter fallback for AUTO-BGT unchanged.
- Update (same day): compares **every FAB row shown on the card** for the major category — an empty card value (e.g. M_FAB_DIV) only matches a NULL / '' column; rows hidden by the grid (e.g. M_GSM for M_W_TRSR) are not compared. Example d586e003…: card had M_FAB_DIV / M_WEAVE_01 empty but 2111078800 has K / JAQ → no longer listed.
- Picking a row from this dropdown now fills **only** FABRIC ARTICLE NO., FABRIC ARTICLE DESC and AUTO-BGT — FAB attributes (M_FAB_DIV, M_YARN, …) are no longer overwritten. FABRIC ARTICLE NO. dropdown still fills all attributes (unchanged).
- Files: `Backend/src/controllers/ApproverController.ts` (`searchFabricArticleData`, `FABRIC_ATTR_COLUMNS`), `Frontend/src/features/approver/components/ApproverArticleList.tsx` (`runFabAttrSearch`).

## 2026-11-11 — OTH GRID-1 text 1 px bigger (Cost Summary unchanged)

- Fixed rows (RATE / COST, MRP, colours, MARKDOWN, AFTER TAX): 12 → 13 px; MRP range hint 11 → 12 px. Body article Rough Consumption card unchanged (11 px).
- Business attr rows (M_AGE_GROUP … SEGMENT): new `plus1 = 2` level in `renderAttributeRow` (values 13 px, names 12.5 px); B TRIM extra rows keep `plus1 = true`.
- COST SUMMARY inside OTH GRID-1 deliberately **not** changed.
- Labels "Base Color" / "Secondary Color" → BASE COLOR / SECONDARY COLOR (FG card only).
- Secondary Color / MARKDOWN / AFTER TAX names now semibold (600) like M_AGE_GROUP (were 400; mandatory ones already 600). Body article card unchanged.
- File: `Frontend/src/features/approver/components/ApproverArticleList.tsx`.

## 2026-11-11 — OTH GRID-1 Cost Summary: 10% margin on TOTAL

- New **MARGIN 10%** row above TOTAL = 10% of each column's cost sum (FAB + BODY + B TRIM + V. ADD + PKG COST).
- TOTAL = cost sum × 1.10 in all 4 columns (AUTO-BGT / ACT-V2 / VDR COST / FINAL COST); empty column stays "—".
- UI only, nothing saved. File: `Frontend/src/features/approver/components/ApproverArticleList.tsx` (`MARGIN_PCT`).

## 2026-11-11 — OTH GRID-1 Cost Summary: FAB row no longer adds 4% wastage

- FAB row = FAB card cost × PR PC CONS. (was × 1.04). Applies to all 4 columns (AUTO-BGT / ACT-V2 / VDR COST / FINAL COST).
- Precise Costing Excel export still adds WST 4% — the two now differ by design.
- File: `Frontend/src/features/approver/components/ApproverArticleList.tsx` (cost summary block).

## 2026-11-11 — Login page shows the real reason instead of "Login failed: 401"

- backendApi.login threw `Login failed: <status>` before reading the body. Now it reads the server's error and shows:
  401 → "Invalid email or password", 403 → "Account is disabled — contact the admin", 400 → missing fields,
  429 → too many attempts, 5xx / non-JSON (proxy down) → "Server error (<code>) — please try again in a moment",
  network failure → existing "Unable to connect to server" (Login.tsx). The global 401 interceptor skips /login, so
  the toast isn't lost.

---

## 2026-11-11 — M_FAB_VDR now sent to SAP for FG generics

- It was never in the payload: buildRfcPayload sends a characteristic only if it's in a grid for the major category
  (maj_cat_mandatory_grid / maj_cat_grid_values have no M_FAB_VDR) or in RFC_ALWAYS_SEND_IF_PRESENT. Added 'M_FAB_VDR'
  to RFC_ALWAYS_SEND_IF_PRESENT (zmmArtCreationService) → sent whenever set (always, with the NON-NOMINATED default).
- Created-page Modify (buildModifyChangesPayload) sends it only when it has a value (no "" for older articles).
- Variants use their own payload — unchanged. Risk: if an FG SAP class doesn't have characteristic M_FAB_VDR, SAP may
  reject that article — test one article per class family after deploy.

---

## 2026-11-11 — "ACT" → "ACT-V2" on the FG article page

- FAB card row (CARD_LABEL_OVERRIDES rough_v2), B TRIM + V. ADD cost column (roughLabel), CMP COST stage header
  (STAGE_LABEL — stage key 'ACT' / cell keys / saved fields unchanged), OTH GRID-1 Cost Summary column + row tooltips,
  Save & Submit missing-field text "CMP COST: ACT-V2 TOTAL PR VAL" (+ matching data-field-label). Labels only.
- Then: Actual Consumption card → "ACT-V2 CONSUMPTION"; CMP COST BGT header → "AUTO-BGT" (STAGE_LABEL; key 'BGT' unchanged).
- FG FAB card: M_FAB_VDR moved to just below M_LYCRA (ApproverArticleList ATTRIBUTE_GROUPS; Fabric page order unchanged).

---

## 2026-11-11 — Prod fix: "Failed to update item" (fab_vdr rename) + M_FAB_VDR leaking into FABRIC ARTICLE DESC

- Commit 72b55e6 (Prisma fabVdr @map("m_fab_vdr")) went live before the DB rename → every PUT /approver/items/:id with
  fabVdr failed ("Failed to update item"). Ran `ALTER TABLE extraction_results_flat RENAME COLUMN fab_vdr TO m_fab_vdr`
  on Supabase (verified: column is m_fab_vdr) — saves work again.
- Bug from the M_FAB_VDR default: FG FAB_FIELDS (FABRIC ARTICLE DESC parts) included fabVdr, so descriptions got
  "-NON-NOMINATED-". Excluded fabVdr (also no longer clears Fabric Article No. on change). Fixed the one saved row
  (95ff0c75…, pending, no fabric number): "K-CP-E_STP-NOMINATED-SJ-…" → "K-CP-E_STP-SJ-…". Needs a frontend deploy;
  until then the live frontend keeps adding it.

---

## 2026-11-11 — extraction_results_flat.fab_vdr → m_fab_vdr (DB renamed same day, see prod fix above)

- Prisma ExtractionResultFlat.fabVdr now @map("m_fab_vdr"); field name unchanged so no code changes. No views,
  functions, indexes or raw SQL use the column (the other "fab_vdr" hits are Gemini attribute keys).
- SQL: Backend/prisma/migrations/20261111_rename_fab_vdr_to_m_fab_vdr_extraction_results_flat.sql — run it together
  with the backend deploy (old backend reads fab_vdr, new one m_fab_vdr; either side breaks FG pages until both match).
- Not touched: Article360Flat.fab_vdr, reference_article_data.fab_vdr, Snowflake copy.

---

## 2026-11-11 — B TRIM card: ROUGH-V2 column header → ACT

- CostingGridConfig.roughLabel (default "ROUGH-V2"); BTRIM_CONFIG sets "ACT". Header + TOTAL cell label only —
  same fields (*RoughV2, b_trim_total_rough_v2), fill rules and exports. V. ADD renamed to ACT the same day (roughLabel).
- FG FAB card row ROUGH-V2 → ACT too: ApproverArticleList CARD_LABEL_OVERRIDES { rough_v2: 'ACT' } (card label only;
  SCHEMA_KEY_TO_EXCEL_ATTR keeps 'ROUGH-V2' for grid lookups / exports). OTH GRID-1 Cost Summary column ROUGH-V2 → ACT too.

---

## 2026-11-11 — FG BODY tab: "Rough Consumption" → "AUTO-BGT Consumption", "Precise Consumption" → "Actual Consumption"

- Card titles only (ApproverArticleList, FG BODY tab). Fields / DB columns (rough_consumption_*, precise_consumption_*),
  fill rules and exports unchanged. Body Article page cards keep their old titles.

---

## 2026-11-11 — FG FAB card: M_FAB_VDR always shown, mandatory, NOMINATED / NON-NOMINATED (default NON-NOMINATED)

- No grid had any M_FAB_VDR values, so the row was hidden on FG cards. ApproverArticleList now always shows it on FG
  (not body pages) with fixed options NOMINATED / NON-NOMINATED (user's exact spelling, sent to SAP as M_FAB_VDR).
- Default: a PENDING FG article opened with M_FAB_VDR empty (or "-") gets NON-NOMINATED set and auto-saved (not in
  Created/modify mode, not on approved articles). The user can switch to NOMINATED.
- ArticleDetailPage Save & Submit: "M_FAB_VDR" required (skipped for a set parent — it copies the Top piece's value).

---

## 2026-11-11 — Fabric Article FAB card: same row order as the FG FAB card

- FabricArticleList ATTRIBUTE_GROUPS FAB order now matches ApproverArticleList: FAB_DIV, YARN, MVGR_1, MVGR_2, fab vendor,
  WEAVE_01, WEAVE_02, COUNT, GSM, OUNZ, CONSTRUCTION, COMPOSITION, FINISH, WIDTH, LYCRA (shade/weight hidden).
  Was FAB_DIV, YARN, MVGR_1, MVGR_2, CONSTRUCTION, WIDTH, WEAVE_02, COUNT, WEAVE_01, COMPOSITION, FINISH, GSM, LYCRA, VDR, OUNZ.
- Display only: Fabric Article Desc keeps its own FAB_DESC_SEQUENCE_KNITS / _WOVEN_DENIM order; visibility / mandatory
  still from the grids.

---

## 2026-11-11 — FG Save & Submit requires CMP COST ACT TOTAL PR VAL

- User choice: only ACT TOTAL PR VAL (sum of the ACT PR VALs, or a typed TOTAL) is required; it blocks Save & Submit
  only — the card's own Save still works with ACT empty. Other "Req." cells stay hints.
- ArticleDetailPage approveBlockedReasons checks every pending item (set parent + pieces): the card's live ACT TOTAL
  (CmpCostCard publishes it — getLiveCmpActTotal + useLiveCmpActVersion (useSyncExternalStore) re-runs the check on
  every change, so typed-but-unsaved values count; Save & Submit saves them first) or, when the card isn't on screen,
  the saved total / ACT PR VALs. Missing → "CMP COST: ACT TOTAL PR VAL" in the ⚠ badge, its hover list and the
  popup; clicking it jumps to the card's TOTAL row (data-field-label).
- First version checked only at click time, so the ⚠ hover list didn't show it (user report) — fixed same day.

---

## 2026-11-06 — FG Reference & vendor card: vendor only from the dropdown

- Bug: typed VENDOR NAME was saved as-is on blur (New page), and any 6-digit VENDOR CODE too — e.g. aa8618e1…
  has vendor_name "abc" (not in master_vendor_details) with code 200681.
- ApproverArticleList: both Autocompletes now only save through pickVendor (name + code together from the vendor
  master). Leaving the box with typed text keeps the old vendor (`dropTypedVendor`) and warns "Pick a vendor from the
  list — typed text is not saved." (no warning right after a pick). New and Created (modify) pages alike.
- Existing typed names aren't changed — re-pick the vendor to fix them.

---

## 2026-11-06 — GM Save & Submit: Division, Sub-division, Major category, MC description mandatory

- GMArticleDetailPage approveBlockedReasons: DIVISION, SUB-DIVISION, MAJOR CATEGORY, MC DESCRIPTION, DESIGN NUMBER are now checked for
  every GM article (MC DESCRIPTION was FG-mode only); a missing one opens the "mandatory fields missing" popup and
  nothing goes to SAP. GMArticleList Article details card shows the red * on those four labels.
- Save & Submit on the detail page is the only GM submit path (/approver/gm-articles/submit).

---

## 2026-11-06 — FG Precise Consumption in Meter: manual only (no auto-fill)

- User request: the Precise Consumption card's Consumption in Meter is no longer fetched from
  precise_body_article_consumption on M_WIDTH change / open. The user types it; Kg is still derived
  (width × GSM × meter × 2.54 / 100000) — on typing, on GSM change, on width change, and backfilled on open if missing.
- Removed the precise by-width fetch effect + applyPreciseUpdates (ApproverArticleList). The backend by-width endpoint
  stays (the Rough card uses it with exact=1). Saved meters are unchanged.

---

## 2026-11-06 — FG typed MRP snaps to a multiple of 25

- ApproverArticleList handleSave (mrp, FG): a typed MRP is snapped by `snapFgMrp` before the 15–50% check — next
  multiple of 25 up (310 → 325); if that passes 50% markdown, the multiple below (rate 211: 420 → 400); if neither fits
  (small rates) the typed value is kept and the check decides. Silent — no toast (user request), the field just shows it.
  Segment is derived from the snapped MRP.

---

## 2026-11-05 — Rough Consumption meter from the picked body article's exact width

- FG Rough Consumption card: when the article has a body article, Consumption in Meter = that body article's
  precise_body_article_consumption value at the width's own column (e.g. width48); if that cell is empty (or the body
  article isn't in the same major category) it falls back to the existing body_fabric_consumption logic
  (major category + width, else the category's lowest). Kg recomputed as before.
- Runs when M_WIDTH changes or a body article is picked (effect key now majCat:width:bodyArticle). Opening an article
  still never overwrites a saved meter — re-pick the body article to refresh an old one.
- Backend: GET /approver/precise-body-article/by-width?exact=1 → own width column only (no earlier-column fallback).
- e.g. 12273faf… (48", body 2176014819001): 0.245 (M_W_SHIRT_FS rough) → 1 (width_48) after re-picking.

---

## 2026-11-05 — Precise consumption by width: empty width falls back to the earlier column

- GET /approver/precise-body-article/by-width (getPreciseConsumptionByWidth, fills the FG Consumption in Meter from
  precise_body_article_consumption): the width's own column, else the nearest EARLIER (narrower) column with a value
  (48 → 46 → 44 → 43 …), else the nearest later one. Was: minimum value across all 39 width columns.
  Response also returns `widthUsed`. e.g. 2176021922001 at 48": 0.822 (old min) → 0.988 (width 46).
- 2,166 of 2,169 rows have no 48" value; 43 of them get a value from an earlier column.

---

## 2026-11-05 — CMP COST: picking a body article fills BGT (not ACT)

- User: picking BODY ARTICLE NO. / DESC must fill BGT only, overwriting every BGT cell; ACT is no longer auto-filled.
- ApproverArticleList: fetchCmpBodyBgtPreset (precise_body_article_consumption → BGT SAM / SAM VAL / PR VAL);
  refreshCmpBgtFromBody on both body pickers (all BGT cells replaced, card shows Unsaved changes until Save).
  On open, empty BGT cells fill from the article's body article, else rough_cmp_cost_master by major category; saved
  values win. ACT preset effect, state and prop removed.
- Summary Costing export (ApproverController) follows the card: BGT preset = body article, else major category;
  ACT uses saved values only.

---

## 2026-11-05 — FG OTH GRID-1: MRP from 30% markdown, rounded up to 25; markdown limit 15–50%

- RATE now fills MRP = rate ÷ (1 − 0.30), rounded UP to the next multiple of 25 (rate 100 → 142.86 → 150;
  105 → 150; 110 → 175; 999 → 1450). Was rate × 1.3. Same on page load when no MRP is saved.
- A hand-typed MRP is rejected (toast, not saved) unless its markdown (MRP − rate) ÷ MRP is 15–50%
  (rate 100 → MRP 117.65–200). Check runs on save (blur / Enter), FG only (ApproverArticleList handleSave).
- Not changed: MRPs already saved, GM BOM card (still rate × 1.3), backend (no server-side check).
- Auto MRP also obeys 15–50% (user found rate 1 → MRP 25 = 96%): next 25 if markdown ≤ 50%, else the lower 25 if
  ≥ 15%, else the unrounded rate ÷ 0.70 (rate 1 → 1.43, 20 → 25, 22 → 31.43, 40 → 75). Checked 1–999: all in range.
- Friendlier rejection: notification "MRP ₹3 not saved — markdown 66.7% is too high" + "Markdown must be between 15% (min)
  and 50% (max). For Rate ₹1, enter an MRP from ₹1.18 to ₹2." While editing MRP the label shows
  "Allowed ₹117.65 – ₹200 (markdown 15–50%)" (helpers fgMrpRange / fmtRs).

---

## 2026-11-05 — Admin › Expenses › Fabric & body: new "Fabric Grid Values" card

- New card for `fabric_maj_cat_grid_values` (529 values, 14 characteristics — the Fabric FAB dropdowns M_FAB_DIV,
  M_YARN, M_COMPOSITION, WEAVE-01 …): Download, Template, Upload, View Data, Refresh. Group count 5 -> 6.
- Backend (adminController): GET /admin/fabric-grid-values/status|template|download, POST /upload. One Excel layout for
  all three (sheet FABRIC GRID VALUES, title row 1, headers CHARACTERISTIC | CODE | FULL FORM in row 3, data from row 5),
  so a downloaded file can be edited and re-uploaded (verified: 529 rows read back).
- Upload replaces the whole table in a transaction; incomplete / too-long rows and duplicate (characteristic, code)
  pairs are skipped and counted; a file with no valid rows is rejected without touching the table.
- View Data config `fabric-grid-values` added on both sides (adminController table config + expenseTables.ts).

---

## 2026-11-05 — Admin › Expenses: "Fabric Article Master" card renamed "Fabric Major Category"

- User asked for a new Fabric Major Category card (Download / Template / Upload) on fabric_article_master; the existing
  "Fabric Article Master" card in the Fabric & body group already does exactly that (142 major categories), so it was
  renamed instead of duplicated (user's choice). Card title, empty-state text, upload heading, View Data title
  (expenseTables.ts) and download names (FABRIC_MAJOR_CATEGORY_<date>.xlsx / FABRIC_MAJOR_CATEGORY_TEMPLATE.xlsx).
- Endpoints (/admin/fabric-article-master/*), upload format and sheet names unchanged.

---

## 2026-11-04 — Fabric Created page "All" Excel: no SAP Sync Status, Approved By at the end

- FabricArticleDashboard handleExportAll on the Created tab drops the "SAP Sync Status" column and adds "Approved By"
  (approver's name) as the last column. Other tabs / With variants / Select page unchanged.
- Backend getFabricArticleDataExportAll now also selects approved_by and returns `approvedByName` (users lookup).
- approved_by is only saved since 2026-10-28, so 616 of 2,910 created Fabric articles show a name; older rows are blank.
- Fabric Article page download names: Fabric-Article-<Tab>[-Variants|-Selected][-<division>]-<date>.xlsx
  (e.g. Fabric-Article-Created-2026-11-04.xlsx) via exportToExcel options.fileBaseName.

---

## 2026-11-04 — GM Created page Excel downloads use GM data

- Bug: GMArticleDashboard's All / With variants / Select-page export was copied from the Fabric page — Fabric headers
  (M_FAB_DIV, Fabric Rate, …) and the FG endpoint `/approver/items/export-all`, so the file had nothing to do with GM.
- New `GET /approver/gm-articles/export-all` (ApproverController.exportGmArticles; same filters + GM sub-division scope as
  the list via new `applyGmSubDivScope`): gm_article_data rows, no paging; `ids=` for ticked cards; `withVariants=1`
  interleaves each generic with its SAP-created gm_variants_article_data rows (variant inherits the generic's attributes,
  like FG). Approved By name looked up from users.
- Excel columns: article / hierarchy / status / vendor / PPT / Rate, MRP, Rough V2, Vendor Cost, Final Cost / segment /
  dates / Approved By (+ Row Type, Parent Article Number, Variant Color, Variant Size with variants), then every GM_*
  attribute code that has a value in at least one exported row.
- Created tab today: 299 generics; With variants adds 106 SAP variant rows (82 articles).
- With variants layout: Parent Article Number, Variant Article Number (empty on the generic row), Variant Color,
  Variant Size lead (row colours per group were tried and removed at the user's request). Shared `exportToExcel`
  got an optional `options.fileBaseName` (exact name, no "fashion-extraction-" prefix).
- GM file names: GM-Created-Article[-Variants|-Selected][-<division>]-<date>.xlsx (other tabs GM-New-Article etc.).

---

## 2026-11-04 — Column drops applied in Snowflake; Supabase partly

- Snowflake `V2RETAIL.ARTICLE_CREATION.EXTRACTION_RESULTS_FLAT` (one-time manual load of approved rows, no sync job,
  no views): dropped size, article_type, macro/main/m_fab2 *_full_form, generic_article_id, variant_color,
  variant_size, variant_weight, pd_status (363 -> 353 columns, 29,919 rows kept). image_name was never there; weight kept.
- Supabase: image_name indexes + trigger change already applied by the user (table 248 -> 226 MB). Still pending:
  the generic_article_id + idx_erf_approval_pd indexes, and all column drops (only after the backend is deployed).

---

## 2026-11-04 — extraction_results_flat: size, article_type, MVGR full forms, pd_status removed from code

- At the user's request. Removed from the Prisma model (+ `PdStatus` enum, `idx_erf_approval_pd`) and all code:
  FG list / export / getById / SAP-sync selects, ITEM_UPDATE_ALLOWED_FIELDS, extraction writers (flatteningService,
  flatExtractionController map, SRM VLM enrichment), combo-parent mirroring (comboLinkService), the dead non-generic
  size guard, the KIDS-duplicate pdStatus reset, FG export "Article Type" column, history label, frontend item types.
- Model generation framing now uses major category only (article_type was the second hint).
- `weight` kept (user decision) — it is sent to SAP (M_FAB_WEIGHT / NET_WEIGHT).
- DB NOT changed yet: `Backend/prisma/migrations/20261104_drop_size_articletype_fullform_pdstatus_extraction_results_flat.sql`
  (Step 1 drop index any time; Step 2 drop columns + type after the backend is deployed).

---

## 2026-11-04 — extraction_results_flat: unused variant columns removed from code

- `generic_article_id`, `variant_size`, `variant_color`, `variant_weight` were NULL in all 79k rows (FG variants live in
  `fg_variants_article_data` since 2026-10-16). Removed from the Prisma model and every flat select / edit whitelist
  (ApproverController list, getById, SAP-sync select, ITEM_UPDATE_ALLOWED_FIELDS, approved-item exception), the dead
  non-generic variantColor->colour sync, the `OR generic_article_id = ANY(...)` in the sap_lock_until reset,
  variantCreationService and articleModelSourceService.
- Kept: `size` and `article_type` — still written by extraction / SRM, exported, editable, `size` mirrored to combo
  parents, `article_type` used in model-generation framing.
- DB NOT changed yet (migration declined): `Backend/prisma/migrations/20261104_drop_unused_variant_columns_extraction_results_flat.sql`
  — Step 1 drop the generic_article_id index (any time); Step 2 DROP the 4 columns after the backend is deployed.

---

## 2026-11-04 — Fabric article image watermark (like FG)

- When SAP creates a Fabric article (`submitFabricArticles`, zmmFabArtCreationService.ts — used by the Fabric New page and
  "Create fabric article" from FG), the image copied to `fabric_article/<SAP no>.jpg` is now stamped with the same label
  as FG / GM: Article, PPT No., Cost (rate), Category, Design No., Vendor, Approved By (submitting user), Date.
- New `storageService.watermarkImage()` returns the stamped JPEG or null; on a watermark failure the original image is
  uploaded as before, so creation is never blocked. Same R2 path as before (primary bucket, `fabric_article/`).
- Fabric variants: unchanged (no watermark, same as FG variants).

---

## 2026-11-02 — extraction_results_flat.image_name removed from code

- `image_name` only ever held the storage UUID (SRM rows: always null) and was used only as a label fallback.
  Removed from the Prisma model and all selects/writes (ApproverController, flatteningService, srmSyncService,
  backfill script) and from the FG / Fabric / GM item types and their `articleNumber || … || imageName || id` fallbacks.
- Admin expenses and `/api/user/costs` keep their `imageName` label field, now `articleNumber || designNumber || 'Unknown'`.
- DB NOT changed yet (migration declined): `Backend/prisma/migrations/20261102_drop_image_name_extraction_results_flat.sql`.
  Step 1 (any time): drop the 2 image_name indexes (~22 MB, almost unused) + drop the image_name clause from the
  `set_is_old_article` trigger (0 rows depended on it). Step 2 (after backend deploy): DROP COLUMN.

---

## 2026-10-07 — GM Article review page redesign (design H)

- Picked H from two canvas rounds (A–E, then F–I). The GM card now has a wide photo + "Article details" rail
  (division, sub-division, major category, MC description, design no., article no., description, vendor as
  real fields), the GM grid split into Required / Optional only, a separate BOM card, and a Colour variants card.
- Header Save & Submit / Reject restyled to slate. Details: [[11 - Frontend Architecture]] → GM Article review page.
- Then shortened per Round 3 option K: 5:4 photo, Article details two fields per line (Created in its header),
  GM grid two attributes per line (38 px rows), BOM on one line, Colour variants full width under both columns.
  Left column ~1,320 → ~824 px at 1440 wide.
- Round 4 on the canvas: K in five colour themes (Slate, Navy, Teal, Aubergine, Dark) — awaiting the user's pick.
- Pending: GM article-description auto-build rule (user to send the attribute sequence).

---

## 2026-10-07 — Admin Dashboard (Expenses) + View Data redesign

- Option A from a 5-option canvas: jump menu, one Pipelines card, compact Vendor sync row, and the
  18 master-data uploaders as compact grouped cards that expand in place to the original upload panel.
- Option E for View Data: breadcrumb, removable filter chips, propose edit/delete/add as a side panel
  (`RowChangeRequestDialog variant="panel"`) with "Current: …" hints. Details: [[10 - Admin Panel]].

---

## 2026-10-07 — Admin › Users page redesign

- Option A ("refined table") from a 5-option canvas: role chips + Active/Inactive filter, compact scope chips
  with "+N more", relative last login, status dot, icon actions, no horizontal scroll. Inactive users are now
  viewable (default filter is still Active). Details: [[10 - Admin Panel]] → Users Management.
- Add/Edit user dialog redesigned (option A): sectioned form, locked email, "Set a new password" link,
  division toggles + sub-division chip grid replacing the two MultiSelects, Deactivate in the dialog footer.

---

## 2026-10-06 — Spec Sheet cards + Group by on all article dashboards

- New shared `shared/components/articles/ArticleSpecCard.tsx` + `ArticleCardGrid.tsx` replace the 4 duplicated
  card components on FG / Fabric / FG-Fabric / Body / GM dashboards (design option B, picked from a 4-option canvas).
- New **Group by: None / Vendor / Category** control; remembered per dashboard (URL + localStorage).
- Backend: list endpoints `/approver/items`, `/fabric-article-data`, `/body-articles`, `/gm-articles` accept
  `groupBy=vendor|category` (included in the `getItems` response cache key). Groups are ordered by their newest
  article (today's vendor/category first), newest-first inside — `ApproverController.findGroupedPage`.
- Filter bar redesign (option C, same day): Division as tabs in the header, one even-height filter row with
  date presets (Any / Today / 7 days / 30 days / Custom), Reset filters, SAP sync chips on Created tabs —
  `shared/components/articles/ArticleFilters.tsx`, applied to the same five dashboards.
- Details: [[11 - Frontend Architecture]] → "Article list dashboards — shared card grid".

---

## 2026-06-04 → 2026-07-21 — main merged into `feat/tailwind-ui-redesign`

119 non-merge commits from `main` (spanning 2026-06-04 → 2026-07-21) were pulled into the branch on **2026-07-22**. The Tailwind/shadcn redesign work was already merged upstream, so this resolved to a **clean fast-forward — local branch now equals `origin/main`** (tip `9a10c47`, PR #159).

### New subsystems

- **KSML class/char batch** — MDM classification character assignment.
  - `Backend/src/controllers/ksmlController.ts`, `routes/ksml.ts`, `services/ksmlAssignService.ts`
  - `Frontend/src/features/admin/pages/KsmlUploaderPage.tsx`
  - Portable batch runner: `scripts/class-char-batch/` (+ `insert_pool.json`)
  - Handover: [[UDIT_HANDOVER_KSML_CLASS_CHAR_2026-06-22]]

- **Pool B pipeline** — queued bulk job processing with failure surfacing.
  - `Backend/src/controllers/poolBController.ts`, `routes/poolB.ts`
  - `services/poolBJobService.ts`, `services/poolBPatchService.ts`
  - `Frontend/src/features/admin/pages/PoolBUploaderPage.tsx`
  - Queue + error handling for failed articles.

- **National Grid vertical / MC-wise grid validation** — major-category-wise mandatory grid & dropdown.
  - `Backend/src/services/nationalGridValidation.ts`, `scripts/importNationalGrid.ts`
  - `Frontend/src/features/admin/components/GridValuesEditor.tsx`, `utils/gridSnap.ts`
  - MC × sizes validation; manual size validation; National Grid removed from labels on new-articles & PO_COMMITE approver pages.

- **Model generation "From Article List"** — bulk model image generation.
  - `POST /bulk/from-articles`; article-list parser (xlsx/text) + R2 key builders (`services/articleListParser.ts`, `articleModelSourceService.ts`)
  - `Frontend/.../model-generation/components/ArticleListPanel.tsx`, `ModelImagesBrowser.tsx`
  - 5-view mode (adds side + three_quarter prompt views), R2 fetch/upload worker, concurrency pool with restart-resume, model-images R2 bucket.
  - Spec: [[2026-07-08-model-generation-from-article-list-design]] · Plan: [[2026-07-08-model-generation-from-article-list]]

- **SAP attribute SoT push** — attributes pushed to standard SAP AUSP via V64 chain after article create.
  - `Backend/src/services/sapAttributePushService.ts`, `sapModifyService.ts`, `data/flatToRfcMap.ts`
  - Legacy ZCT04 write/read scripts removed (standard SAP AUSP only).
  - `zart-sot-sync`: Supabase `maj_cat_sizes` → SAP `ZART_GRID_VALUES` mirror.
  - `zmmVarArt`: pre-flight `Z_ART_VALIDATE_VARIANT_SIZE` before BAPI.
  - Docs: [[ATTRIBUTE_WRITE_PATH]], [[SPEC_MC_ATTRIBUTE_SOT]], [[UDIT_HANDOVER_ARTICLE_SOT]]

### Admin & UI additions

- **Modification audit log** — `modify_logs` table + `ModifyLog` Prisma model; per-label diffs logged on successful article modification. `GET /api/admin/modify-logs` + `ModificationLogsPage`.
- **Multi-division users** — a user can hold multiple divisions; MultiSelect with orphan sub-division confirmation, sub-dept union filtering, edit preload.
- **Size Master editor UI** + sizes uploader + duplicate-article fixes (`SizeMasterEditor.tsx`).
- **Status Dashboard** page (`StatusDashboard.tsx`).
- Export-with-variants on created articles (`buildExportWhere` shared); name/email added to created-article Excel; toast dismiss button.

### Variants & BOM

- Color added into BOM fields — variants auto-created from BOM field colors; images attached per variant color.
- Variant size fixes; `M_SET` fixes; bulk-modification download template.

### Infra / performance

- `eventLoopWatchdog` + `concurrency` utils; performance fixes; Gemini model added in env.
- `PD → PENDING` migration plan: [[2026-06-29-pd-to-pending-migration]]

### Housekeeping note

Upstream `main` keeps re-committing junk that should be gitignored — `Backend/src/generated/prisma/query-engine-windows.exe.tmp*` binaries and a `.claude/worktrees/agent-*` gitlink. Drop these on each merge.

#v2kart #article-creation #changelog

- 2026-10-22: FG Articles pages no longer call `/approver/value-addition-accessories-cost/lookup` (removed VAAC auto-fill of VALUE ADD ACC. COST in ApproverArticleList.tsx). Backend route and Admin VAAC upload left in place.
- 2026-10-22: Removed unused `/approver/bom-art-numbers/:majCat` (route, controller, majCatGridMap loader) and its dead fetch/state in FG, GM and Fabric article lists. `Backend/src/data/majCatGridMap.json` is now unreferenced.
- 2026-10-22: FG/GM/Fabric article lists no longer call `GET /admin/attributes` (attribute-group card layout feature removed). Cards always use the hardcoded `ATTRIBUTE_GROUPS`; removed `preloadAttributeGroups`, `buildCardGroups`, `forceStaticGroups` prop. The endpoint itself stays (Admin attribute screens use it).
- 2026-10-22: Card thumbnails. New public `GET /api/images/thumb?url=&w=320` (Backend/src/routes/images.ts + services/thumbnailService.ts) shrinks article photos with sharp to WebP (~4 MB → ~35 KB) and caches them in the main R2 bucket under `thumbs/w<width>/<sha1>.webp`. `ArticleSpecCard` uses it (falls back to the original on error); zoom still shows the original. Fixes FG/GM/Fabric dashboard scroll hang.
- 2026-10-22: Backend clean-up. Deleted 9 unreachable src files (queueManagementService + in-memory repository, vlmFusionConfig, vlmLogger, modelGenerationAuth, src/scripts/*), unused data (majCatGridMap.json x2, src/data/mccode.json, MANDATORY GRID DATA_backup.xlsx, variant-sizes-mapping.xlsx) and loose debug files in Backend/ (_dbtest.js, _e2e2.ts, check-*.cjs, gen-token.cjs, test-update.cjs, render.yaml, .env.sentry.example).
- 2026-10-22: Frontend clean-up. Deleted unused old pages/components (features/analytics, old extraction Discovery/Export UI, src/components/*, admin Category/Department managers, CategoryAttributeMatrix, BulkDeleteByArticleNumberDialog, admin/hooks, old AppHeader/ModernAppHeader/Sidebar, ImageModal, StatsCard, app/hooks, theme index/antd/spacing/typography, both lazyLoader.ts copies) and src/data/archived/maj-cat-attribute-values.json (5.1 MB). theme/colors.ts kept (LandingPage). tsc + vite build pass.
- 2026-10-22: GM SAP create (ZMM_ART_CRT_V3) now sends `PURCH_PRICE` = rate and `PRICE_BAND_CATEGORY` = segment (both were missing / hardcoded blank) in zmmGMArtCreationService.buildImData.
- 2026-10-22: Extraction › FG Article: Sub-division and Major category dropdowns now come from `major_category_details` (active rows), fetched per chosen division via new `GET /api/user/major-category-hierarchy?division=` (cached per division). Replaces hardcoded SIMPLIFIED_HIERARCHY sub-divs and the mc-code-list JSON for this page. Division list itself is still hardcoded (Kids/Ladies/MENS).
- 2026-10-22: Article cards (FG/GM/Fabric/Body) no longer call `GET /article-config/category-attributes/:majCat`. The Edit Article pop-up Attributes tab on FG/GM/Fabric detail pages now decides required/visible fields from the mandatory grid (new `getMandatoryGridKeys()` in majCatAttributeMap.ts), same as the cards. Extraction pages still use getMajCatMandatoryKeys (category_attributes).
- 2026-10-23: Removed Extraction › Fabric Article page (FabricExtractionPage.tsx + /extraction/fabric-article route; sidebar link was already gone since 2026-09-22), the SimplifiedCategorySelector component (file now only holds SIMPLIFIED_HIERARCHY + SimplifiedCategory type) and unused getMajorCategoriesBySubDivision().
- 2026-10-23: GM Article: removed the "Proceed for FG Article Creation" button entirely (GMArticleList button + onProceedFGArticle prop, GMArticleDetailPage confirm dialog + doProceedFG). FG/Fabric pages and backend /approver/proceed-fg-article untouched.
- 2026-10-23: GM colour-variant table text +2px. Shared VariantGrid.tsx got a `large` prop (FONT/FONT_LG size maps) and StatusPill a `large` prop; only GMVariantTable passes them, so FG/Fabric tables are unchanged.
- 2026-10-23: Vendor Code field on FG/Fabric/GM cards is now a search dropdown like Vendor Name (type 2+ digits → vendors whose code starts with them; picking fills code + name). Backend `/approver/vendor-search` takes `by=code`. Shared `pickVendor()` helper per card.
- 2026-10-23: Stopped mirroring to `360article.article_360_flat` (write-only copy, never read by any code/API). Removed `utils/mirror360Flat.ts` and every mirror360FlatUpdate/upsert360ArticleFlatRow call (ApproverController, enhanced/flat extraction controllers, flatteningService incl. dead upsertTo360ArticleFlat, srmSyncService, variantCreation, kidsDuplication, prisma/backfill-srm-vendor-name). Table itself (115,766 rows, 114 MB) still exists — back up + DROP pending.
- 2026-10-23: audit_logs: local Backend/.env set to ENABLE_AUDIT_LOGGING=false (production already false via deploy-backend.yml). All recent rows came from 127.0.0.1 (local dev). Table (57.7k rows, 233 MB) not yet cleared.
- 2026-10-23: Removed the audit_logs request logger: deleted Backend/src/middleware/auditLogger.ts, its middleware on /api/admin, /api/expense, /api/user, /api/user/simplified, /api/approver and the shutdown flush in index.ts; removed ENABLE_AUDIT_LOGGING from .env, .env.example and deploy-backend.yml. Prisma model AuditLog + table audit_logs (57.7k rows, 233 MB) kept for now.
- 2026-10-23: Removed Prisma model AuditLog from schema.prisma (prisma generate + tsc pass). DROP TABLE audit_logs not run yet (permission prompt declined).
- 2026-10-23: Extraction › FG Article: attribute dropdowns now come from the selected major category's maj_cat_grid_values (preloadMajCatGridFor + getMajCatAllowedValues(majorCategory, key, division)); attribute_allowed_values is only the fallback when the grid has no values for an attribute. Previously the division was passed as the major category so the grid never matched.
- 2026-10-23: FG/GM/Fabric cards no longer call `/article-config/values?division=` (global attribute_allowed_values). Removed the preload effect + cacheReady flag and the dead BOM dropdown branches (impAtrbt2 via 'IMP ATBT' — no BOM row uses it; getCachedValues fallback). Card attribute dropdowns already came from maj_cat_grid_values (IMP ATBT = M_IMP_ATBT), colours from colour master, Fabric ARTICLE FASHION TYPE fixed [C].
- 2026-10-23: Extraction › FG Article dropdown fallback is now national_grid_master (new preloadNationalGrid() in articleConfigService, /approver/national-grid-values) instead of the division list from attribute_allowed_values. Order: maj_cat_grid_values → national grid → schema list. Page no longer calls /article-config/values.
- 2026-10-23: Extraction › FG Article: national grid is now a per-category fallback — a major category with its own maj_cat_grid_values uses only that grid and never calls /approver/national-grid-values; the national grid is loaded only when the category has no grid or none is picked. New hasMajCatGridData() in articleConfigService.
- 2026-10-23: Extraction › FG Article no longer uses attribute_allowed_values at all: removed /user/attributes?includeValues=true load, the AttributeCell "persist typed value" POST (/user/attributes/by-key/:key/values) and local add-to-schema; dropdowns = category grid, or national grid only if the category has no grid; an attribute neither grid lists shows no options with hint "add them in Admin › Grid Values". Export Excel dropdown lists now use the same grid values (columns still from /user/attributes without values).
- 2026-10-23: Extraction national-grid fallback only for a picked major category with no grid (upload is locked until a major category is picked, so the "none picked" branch was removed).
- 2026-10-23: Removed the Products page (/products route, features/dashboard/pages/Products.tsx + Products.css, ProductsPage export) and the now-unused CreatorRoute guard in AppModern.tsx. It was the last frontend caller of /user/attributes?includeValues=true.
- 2026-10-23: Stopped wasted attribute_allowed_values reads: FG/GM/Fabric detail pages no longer fetch /approver/attributes and the `attributes` prop is gone from the card lists and variant tables; SRM getEnrichSchema no longer includes allowedValues (grid replaces them). FG VariantSubTable: removed the never-opened EditVariantModal. Fabric variant Edit Neck dropdown now from maj_cat_grid_values (national grid if category has no grid). Add Color fallback (only if colour master fails) is now the fixed list.
- 2026-10-23: Fabric variant Edit pop-up: removed the Neck dropdown (field, form value, grid loading). Saving no longer sends `neck`, so a variant keeps its existing neck.
- 2026-10-23: Fabric variant table: removed the Edit button and the Edit variant pop-up entirely (EditVariantModal, form imports). Rows now have no action column, like FG.
- 2026-10-23: attribute_allowed_values clean-up (watcher untouched). Backend: removed GET /article-config/values + /article-config/category-attributes/:code, POST /user/attributes/by-key/:key/values, admin POST/DELETE /attributes/:id/values (+ AllowedValueSchema), includeValues on GET /attributes, and the /categories/hierarchy|:code/schema|search endpoints on /api/user and /api/extract. Frontend: removed the unreachable Edit Article pop-ups on FG/GM/Fabric detail pages (+ onEdit prop), deleted ApproverTable/FabricArticleTable/GMArticleTable (+css) after moving their types to features/{approver,fabric-article,gm-article}/types.ts, removed value/category-attribute caches from articleConfigService, getMajCatAllowedValues/getMandatoryGridKeys, admin addAllowedValue/deleteAllowedValue, GMAddColorModal attributes fallback. tsc + vite build pass.
- 2026-10-23: FG article detail page: removed the variant-weight pre-check effect (fetched /items/:id/variants for every selected pending article; its result was no longer used). Variants now load once, from the Colour variants table.
- 2026-10-26: Admin › Hierarchy: removed the Export JSON button (handleExport, Download icon), adminApi.exportHierarchy, and backend GET /api/admin/hierarchy/export (adminController.exportHierarchy). That export was one of the last readers of attribute_allowed_values.
- 2026-10-26: Removed unused attribute_allowed_values endpoints: GET /approver/attributes (+ its cache), admin GET /categories/:id, /categories/:id/all-attributes, /categories/:code/attributes (+ /user copy), POST /categories/:categoryId/attributes, GET /attributes/:id, POST /user/extract/category and /api/extract/extract/category (+ extractFromCategoryCode, schemaService.ts deleted). Frontend: deleted useHierarchyQueries, useCategoryExtractionQueries, categoryExtractionService, both useCategorySelector and categoryHelpers copies; removed adminApi getCategoryById/addAttributeToCategory/getMasterAttributeById/getCategoryWithAllAttributes, hierarchyService getCategoryWithAttributes/getCategoryConfigByCode, backendApi.extractWithCategory and the never-taken category branch in useImageExtraction. Only the watcher path still reads the table.
- 2026-10-26: FG article detail: (1) hard refresh / direct link no longer re-reads the article right after loading it (freshlyFetchedIdRef). (2) FG card automatic fills (MRP, ROUGH V2/AUTO BGT, segment, descriptions, consumption) are merged by queueAutoSave() into one silent PUT 1.5 s after the last fill (flushed on unmount) instead of one PUT each; queued values survive the server sync.
- 2026-10-26: Backend uses one shared VLMService (`export const vlmService` in services/vlm/vlmService.ts) instead of six (4 EnhancedExtractionController routes, SimplifiedExtractionController, srmSyncService) — AI provider clients built and "Claude provider initialized" logged once. POST /api/vlm/vlm/configure now requires ADMIN (it changes the shared service).
- 2026-10-26: VLMService now creates only the providers listed in VLM_PROVIDERS (default `google-gemini`); Claude and OpenAI are off but can be re-enabled via env. Fallback chain skips disabled providers; startup logs "[VLM] Providers enabled: ...". Documented in Backend/.env.example.
- 2026-10-26: Removed MvgrMappingService (startup "Loaded N MVGR mappings" logs) and its data files Backend/src/data/Book10.json, Book11.json, FAB2.json. It only filled macroMvgrFullForm / mainMvgrFullForm / mFab2FullForm on extraction + SRM import, which nothing reads. Also removed the scripts that depended on it: scripts/refresh-mfab2-from-json.ts (db:refresh:mfab2), scripts/normalize-fabric-attribute-values.ts (db:normalize:fabric-values), prisma/seed-mvgr-lookup.ts.
- 2026-10-26: Added nullable `back_image_url TEXT` to public.raw_articles (Supabase migration add_back_image_url_to_raw_articles; also Backend/prisma/migrations/add_back_image_url_to_raw_articles.sql) and `backImageUrl` to the Prisma RawArticle model. Not yet written or read by any code.
- 2026-10-26: Added nullable `back_image_url TEXT` to public.extraction_results_flat (Supabase migration add_back_image_url_to_extraction_results_flat; repo copy in Backend/prisma/migrations/) and `backImageUrl` to the Prisma ExtractionResultFlat model. Not yet written or read by any code.
- 2026-10-26: SRM back photo connected. SRM may send `back_image_url` per image (sync feed, by-presentation fetch, webhook). Stored in raw_articles.back_image_url, mirrored to R2 into extraction_results_flat.back_image_url (new attachSrmBackImage() in srmSyncService; also backfilled on existing articles when first sent). Returned by /approver/items list + /items/:id. FG article detail photo card: Front / Back (/ Old after a replace) arrows, dots and label.
- 2026-10-26: back_image_url extended to GM/Fabric: columns on gm_raw_data, fabric_raw_data, gm_article_data, fabric_article_data (migration add_back_image_url_to_gm_fabric_tables + Prisma). gm/fabricRawDataService copy it into the article row only when SRM filled it (mirrored to R2; never affects COMPLETED/FAILED). GM/Fabric item APIs return backImageUrl. GM and Fabric detail photo cards have Front/Back arrows. No Gemini, no watermark on the back photo.
- 2026-10-27: FG CMP COST card: TOTAL row = sum of PR VAL per stage (BGT/ACT/VENDOR/FINAL), editable — typing overrides, clearing returns to the sum. Saved with the card Save into new extraction_results_flat columns total_{bgt,act,vendor,final}_pr_val NUMERIC(10,4) (migration add_cmp_total_pr_val_to_extraction_results_flat; Prisma + update allow-list + item selects).
- 2026-10-27: FG B TRIM card TOTAL row: AUTO-BGT total stays read-only (always the sum); ROUGH-V2, VDR COST and FINAL COST totals are editable — typing overrides the sum, clearing returns to it. Saved with Save BT-xx into new extraction_results_flat columns b_trim_total_{rough_v2,vdr_cost,final_cost} NUMERIC(10,2) (migration add_btrim_total_columns_to_extraction_results_flat; Prisma bTrimTotalRoughV2/VdrCost/FinalCost + update allow-list + item selects). On load a saved total that differs from the rows' sum is shown as an override. V. ADD TOTAL unchanged.
- 2026-10-27: Added b_trim_total_auto_bgt NUMERIC(10,2) to extraction_results_flat (migration add_btrim_total_auto_bgt_to_extraction_results_flat; Prisma bTrimTotalAutoBgt + allow-list + selects). B TRIM Save BT-xx now also saves the AUTO-BGT total (always the rows' sum; still read-only on screen).
- 2026-10-27: FG V. ADD card now has the same sticky ink TOTAL row as B TRIM: AUTO-BGT total read-only (sum), ROUGH-V2 / VDR COST / FINAL COST editable overrides (clear = back to sum); sums include PRINT/EMB repeat copies. Saved on the card Save into new extraction_results_flat columns vadd_total_{auto_bgt,rough_v2,vendor_cost,final_cost} NUMERIC(10,2) (migration add_vadd_total_columns_to_extraction_results_flat; Prisma vaddTotal* + allow-list + selects). TOTAL label shows '+ N copies' when repeat rows exist.
- 2026-10-27: FG OTH GRID-1 COST SUMMARY: FAB row now uses the Precise Costing export's FAB formula — each of AUTO-BGT / ROUGH-V2 / VDR COST / FINAL COST = Fab card value × PR PC CONS. × (100 + 4% WST) / 100, PR PC CONS. = first of precise kg, rough kg, precise meter, rough meter. No consumption → FAB shows —. (The export leaves FINAL blank; the summary applies the same formula to the Fab card FINAL COST.)
- 2026-10-27: FG major category change rebuilds colour variants. PUT /approver/items/:id on a generic with fg_variants_article_data rows and a different majorCategory: blocked (409) if any variant is in SAP (variant_article_number or SYNCED); blocked (422) if the new category has no active maj_cat_sizes; otherwise after the update rebuildVariantsForMajCat() (variantCreationService) deletes the variants and re-creates each colour (keeping its photo) with all sizes of the new category. FG card reloads the Variants table after the save. Note: fg_variants_article_data has no weight column, so there is no variant weight to carry over.
- 2026-10-27: Major category change made quick: rebuildVariantsForMajCat now takes the updated generic + the sizes already fetched by the check and runs one read + one transaction (deleteMany + createMany) instead of per-colour addColorVariants (~20 round trips). FG Variants table shows a "Re-creating colour variants with <MC> sizes…" loader while the save runs (VariantSubTable `rebuilding` prop).
- 2026-10-27: New master table public.m_fabric_main_mvgr_mapping (id, mvgr1, mvgr1_full_form, mvgr2 UNIQUE, mvgr2_full_form, created_at, updated_at; migration create_m_fabric_main_mvgr_mapping) loaded with the 39 rows of "MVGR1 AND MVGR2 MAPPING.xlsx" (MVGR-1: DNM, STP, OD, PRT, SLD, CHK). Admin › Expenses › FG Attributes & Grid has a new "Fabric Main MVGR Mapping" card (status, View → /admin/expense/fabric-main-mvgr-mapping with add/edit/delete, Download, Template, Upload). Endpoints /admin/fabric-main-mvgr-mapping/{status,template,export,upload}; upload replaces the table and accepts the template or the original sheet layout. Not used by any article logic yet.
- 2026-10-27: FG FAB card: M_FAB_MAIN_MVGR_1 (mainMvgr) is read-only. Choosing M_FAB_MAIN_MVGR_2 calls GET /approver/fabric-main-mvgr1/:mvgr2 (m_fabric_main_mvgr_mapping) and saves MVGR-2 + its MVGR-1 together (staged together in Modify mode on Created). No mapping row → MVGR-1 cleared + warning; MVGR-2 cleared → MVGR-1 cleared; lookup error → MVGR-2 saved, MVGR-1 unchanged. Lookups cached per page load. Existing articles are not re-mapped; fabric-article search autofill still copies both MVGR values from the fabric master.
- 2026-10-28: FG major category change sends one PUT /approver/items/:id instead of two: handleSave first loads the new category's segment ranges (cached per MC), then saves majorCategory + mcCode + cleared body/fabric fields + the re-derived segment together. Removed the follow-up {segment} PUT.
- 2026-10-28: FG card: segment-ranges request no longer fires twice on a major category change (the save pre-step and the card's MC effect now share one in-flight request in fetchSegmentRangesFor). Same in-flight sharing (getJsonShared) for body-fabric-consumption/by-width GETs.
- 2026-10-28: extraction_results_flat: new nullable columns creator_user, modify_user (VARCHAR(200); Prisma creatorUser / modifyUser). Columns only, nothing writes them yet. Migration add_creator_modify_user_to_extraction_results_flat.
- 2026-10-28: creator_user is now JSONB: every distinct user (name + email) who saves a field on the FG New article page (PUT /approver/items/:id — grid attributes like M_FAB_DIV, costs, variants…) is appended once, in first-edit order: [{"name","email"}]. Atomic jsonb append, deduped by email; recorded fire-and-forget after the update. Copy/kids-duplicate start with creator_user = NULL.
- 2026-10-28: modify_user is now JSONB too: every distinct user who modifies the article on the FG Created page (POST /approver/items/:id/modify, only when a value really changed) is appended once as {name, email}. Shared helper ApproverController.recordArticleEditor(id, column, user). creator_user now skips APPROVED rows (internal Created-page saves via PUT /items/:id). Copies reset both columns.
- 2026-10-28: FG Created page "All" Excel export: two last columns creator_user and modify_user ("Name (email), Name (email)"); export-all select now includes creatorUser/modifyUser.
- 2026-10-28: FG change history uses one table. Created-page Modify (POST /approver/items/:id/modify) now writes history_fg_article via recordFgArticleHistory (same as the New page; History button reads it) from a full-row snapshot, and no longer writes modify_logs. One-time copy of 8,378 old modify_logs rows into history_fg_article (SAP keys mapped back to field names, description/V. ADD JSON fields skipped; migration copy_modify_logs_into_history_fg_article). Admin › Modification Logs page left as is: it reads modify_logs, so it shows only changes up to 2026-10-28.
- 2026-10-28: FG Article Change History dialog: new Stage column + filter — "Before creation" (changed while new) / "After creation" (changed after approval, e.g. Created-page Modify). GET /approver/items/:id/history returns stage = AFTER when changed_at >= the article's approved_at. Unlabelled field names now shown as words (preciseConsumptionMeter → Precise Consumption Meter). Dialog widened to max-w-4xl.
- 2026-10-28: Admin › Users: Download button next to All/Active/Inactive — exports the users currently shown (search, role and status filters) to users-<status>-<date>.xlsx with Name, Email, Role, Division, Sub Division, Business Division, Status, Last Login, Created At. No password column (columns picked explicitly). Frontend only (UsersManagement.tsx, exceljs).
- 2026-10-28: Admin › Users: Add/Edit user modal no longer offers the Fabric Approver role (still shown when editing a user who already has it). New multi-select "Article type" (FG Article / Fabric Article / GM Article) saved to new column users.article_types TEXT[] NOT NULL DEFAULT '{}' (migration add_article_types_to_users; Prisma User.articleTypes). Backend create/update accept articleTypes (enum FG|FABRIC|GM, deduped) and all user selects return it. Users table has a new Article type column; the Download export has an Article Type column. Bulk Excel upload does not set it.
- 2026-10-28: Admin › Users modal: Access scope now follows Article type. FG Article → the existing Mens/Ladies/Kids division + sub-division picker ("FG access scope"); Fabric Article → new "Fabric access scope" (Denim/Knits/Woven sub-divisions from fabric_article_master, new GET /api/admin/fabric-sub-divisions); GM Article → the GM sub-division picker (now also shown for non-GM roles). GM and Fabric share a new GroupedSubDivPicker component. All codes still go into users.sub_division (FG, GM and Fabric codes don't overlap); on save, codes of unselected types are dropped and division is cleared when FG isn't picked. No article type = old role-only behaviour. Backend create/update only require Division when the user is FG-scoped (FG picked or no type). Fabric Approver / GM Approver roles kept for now.
- 2026-10-28: Article type now controls access. Users with no article types work exactly as before; ADMIN is never restricted. Otherwise: sidebar shows only the FG / Fabric / GM groups they have (AppSidebar.tsx), ApproverRoute redirects /approver*, /fabric-article*, /gm-article* they lack to their first allowed area (AppModern.tsx), Home FG quick links hidden without FG. Backend: req.user.articleTypes (auth.ts, also in login and /me responses); new requireArticleType(type) on GET /approver/items + POST /approve (FG), GET /fabric-article-data, export-all, submit, delete (Fabric), GET /gm-articles, reject, submit (GM) — other /items/:id helpers stay open because Fabric/GM pages reuse them. requireFabricApprovalRights also allows ADMIN/APPROVER/CATEGORY_HEAD/SUB_DIVISION_HEAD/PO_COMMITTEE/PD with the Fabric type (frontend canApproveFabricByType). Scope: APPROVER/SUB_DIVISION_HEAD/CREATOR with GM type get the GM-role sub-division filter (list + gm-hierarchy); with Fabric type, the Fabric list/export is limited to divisions of their picked fabric sub-divs (first letter D/K/W, data mixes K/Knits/KNITS) and their sub-divs (codes not in fabric_article_master, e.g. SRM K_Lower, and empty ones pass); Fabric type with no fabric sub-div shows nothing. Admin user update now clears the auth cache. Frontend reads articleTypes from localStorage user, so users must log in again to see the new sidebar (backend applies at once). New file Frontend/src/shared/utils/articleTypeAccess.ts.
- 2026-10-28: Fabric Article page BOM card: SEGMENT is now a dropdown with E / V / P / SP only (was free text). Auto-fill from RATE via segment ranges unchanged. FabricArticleList.tsx.
- 2026-10-28: FABRIC_APPROVER role retired in code. Fabric SAP submit/delete (requireFabricApprovalRights) and the Fabric pages' approve/submit buttons (canApproveFabricByType) now allow ADMIN, or ADMIN/APPROVER/CATEGORY_HEAD/SUB_DIVISION_HEAD/PO_COMMITTEE/PD with the Fabric Article type. Removed from role lists (Users page, bulk upload, zod create/update, requireApprover, ApproverRoute, sidebar, /dashboard redirect, TS role types); FGNewArticleDetailPage no longer passes approveRoles. DB enum user_role and Prisma enum still contain FABRIC_APPROVER (DB migration declined); only inactive user 120 'Test Fabric' has it.
- 2026-10-28: fabric_article_data.approved_by was never set (all 2,291 APPROVED rows NULL): submitFabricArticles(ids) had no user. It now takes approvedById and writes approved_by (users.id) with approved_at on SAP success; passed req.user.id from POST /approver/fabric-article-data/submit and from the FG page's create-fabric-number flow. Old rows not backfilled (approver unknown).
- 2026-10-28: Same fix for GM: gm_article_data.approved_by was never set (all 191 APPROVED rows NULL; the approver name only went to the image watermark). submitGmArticles now takes approvedById and writes approved_by with approved_at on SAP success; POST /approver/gm-articles/submit passes req.user.id. Old rows not backfilled.
- 2026-10-29: Fabric Article pages: FABRIC ARTICLE DESC now follows "FABRIC ARTICLE SEQUENCE.xlsx" — M_FAB_DIV, M_YARN, M_WEAVE_01, M_LYCRA, M_FAB_MAIN_MVGR_2, M_WIDTH, M_GSM (Knits) / M_OUNZ (Woven & Denim), M_COUNT, M_COMPOSITION, joined with '-'. Division K… = Knits, else Woven/Denim (falls back to fabDiv). Construction, M_FAB2, Finish, Fab Vendor no longer in the description. One helper buildFabricArticleDesc in FabricArticleList.tsx used by the live rebuild, the auto-save, the save-on-edit (also re-runs on division change) and the Auto-fill button. Pending SRM articles re-save the new description when opened; FG New only fills when empty; approved articles unchanged.
- 2026-10-29: Fabric Article BOM SEGMENT is now read-only and computed from RATE (mrp field) by division — Fabric Segment master: Woven E ≤80, V ≤125, P ≤200, SP >200; Knits E ≤300, V ≤400, P ≤500, SP >500; Denim E ≤225, V ≤275, P ≤350, SP >350 (division first letter K/D/W, fallback fabDiv; unknown division = no segment). Recomputed on RATE or division change and on open for PENDING articles (silent save). Replaces the major-category segment-range lookup (/article-config/segment-ranges) on Fabric pages and the E/V/P/SP dropdown from 2026-10-28. FabricArticleList.tsx.
- 2026-10-29: Body article create no longer blocks with "Body Article is already Present: N/A". Cause: submitNow marks the body_article_data row APPROVED before the SAP call; when ZMM_BODY_ART_CRT_V3 timed out (120s abort) the row stayed APPROVED with no number, and Check 2a then blocked every retry. Check 2a now blocks only when the APPROVED row has a number; an APPROVED row without one is re-submitted (path b). A timeout now writes "SAP did not answer within 120s — the body article may still have been created in SAP. Check SAP before retrying." Data fix for flat 1535840c… (IB_KURTA_ST): SAP had created the article despite the timeout — two of them, 2176033328 and 2176033329 (same grid, ERSDA 2026-10-29). Linked 2176033328 to the row and to extraction_results_flat.body_article; 2176033329 is an unused duplicate in SAP.
- 2026-10-29: Duplicate button now also on the FG Created page (KIDS division only, same as New). Uses the same POST /approver/items/:id/duplicate with a design number. The copy is always PENDING / NOT_SYNCED with no article number, SAP id/message, approver, fabric number or fabric description (as before). When the source is APPROVED (Created page) it also clears body_article, attr_article_nums, old_image_url, set_link_status, srm_unique_id, srm_original_design_number, is_old_article, and resets pd_status to PENDING. Attributes and costing values are copied; variants are not. The copy shows in the New Articles tab. New-page duplicate behaviour unchanged.
- 2026-10-29: Duplicate (New and Created pages) no longer creates a fake extraction_jobs row. The copy gets job_id = NULL (like SRM imports; 5,507 such rows already) and input/output/total tokens, api_cost and processing_time_ms = NULL. Before, the fake job copied the original's Gemini tokens and cost, so each duplicate counted as a new paid AI run in the stats. A source with no job_id gave "Source job not found"; it can now be duplicated.
- 2026-10-29: FG New article page Save & Submit: cards with their own Save button (B TRIM, V. ADD, PKG COST, CMP COST) that hold unsaved changes register in a small shared list (features/approver/components/unsavedCards.ts, useRegisterUnsavedCard). The Approve confirm popup names them ("You have unsaved changes in: V. ADD, CMP COST") and its button becomes "Save & Approve"; on click each card is saved first, then /approver/approve runs. If a card save fails, the popup closes with "Could not save <card>. Nothing was sent to SAP" and nothing is submitted. CMP COST counts as unsaved when master presets (BGT/ACT PR VAL) were filled but not saved. Card saves now await the PUT and keep "Unsaved changes" if it fails (onSave option throwOnError, SaveFailedError in ArticleDetailPage). Locked (approved) articles are skipped. Frontend only.
- 2026-10-29: FG New article Confirm Approval popup redesigned (design option A, ArticleDetailPage.tsx): dark ink header "APPROVE & SEND TO SAP · Approve 1 article?" with an article chip (number · major category · vendor), a small "Unsaved changes — saved first" list (one row per unsaved card), a "can't be undone" note, and a slate footer with Cancel + Save & Approve (ink button, not coral). While approving, Cancel/close/Esc/outside-click are blocked. Reject/create popups unchanged. Frontend only.
- 2026-10-29: FG Duplicate popup (KIDS Duplicate button, ApproverArticleList.tsx) redesigned — design option C: compact popup titled "Duplicate <design no.>" with one Design Number field (no red "required" error before typing; Duplicate button stays grey until filled; Enter submits), "What gets copied?" folded away on the Created page, slate buttons. A failed duplicate keeps the popup open with the server error under the field. On success the popup turns into "Copy created — <design no.> is now in New Articles as PENDING" with Stay here / Open the copy (navigates to /approver/<new id>, from the duplicate endpoint's { id }). The old "Article duplicated successfully" toast is gone. Frontend only.
- 2026-11-11: User Profile page redesigned — design option A (features/dashboard/pages/Profile.tsx): ink header with initials, name, email, role + business-division chips, Refresh / Log out; Account card (user ID, member since, email, status) and Work scope card (business division, division, sub-divisions, article types); Security card with last sign-in and a new **Change password** button. Change password popup: current / new / confirm (show-hide eye), live rules (8+ chars, a number, different from current), mismatch check, server error shown under the current-password field. Backend: new POST /api/auth/change-password (authenticated; bcrypt-checks current, same rules server-side, hashes new, invalidates auth cache); /auth/me now also returns businessDivision and isActive.
- 2026-11-11: Changing a password now logs the user out of every device. New column users.password_changed_at (Prisma passwordChangedAt; SQL in Backend/prisma/add_password_changed_at.sql — applied to the Supabase DB on 2026-11-11, nullable, empty for everyone until they change password). Set by POST /auth/change-password and by an admin password reset (adminController update user). middleware/auth.ts and /auth/verify refuse any token issued before it (401 SESSION_REVOKED, "Your password was changed"); other devices hit the existing 401 → /login redirect. The Profile popup says so up front and, after success, logs this device out too and goes to /login.
- 2026-11-02: FG article page "Unsaved changes" leave popup (sidebar, back, ◀ ▶) redesigned — design option A (ArticleDetailPage.tsx): ink header "UNSAVED CHANGES · Save before leaving?" with the article number, a list of the cards with changes (amber dot → spinner → tick while saving), red-text "Leave without saving" on the far left, Stay + slate Save & leave on the right. If a card fails to save the popup now stays open (was: closed with a toast), marks that card "save failed", and the button becomes Try again (only cards still unsaved are retried). Closing is blocked while saving. Frontend only.
- 2026-10-30: FG CMP COST card (CmpCostCard.tsx) — new read-only AI SAM column between PROCESS and BGT (design option A): sparkle icon + "read-only" header, plain values, CUTTING always "—", TOTAL = sum of AI SAM. Values come from a new optional `aiSam` prop ({ STITCHING, IRONING, FINISHING }); nothing passes it yet, so the column shows "—" until an AI SAM source is decided. UI only, nothing saved.
- 2026-10-29: B TRIM card no longer shows "Unsaved changes" on open when nothing changed (e.g. 91c0288a…, BT-01 saved, 0/20 OTHER ACC). On load the card fills OTHER ACC rows with no RATE from basic_trim_master and marked itself dirty, but unticked rows are saved empty, so there was nothing to save. Now it is dirty only if a filled row is ticked (fillOtherFromMaster returns the filled rows). This also stops B TRIM from appearing in the Save & Submit unsaved-cards popup for these articles.
- 2026-10-29: Duplicate also sets ai_model, avg_confidence, total_attributes and extracted_count to NULL (AI-run metadata of the original). extraction_status stays COMPLETED so the SRM gate/cron leave the copy alone. The duplicate's card shows no AI confidence badge.
- 2026-10-29: New column extraction_results_flat.source_image_url = the clean (un-watermarked) image. SAP creation overwrites image_url with the watermarked approved-bucket copy, so a Created-page duplicate used to get watermarked twice. Filled by DB trigger trg_set_flat_source_image_url (function set_flat_source_image_url): on INSERT from image_url (covers FG page / Watcher extraction via flatteningService, SRM raw_articles VLM via srmSyncService, combo child, duplicates); on an image_url change it follows only while the row is not APPROVED and not SYNCED. Backfill: pending rows from image_url; approved rows from raw_articles.image_url (SRM), else extraction_jobs.image_url. SQL: Backend/prisma/add_source_image_url.sql (run manually; the MCP migration was declined). Duplicate: when the source is APPROVED and division KIDS (Created page), image_url = source_image_url (falls back to image_url). New-page duplicates unchanged.
- 2026-10-29: Outage: "Failed to update item" on every FG article (PUT /approver/items/:id). The running backend had the new Prisma field sourceImageUrl but the column did not exist ("The column extraction_results_flat.source_image_url does not exist"). Fixed by adding the column (ALTER TABLE … ADD COLUMN source_image_url text); reads verified OK. The trigger and the backfill from add_source_image_url.sql still had to be run by the user. Lesson: run the SQL before deploying or restarting with a Prisma schema change.
- 2026-10-29: source_image_url — no DB trigger after all (its creation was declined). The code now sets it at every pre-approval image_url write: flatteningService.mapToFlatStructure (FG extraction page / Watcher = job.imageUrl), srmSyncService (insert, R2 mirror, patch of a missing image, enrichment backfill re-mirror), combo child (parent's source), kidsDivisionDuplicationService, duplicateItem. Backfill run: PENDING 43,765/43,799, REJECTED 5,071/5,086, APPROVED 23,716/29,225 filled. The 5,509 approved rows with no clean original fall back to image_url on duplicate.
- 2026-10-29: gm_article_data: three new nullable columns rough_v2, vdr_cost, final_cost (NUMERIC(10,2), like rate/mrp; Prisma GmArticleData.roughV2 / vdrCost / finalCost). Migration add_cost_columns_to_gm_article_data. Columns only; nothing reads or writes them yet.
- 2026-10-29: GM Article page BOM card: three new optional fields after Segment — Rough V2, Vendor cost, Final cost — saved to gm_article_data.rough_v2 / vdr_cost / final_cost. Typed like other BOM text fields (save on blur/Enter); only numbers with up to 2 decimals are accepted, empty clears. Backend: GM_ARTICLE_UPDATE_FIELDS accepts roughV2 / vdrCost / finalCost (empty string → NULL for decimal columns, incl. rate/mrp); GM list select + gmArticleDataRowToItem return them. Locked on approved articles like the rest of the card. Not sent to SAP.
- 2026-10-29: GM submit to SAP (ZMM_ART_CRT_V3) is now blocked when the major category has no HSN code in gm_major_category_details.hsn_cd: the article stays PENDING with sap_sync_status FAILED and message "HSN code missing for major category …", same as the existing missing-MC-code block. Before, it went to SAP with a blank HSN_CODE and SAP created the article with an empty MARC-STEUC (e.g. 1233051939, ST_STATIONARY_SET). The lookup now prefers a row with a filled hsn_cd. Note: on 2026-10-29 hsn_cd is empty for all 2,152 rows, so every GM submit is blocked until HSN codes are loaded.
- 2026-10-29: FG OTH GRID-1 MRP rule: entering RATE / COST now sets MRP = rate + 30% (rate 100 → MRP 130, 2 decimals, no rounding to 50); before it was rate × 1.47 rounded up to the next 50. MRP stays editable but must be between rate + 15% and rate + 50% (rate 100 → 115…150), else "MRP must be between 115 and 150 (rate + 15% to rate + 50%)". Replaces the old "markdown below 20%" check. Also used by the auto-fill of an empty MRP on open. Helpers calcFgMrpFromRate / fgMrpLimits in ApproverArticleList.tsx. GM and extraction pages keep ×1.47.
- 2026-10-29: GM Article BOM card gets the same MRP rule as FG OTH GRID-1: entering Cost / rate sets MRP = rate + 30% (2 decimals), and now always resets MRP on a rate change (before: × 1.47 rounded up to the next 50, only when MRP was empty). A typed MRP must be between rate + 15% and rate + 50%, else "MRP must be between … (rate + 15% to rate + 50%)". Helpers calcGmMrpFromRate / gmMrpLimits in GMArticleList.tsx.
- 2026-10-29: gm_major_category_details.hsn_cd filled for all 2,152 rows (119 major categories, 47 distinct HSN codes) from "GM_GRID_VALUE_FINAL_-_FINAL APPROVED - RAW.xlsx", sheet 07_REQ_BY_CATEGORY (MAJ_CAT_NM → HSN_CD; one HSN per category, no conflicts). Migration fill_gm_major_category_hsn_cd. GM submits are no longer blocked by the missing-HSN check. In the Excel, MA_MOBILE CHARGER and MA_USB CABLE have their MC code (310103001 / 310106001) in HSN_CD — not in the table, not loaded.
- 2026-10-29: Admin › Expenses › GM › GM Major Category Details card: hsn_cd added as the last column (13th) of the Template (green = required, text format, sample HSN values) and of the Download (current data) Excel. The upload now reads hsn_cd too — before, the upload truncated the table and re-inserted without hsn_cd, so any re-upload would have wiped the HSN codes. Rows without hsn_cd are still accepted (stored NULL), but GM submit to SAP blocks on a missing HSN. Backend only (adminController.ts).
- 2026-10-29: Removed the MRP limit check on FG OTH GRID-1 and GM BOM ("MRP must be between … (rate + 15% to rate + 50%)"). RATE still fills MRP = rate + 30%; the user can now type any MRP. The old FG "markdown below 20%" check is not coming back either.
- 2026-10-30: CREATOR role can now reject FG articles (not approve). Backend: new requireRejectRights (auth.ts) = CREATOR or requireApprovalRights, used on POST /approver/reject; /approver/approve unchanged. Reject stays scoped to the creator's division/sub-division (applyApproverScope already covers CREATOR). Frontend ArticleDetailPage: Reject button enabled for canReject = canApprove || CREATOR; Save & Submit still needs canApprove. The FG New dashboard "Reject selected" button was already shown to everyone and now works for creators. rejected rows store the creator in approved_by (same column the approver used).
- 2026-10-30: FG Rejected Articles page: new Revert button in the article header, shown only to ADMIN and only when the article is REJECTED. Confirm popup, then POST /approver/items/:id/revert (requireAdmin): approval_status → PENDING, sap_sync_status NOT_SYNCED, sap_sync_message / approved_by / approved_at cleared; fg_variants_article_data rows of that article that are REJECTED go back to PENDING the same way. The change is logged in history_fg_article (approvalStatus REJECTED → PENDING). The article then shows in New Articles again.
- 2026-10-30: FG Rejected Articles list: "Revert selected" button in the selection bar (ArticleListHeader onRevertSelected, shown only to ADMIN on the Rejected page). Confirm popup, then POST /approver/revert { ids } (requireAdmin): every selected REJECTED article goes back to PENDING (non-rejected ids skipped), with its rejected variants; each logged in history_fg_article. Single-article Revert (POST /approver/items/:id/revert) now shares the same revertToPending helper.
- 2026-10-30: CMP COST card "AI SAM" column now has data. New nullable columns extraction_results_flat.ai_cmp_cost_cutting / _stitching / _ironing / _finishing (NUMERIC(10,2), SAM minutes; Prisma aiCmpCost*; migration add_ai_cmp_cost_columns_to_extraction_results_flat). Filled by the existing Gemini extraction call, no extra API call: googleVisionProvider.buildPrompt adds an "AI SAM" section + "ai_sam" {cutting, stitching, ironing, finishing} to the output JSON, anchored on the major category's SAM from rough_cmp_cost_master (new services/cmpSamReferenceService.ts, cached 10 min, sent as FashionExtractionRequest.cmpSamReference); parseResponse → result.aiSam (only positive numbers < 1000, 2 dp). Saved by both paths: FG extraction page (enhancedExtractionController base64 + upload/watcher → directFill) and raw_article / SRM VLM enrichment (srmSyncService.enrichSrmRowWithVlm, after the usable-attributes check). Read-only: not in the PUT whitelist. Approver item selects return the fields; ApproverArticleList passes them to CmpCostCard aiSam. Only new extractions get values; existing articles show —. The card still shows CUTTING AI SAM as — by design.
- 2026-10-30: CMP COST card AI SAM now shows CUTTING too (the card hard-coded "—" for cutting even when ai_cmp_cost_cutting had a value); AI SAM TOTAL includes it. Seen on d7b73a53… (IB_BERMUDA): AI SAM = 0.9 / 8.5 / 0.6 / 1.6, identical to the rough_cmp_cost_master anchor.
- 2026-10-30: AI SAM is now estimated from the image only: removed the rough_cmp_cost_master reference numbers from the Gemini prompt (deleted services/cmpSamReferenceService.ts and FashionExtractionRequest.cmpSamReference). Reason: d7b73a53… returned exactly the master SAM, so the anchor was being copied. Same single extraction call, same ai_sam output and columns. Articles extracted before this keep their anchored values.
- 2026-10-30: Fix: AI SAM was empty on every new extraction (e.g. 6fba4d1e…). Without the reference numbers Gemini copied the 0.0 placeholders from the OUTPUT FORMAT ("ai_sam": {"cutting": 0, …}) and parseAiSam drops 0. Prompt now uses descriptive placeholders ("minutes as a number"), says it is an estimate (always a positive number, never 0/null) and gives generic per-piece ranges (cutting 0.3–3, stitching 3–60, ironing 0.3–5, finishing 0.5–8 min) — not per-category numbers. Probe on 6fba4d1e…'s image: 1.5 / 15 / 1 / 2. Articles extracted between the two changes stay empty until re-extracted.
- 2026-11-02: AI SAM prompt section (googleVisionProvider.buildPrompt aiSamSection) replaced with the user's "AI SAM — AGGRESSIVE GARMENT INDUSTRY ESTIMATION" text: objective (aggressive, commercially achievable SAM), image analysis, per-process guidelines (cutting / stitching / ironing / finishing), estimation rules (always positive, minutes, max 2 dp, no breakdowns). The generic per-piece ranges were dropped. Output placeholder in OUTPUT FORMAT unchanged (descriptive, not 0).
- 2026-11-02: Gemini extraction prompt (googleVisionProvider.buildPrompt, shared by FG Extraction page and raw_article/SRM) replaced with the user's "FASHION GARMENT IMAGE ATTRIBUTE EXTRACTION AND STRICT DATABASE VALIDATION SYSTEM" prompt: 1 category context (Division / Sub-Division / Major Category — new FashionExtractionRequest.majorCategory passed by all three callers), 2 image analysis, 3 strict database rules (grid = the allowed lists), 4 M_AGE_GROUP (4 fixed values), 5 pattern, 6 embroidery, 7 print, 8 validation, 9 AI SAM. Its [INSERT …] placeholders were filled with the existing pattern / embroidery / print definitions. Kept from the old prompt because the code depends on them: 10 field-specific and board/tag OCR rules (neck details, child belt, belt rule, zone inspection incl. macro/main MVGR, M_FAB2, weave guidance, bottom fold, OCR of vendor/design/PPT/price/size/GSM/G-weight, FAB line → yarn_01/yarn_02/fabric_main_mvgr, colour OCR, lycra, wash, patch NUM), and 11 the OUTPUT FORMAT JSON (metadata / ai_sam / attributes {rawValue, schemaValue, visualConfidence, reasoning} / all_extracted_attributes) — parseResponse needs it. Dropped: the old "lookup machine" identity, garment-type conditional lists, examples, terminology, checklists and stray JSON. Probe on 6fba4d1e…'s image (IB_BERMUDA, 39 grid attrs): before 16 filled / 16.4k input tokens, after 15 filled / 13.9k tokens; values parsed fine. Old prompt text saved in the session scratchpad (old_extraction_prompt.txt).
- 2026-11-02: AI SAM prompt section replaced again with the user's "AI SAM — AGGRESSIVE, CONSISTENT GARMENT SAM" text (construction analysis, per-process rules incl. cutting = bulk time per piece, aggressive estimation rules, consistency/validation, ai_sam output requirements). Rest of the extraction prompt unchanged.
- 2026-11-02: AI SAM prompt section replaced with the user's "AI SAM — UNIVERSAL GARMENT INDUSTRY ESTIMATION" text: garment context (Division = request.department, Sub-Division = request.subDepartment, Major Category = request.majorCategory || categoryName), category SAM benchmarks (samBenchmarks = null, so the prompt's own fallback "No category-specific benchmark supplied…" is shown — image only), construction analysis, per-process rules, aggressive estimation, consistency, output. raw_article/SRM path sends no division/sub-division, so those show "not supplied" there.
- 2026-11-02: AI SAM prompt section replaced with the user's "AI SAM ESTIMATION PROMPT" (Industrial Engineer role; analyse garment; cutting / stitching / ironing / finishing considerations; BGT benchmark rules; realistic, not idealised, estimates; internal validation). Two adaptations: its output example uses "number" instead of 0.00 (Gemini copies 0s → blank AI SAM), and "return JSON only" now means fill the "ai_sam" field of the main output. ai_sam now also carries total_sam (ignored by parseAiSam; the card sums itself). No benchmark is sent (image only). Probe on 6fba4d1e…: 17 attributes filled, AI SAM 2.5 / 15 / 1.5 / 2 (total 21), $0.0115 per image.
- 2026-11-02: AI SAM prompt section replaced with the user's "AI GARMENT SAM ESTIMATION — OPERATION-BASED IE APPROACH" (role, 6 stages: construction analysis, operation-wise time estimation per department, benchmark calibration, estimation rules, internal validation, JSON output). Adapted: Stage 6 example numbers (5.00 / 20.50 / 6.00 / 4.50 / 36.00) replaced by "number" placeholders, and output goes into the "ai_sam" field of the main JSON. Probe on 6fba4d1e…: AI SAM 1.8 / 12.5 / 1.5 / 1.2 (total 17), 14 attributes, $0.0114 per image.
- 2026-11-02: AI SAM prompt (Stage 4 rules) now states the production basis explicitly: bulk production of 500+ pieces per style — spreading / marker / set-up shared across the lay, balanced production line, no sample or small-batch time. Keeps AI SAM on the same basis as BGT / ACT SAM (bulk).
- 2026-11-02: AI SAM production basis changed from bulk (500+ pcs) to SINGLE-PIECE production: full spreading / marker / cutting / set-up charged to the one piece, one operator makes the whole garment (make-through). Expect higher SAM than before and higher than BGT / ACT SAM (which are bulk figures).
- 2026-11-02: FG New article page — unsaved costing cards (CMP COST, B TRIM, V. ADD, PKG COST) are no longer lost, with no extra API calls while typing. (B) Leave popup: sidebar navigation, the header back button and ◀ ▶ go through a new leave guard (shared/utils/leaveGuard.ts — BrowserRouter has no blocker) — "Unsaved changes in …: Stay / Leave without saving / Save & leave" (saves each card; a failed save keeps you on the page). Refresh / close tab / typed URL get the browser's "Leave site?" warning. Only user-typed changes trigger it (getUserEditedCards; CMP master presets and B TRIM master auto-fill don't). (C) Local drafts: features/approver/components/cardDrafts.tsx useCardDraft — each card copies its unsaved state to localStorage (fgCardDraft:v1:<articleId>:<card>, 400 ms after typing) incl. CMP's UI-only SAM / SAM VAL cells; reopening the article shows an amber "Unsaved changes from <time> were kept on this computer — Restore / Discard" banner on the card. Drafts are removed on card Save, Save & leave, Leave without saving, Discard, article approve (Save & Submit) or reject (detail page and dashboard Reject selected), and after 7 days. Drafts only on the New page (draftId omitted on the Created page / locked articles). Browser back button is not intercepted — the draft covers it.
- 2026-11-02: Fix GM Save & Submit error "for SELECT DISTINCT, ORDER BY expressions must appear in select list" (Postgres 42P10) in zmmGMArtCreationService — the 2026-10-29 HSN lookup combined SELECT DISTINCT with ORDER BY (hsn_cd IS NULL …). Removed DISTINCT (LIMIT 1 makes it unnecessary). Every GM submit since 29-Oct failed at this query before reaching SAP.
- 2026-11-04: extraction_results_flat copied to Snowflake: V2RETAIL.ARTICLE_CREATION.EXTRACTION_RESULTS_FLAT (79,085 rows, 361 columns, snapshot of 2026-11-04 ~10:06 IST). Path: DuckDB export of the Supabase table to Parquet, PUT to stage V2RETAIL.ARTICLE_CREATION.FLAT_STAGE, table created with INFER_SCHEMA, COPY INTO MATCH_BY_COLUMN_NAME. Column names are lower-case and must be double-quoted ("approval_status"); JSONB columns are text (use PARSE_JSON). Role DATA_PLATFORM_ADMIN cannot create databases, only schemas in V2RETAIL. One-time copy: no sync.
- 2026-11-04: Snowflake copy narrowed to APPROVED (Created-page) articles only: deleted 49,166 PENDING/REJECTED rows; V2RETAIL.ARTICLE_CREATION.EXTRACTION_RESULTS_FLAT now holds 29,919 APPROVED rows. Future refreshes must export with WHERE approval_status = 'APPROVED'.
- 2026-11-04: Snowflake EXTRACTION_RESULTS_FLAT: created_at, updated_at and approved_at had loaded as NUMBER (microseconds since 1970; the Parquet held Postgres timestamp-without-time-zone as integers). The table was rebuilt with TO_TIMESTAMP_NTZ(col, 6) (SELECT * REPLACE, column order kept, then SWAP). The values match Supabase exactly. extraction_date (DATE), sap_lock_until and set_linked_at (TIMESTAMP_NTZ) were already correct.
- 2026-11-04: Snowflake EXTRACTION_RESULTS_FLAT now has approved_by_name and approved_by_email, placed right after approved_by and filled from Supabase users (66 approvers). Rebuilt with a CTAS LEFT JOIN on a temporary user list, then SWAP. 29,429 of the 29,919 APPROVED rows have an approver; the other 490 have approved_by NULL in Supabase too.

### 2026-11-04 — Nightly Snowflake sync (changed rows only)
- `C:\jobs\snowflake-sync\sync_flat.py`, Windows task **"Article Flat to Snowflake"**, daily 00:00 IST (runs as Administrator, only while logged on; start-when-available, 2 retries).
- Each run: watermark = last OK run in `V2RETAIL.BRONZE.ARTICLE_CREATION_SYNC_LOG` − 10 min → exports APPROVED rows with `updated_at` > watermark (+ approver name/email; filter + join run inside Postgres via `postgres_query`) and all APPROVED ids → MERGE on id into `BRONZE.ARTICLE_CREATION_EXTRACTION_RESULTS_FLAT` → deletes rows no longer APPROVED. Guards: column check, stage row counts, max 10% deleted.
- Timestamps sent as text so Snowflake gets TIMESTAMP_NTZ (stage file format has USE_LOGICAL_TYPE=false).
- First run 2026-11-04: full load 30,035; second run 23 changed rows, counts equal (30,040).
- `Backend/prisma/flat_updated_at_trigger.sql`: trigger so `updated_at` changes on every write (raw SQL too, skips sap_lock_until-only). **Not applied** — execution was declined; run it in Supabase SQL editor. Until then raw-SQL changes (syncSetsFromRaw set fields, backfills) aren't picked up.

### 2026-11-04 — Snowflake sync card (Admin › Expenses) + backend sync
- New card **Snowflake sync** under Vendor master sync (`#snowflake`, nav item "Snowflake sync"): rows, last sync (IST), last run (rows sent / removed / duration / who / server), Refresh, Sync Now.
- Backend `snowflakeFlatSyncService.ts` (Node port of the Python job, `snowflake-sdk` key-pair JWT): watermark from `BRONZE.ARTICLE_CREATION_SYNC_LOG` − 10 min → changed APPROVED rows as NDJSON (row_to_json, timestamptz → UTC) + all APPROVED ids → PUT to user stage `@~/article_flat_sync/<runId>` → per-run transient staging tables → MERGE on id + delete non-approved, in one transaction. Same guards (column check, stage counts, ≤10% deletes). Log rows now have TRIGGERED_BY (`cron` / `admin:<email>` / `windows-task`) and SOURCE (`NODE_ENV@host`); all log times UTC.
- Endpoints: `GET /api/admin/snowflake-sync/status`, `POST /api/admin/snowflake-sync/sync` (202, poll status).
- Cron in `index.ts`: daily 00:00 IST when `SNOWFLAKE_SYNC_CRON=true`, or by default in production; needs env.
- Env: `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PRIVATE_KEY_B64` (base64 of unencrypted .p8), `SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`. Without them the card shows "Not configured".
- Windows task "Article Flat to Snowflake" stays until prod has the code + env, then disable it.
