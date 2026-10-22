# Full End-to-End Workflow

#workflow #process #overview

← [[00 - Index]]

---

## Complete Journey: Image → Live SAP Article

```mermaid
flowchart TD
    subgraph INGEST["📥 INGESTION (3 paths)"]
        W[Watcher Service\nAuto-scans UNC folder]
        U[User Upload\nManual via UI]
        SRM[SRM API Sync\nPresentation records]
    end

    subgraph AI["🤖 AI EXTRACTION"]
        Q[Queue Manager\nmax 4 concurrent\n40k TPM limit]
        VLM[VLM Service\nClaude / GPT-4o /\nFashionCLIP]
        PROMPT[Prompt Builder\ndepartment + category context]
        ATTRS[40+ Attributes Extracted\nFabric, Body, VA Acc, VA Prcs]
    end

    subgraph PERSIST["💾 DATA PERSISTENCE"]
        FLAT[ExtractionResultFlat\nOne row per article]
        MIRROR[360article mirror\nfire-and-forget]
        BACKFILL[Auto Backfills\nmcCode, HSN, segment,\narticleDescription]
    end

    subgraph APPROVER["👤 APPROVER REVIEW"]
        DASH[ApproverDashboard\nFilter / Search / Select]
        CARD[ApproverArticleList\nInline card editing]
        MODAL[Edit Modal\n3 tabs: Core / Attrs / SAP]
        VALIDATE[Mandatory Field\nValidation per majorCategory]
        APPROVE[Batch Approve]
        REJECT[Reject with reason]
    end

    subgraph VARIANTS["🔀 VARIANT CREATION"]
        SIZE[Size Variants\nfrom maj_cat_sizes]
        COLOR[Color Variants\nmanual Add Color]
        KIDS[Kids Duplication\nauto for KIDS division]
    end

    subgraph SAP["🏭 SAP SYNC"]
        RFC1[ZMM_ART_CREATION_RFC\nGeneric article]
        RFC2[ZMM_VAR_ART_CREATION_RFC\nVariant articles — disabled]
        SAPNUM[SAP Article Number\nreturned in response]
        IMGCOPY[Approved Image\ncopied to article-master R2 bucket]
    end

    W --> Q
    U --> Q
    SRM -->|direct DB write\nno AI| FLAT

    Q --> PROMPT
    PROMPT --> VLM
    VLM --> ATTRS
    ATTRS --> FLAT
    FLAT --> MIRROR
    FLAT --> BACKFILL

    FLAT -->|status=PENDING| DASH
    DASH --> CARD
    CARD --> MODAL
    MODAL --> VALIDATE
    VALIDATE -->|pass| APPROVE
    VALIDATE -->|fail| MODAL
    APPROVE --> REJECT

    APPROVE --> SIZE
    SIZE --> COLOR
    APPROVE --> KIDS

    APPROVE --> RFC1
    RFC1 --> SAPNUM
    SAPNUM --> RFC2
    RFC1 --> IMGCOPY

    SAPNUM -->|sapSyncStatus=SYNCED| FLAT
```

---

## Stage-by-Stage Detail

### Stage 1 — Image Ingestion

Three ways images enter the system:

| Path | Trigger | AI Run? | Key field set |
|------|---------|---------|--------------|
| **Watcher** | File appears in UNC share | Yes | `imageUncPath` |
| **User Upload** | Manual drag-drop in UI | Yes | `imageUrl` (R2) |
| **SRM Sync** | Cron / manual trigger | **No** | `pptNumber`, `imageUrl` |

> See [[03 - Image Ingestion]] for detail.

---

### Stage 2 — AI Extraction

- Queue accepts job → VLMService picks provider (Claude primary, GPT-4o fallback)
- Prompt includes: department, division, major category context
- Output: JSON of 40+ attributes with confidence scores
- Results matched against `AttributeAllowedValue` master list (tokenization matching)

> See [[04 - AI Extraction Pipeline]] for detail.

---

### Stage 3 — Flattening & Persistence

- One `ExtractionResultFlat` row created per image/article
- Auto-derives: `mcCode`, `hsnTaxCode`, `segment`, `articleDescription`, `season`
- Mirrors to `360article.article_360_flat` (analytics) — fire-and-forget, never blocks
- Startup backfills run at every backend start to repair missing derived fields

---

### Stage 4 — Approver Review

- Approvers see `status=PENDING` articles scoped to their division
- They can inline-edit dropdowns on the card (all 4 attribute groups)
- Full edit modal has 3 tabs: Core fields / Attributes / Business & SAP
- Mandatory fields checked per majorCategory from Excel grid (`maj-cat-mandatory.json`)
- Always mandatory: `mrp` (non-zero), `impAtrbt2`; `referenceArticleDescription` optional

> See [[05 - Approver Flow]] for detail.

---

### Stage 5 — Approval & SAP Sync

1. Approver selects items → clicks Approve
2. Each item validated again server-side
3. `approvalStatus = APPROVED`, `approvedBy`, `approvedAt` set
4. `syncApprovedItemsToSap()` called:
   - `ZMM_ART_CREATION_RFC` → returns SAP article number
   - `sapArticleId` written back, `sapSyncStatus = SYNCED`
5. Approved image copied from source to `article-master` R2 bucket

> See [[06 - SAP Sync & RFC]] for detail.

---

### Stage 6 — Variant Creation

- After generic article approved → size variants auto-created (per Excel mapping)
- Optional: approver adds color variants via "Add Color" button
- KIDS division: auto-duplicates article to sibling categories (e.g., KGU → all kids sub-cats)

> See [[07 - Variant & Kids Logic]] for detail.

---

## Status State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING : Article extracted / SRM synced
    PENDING --> APPROVED : Approver approves
    PENDING --> REJECTED : Approver rejects
    APPROVED --> [*] : SAP sync completes
    REJECTED --> PENDING : Re-submitted (manual)

    state APPROVED {
        NOT_SYNCED --> PENDING_SYNC : sync triggered
        PENDING_SYNC --> SYNCED : RFC success
        PENDING_SYNC --> FAILED : RFC error
    }
```

---

## Role Access by Stage

| Stage | CREATOR/USER | APPROVER | CATEGORY_HEAD | ADMIN |
|-------|-------------|----------|---------------|-------|
| Upload images | ✅ | ❌ | ❌ | ✅ |
| View extraction | ✅ | ❌ | ❌ | ✅ |
| Approver dashboard | ❌ | ✅ (scoped div+subdiv) | ✅ (scoped div) | ✅ (all) |
| Approve / Reject | ❌ | ✅ | ✅ | ✅ |
| Admin panel | ❌ | ❌ | ❌ | ✅ |
| Export Excel | ❌ | ✅ | ✅ | ✅ |
