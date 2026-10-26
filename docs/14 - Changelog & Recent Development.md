# Changelog & Recent Development

> Rolling log of significant development. Newest entries first.
> Detailed subsystem docs live in the numbered notes ([[00 - Index]]); this note records *what changed and when*.

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
