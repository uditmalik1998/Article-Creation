# Image Ingestion — All Entry Points

#ingestion #watcher #srm #upload

← [[00 - Index]] | [[02 - Full Workflow]]

---

## Three Entry Paths

```mermaid
flowchart LR
    subgraph SOURCES["Image Sources"]
        UNC[UNC Network Share\n\\\\server\\folder]
        BROWSER[Browser Upload\nUser drags image]
        SRMAPI[SRM API\nPresentation records]
    end

    subgraph SERVICE["Services"]
        WATCHER[watcher/index.js\nPolls UNC folder]
        UI[SimplifiedExtractionPage\nFrontend]
        SRMSVC[srmSyncService.ts\nFetch + upsert]
    end

    subgraph ENDPOINT["Backend Endpoints"]
        EP1[POST /api/watcher/extract/upload\nauthenticateWatcher]
        EP2[POST /api/user/simplified/extract-upload\nauthenticate]
        EP3[POST /api/watcher/sync-srm\nauthenticateWatcher]
    end

    UNC --> WATCHER --> EP1
    BROWSER --> UI --> EP2
    SRMAPI --> SRMSVC --> EP3
```

---

## Path 1 — Watcher Service

**File**: `watcher/index.js`  
**How it works**:
- Polls a configured UNC folder path on a schedule
- Detects new image files (JPEG/PNG)
- POSTs each image as multipart/form-data to `/api/watcher/extract/upload`
- Auth: `X-API-Key: watcher-fashion-2026`

**Metadata sent with image**:
```
watcher_division        — e.g. "MENS"
watcher_vendor_code     — vendor identifier
watcher_major_category  — e.g. "COTTON SHIRTS"
watcher_sub_division    — e.g. "TOPWEAR"
image_unc_path          — full UNC path (unique identifier for dedup)
```

**Dedup**: `imageUncPath` is unique in DB — if same path re-submitted, it's skipped/updated, not duplicated.

**Processing**: Routed to `EnhancedExtractionController.extractFromUploadVLM` → full AI pipeline

---

## Path 2 — User Upload (Frontend)

**Page**: `Frontend/src/features/extraction/pages/SimplifiedExtractionPage.tsx`  
**Endpoint**: `POST /api/user/simplified/extract-upload`  
**Auth**: JWT Bearer token (authenticated user)

**How it works**:
- User drags/drops or selects image file (max 15MB, JPEG/PNG/WebP)
- Frontend converts to FormData
- Backend: multer disk storage → base64 → VLM pipeline
- Uses simplified 27-attribute schema (vs full 40+ for watcher)

**Metadata provided by user**:
- Division, Sub Division, Major Category, Vendor Name, Design Number
- Since 2026-10-14 Division, Sub-Division and Major Category are picked together on one setup screen before upload (see [[11 - Frontend Architecture]]). The FG page actually calls `POST /api/user/extract/base64` (`enhancedExtractionController.extractFromBase64VLM`) with `department`, `subDepartment` and, now, `majorCategory`: the chosen major category replaces the extracted `major_category` attribute before persisting, drives grid snapping (`majorMetaValue`) and is written to `extraction_results_flat.major_category` with the division/sub-division scope override. Per row, an edited `major_category` cell wins over the page-level choice (`useBatchExtraction`).

---

## Path 3 — SRM API Sync

**File**: `Backend/src/services/srmSyncService.ts`  
**Endpoint**: `POST /api/watcher/sync-srm`  
**Auth**: Watcher API key

**How it works**:
```mermaid
sequenceDiagram
    participant T as Trigger (manual/cron)
    participant S as srmSyncService
    participant SRMA as SRM API
    participant DB as ExtractionResultFlat

    T->>S: syncFromSrmApi()
    S->>SRMA: GET /presentations
    SRMA-->>S: [{presentation_no, design_number, image_url, ...}]
    loop For each record
        S->>DB: Find by pptNumber + designNumber
        alt Already exists
            S->>DB: PATCH imageUrl only
        else New record
            S->>DB: INSERT (no AI extraction)
        end
    end
    S-->>T: {inserted, skipped, errors}
```

**Key rules for SRM records**:
- `pptNumber` set to `presentation_no` — **never overwritten by AI extraction**
- `imageUrl` set to SRM-provided URL
- `isGeneric = true` (no size variants auto-created)
- `kidsDivisionDuplication` skipped
- AI extraction skipped entirely — just raw data from SRM

**Fields populated by SRM** (others remain null for approver to fill):
```
pptNumber, imageUrl, designNumber, division, subDivision, majorCategory, vendorCode
```

---

## Path Comparison

| Property | Watcher | User Upload | SRM Sync |
|----------|---------|-------------|----------|
| AI Extraction | ✅ Full VLM | ✅ Simplified | ❌ None |
| Size variants auto-created | ✅ | ✅ | ❌ |
| Kids duplication | ✅ | ✅ | ❌ |
| PPT Number set | ❌ Never | ❌ Never | ✅ Always |
| Trigger | Automated (folder poll) | Manual (user) | Manual/cron |
| Auth | API Key | JWT | API Key |
| Dedup key | `imageUncPath` | None | `pptNumber + designNumber` |

### Major category dropdown — Option A built (2026-10-22)

Extraction › FG Article setup row. The current Popover panel renders narrower than its field, and the list is plain names. 5 directions: https://claude.ai/artifact/Rg15A7xDyCmHBXA3Tp5zkb
- A: same look as Sub-division, with MC codes and keyboard
- B: grouped by IB_/JB_/YB_
- C: garment × prefix grid
- D: type in the field, recents first
- E: tap chips under the row

The Sub-division dropdown stays as is. **Option A built** in `SimplifiedExtractionPage.tsx`:
- The panel matches the field width. The fix was `w-[var(--radix-popover-trigger-width)]`; the old `w-[--…]` didn't apply.
- The open trigger gets a slate ring and an up chevron.
- Search sits inside the panel and matches the name or the MC code, with an "N of M" count.
- Rows show the MC code from `getMcCodeByMajorCategory`. The selected row is bold with a slate fill and a check.
- Keyboard: ↑ ↓ / Enter / Esc. The hint footer was removed at the user's request (2026-10-22). The listbox has proper roles.
- Not checked in a signed-in browser.
