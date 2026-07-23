# Changelog & Recent Development

> Rolling log of significant development. Newest entries first.
> Detailed subsystem docs live in the numbered notes ([[00 - Index]]); this note records *what changed and when*.

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
