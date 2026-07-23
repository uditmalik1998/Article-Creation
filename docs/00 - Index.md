# V2Kart Article Creation System — Knowledge Base

> **Product**: AI-powered fashion attribute extraction & SAP article creation for V2Kart / V2Retail  
> **Live Frontend**: https://articles.v2retail.net  
> **Live Backend**: https://v2-article-backend.azurewebsites.net  
> **Repo**: github.com/uditmalik1998/Article-Creation  

---

## Navigation

| Note | What it covers |
|------|---------------|
| [[01 - System Overview]] | Tech stack, deployment, repo structure |
| [[02 - Full Workflow]] | End-to-end journey: image → SAP article |
| [[03 - Image Ingestion]] | Watcher, user upload, SRM sync — all entry points |
| [[04 - AI Extraction Pipeline]] | VLM models, prompts, 40+ attributes extracted |
| [[05 - Approver Flow]] | Review → edit → validate → approve |
| [[06 - SAP Sync & RFC]] | ZMM_ART_CREATION_RFC, variant RFC, field mapping |
| [[07 - Variant & Kids Logic]] | Size variants, color variants, kids duplication |
| [[08 - Data Models]] | DB schema — ExtractionResultFlat, 360article, enums |
| [[09 - Auth & Roles]] | JWT, RBAC, scoping rules |
| [[10 - Admin Panel]] | Hierarchy, attributes, users management |
| [[11 - Frontend Architecture]] | Pages, components, data flow |
| [[12 - Backend Architecture]] | Routes, controllers, services map |
| [[13 - Pending Issues]] | Bugs, TODOs, deferred features |
| [[14 - Changelog & Recent Development]] | Rolling log of what changed and when |

### Deep-Dive / Handover Notes

| Note | What it covers |
|------|---------------|
| [[ATTRIBUTE_WRITE_PATH]] | How attributes flow to SAP AUSP (write path) |
| [[SPEC_MC_ATTRIBUTE_SOT]] | MC × attribute source-of-truth spec + Supabase↔SAP reconciliation |
| [[UDIT_HANDOVER_ARTICLE_SOT]] | Article attributes SoT + SAP sync + article creation E2E |
| [[UDIT_HANDOVER_KSML_CLASS_CHAR_2026-06-22]] | MDM KSML class/char assignment + V2 BAPI audit |
| [[2026-07-08-model-generation-from-article-list-design]] | Spec: bulk model generation from article list |
| [[2026-06-29-pd-to-pending-migration]] | Plan: PD → PENDING status migration |

---

## One-Line Workflow

```
Image (watcher/upload/SRM) → AI extraction → ExtractionResultFlat → Approver edits → 
Approve → ZMM_ART_CREATION_RFC → SAP article number → Variants created → ZMM_VAR_RFC
```

---

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `Backend/src/controllers/ApproverController.ts` | All approver logic (1804 lines) |
| `Backend/src/services/zmmArtCreationService.ts` | Generic article → SAP |
| `Backend/src/services/zmmVarArtCreationService.ts` | Variant articles → SAP (disabled) |
| `Backend/src/services/srmSyncService.ts` | SRM API → DB direct write |
| `Backend/src/services/variantCreationService.ts` | Size variant generation |
| `Backend/src/services/kidsDivisionDuplicationService.ts` | KIDS auto-duplication |
| `Frontend/src/features/approver/pages/ApproverDashboard.tsx` | Main approver UI |
| `Frontend/src/features/approver/components/ApproverArticleList.tsx` | Card grid view |
| `Frontend/src/data/majCatAttributeMap.ts` | Mandatory fields per major category |
| `Frontend/src/data/majorCategoryMcCodeMap.ts` | Major category → MC code |

#v2kart #article-creation #fashion #ai-extraction
