# Pending Issues & TODOs

#bugs #todos #pending

← [[00 - Index]]

---

## 🔴 Priority 1 — Broken Features (404s in production)

### Missing Backend Routes for Article Creation Buttons

Three buttons exist in the approver card UI but their backend routes are **NOT registered**.  
Clicking them returns **404 Not Found**.

| Button | Frontend call | Status |
|--------|--------------|--------|
| Create Fabric Article | `POST /api/approver/create-fabric-article` | ❌ No route |
| Create Body Article | `POST /api/approver/create-body-article` | ❌ No route |
| Proceed for FG Article | `POST /api/approver/proceed-fg-article` | ❌ No route |

**Where buttons live**:
- `Frontend/src/features/approver/components/ApproverArticleList.tsx` lines 784, 835
- `Frontend/src/features/approver/pages/ApproverDashboard.tsx` lines 637–710

**Fix needed**:
1. Add handler methods in `Backend/src/controllers/ApproverController.ts`
2. Register 3 routes in `Backend/src/routes/approver.ts`

**Body format sent**: `{ ids: [itemId] }`

> This is also documented in [[05 - Approver Flow]]

---

## 🟡 Priority 2 — Temp Debug Code (cleanup)

### TEMP DEBUG logs in ApproverController.ts

Now that the impAtrbt2 refresh bug is fixed, these should be removed:

```
Line 1104: // TEMP DEBUG: log impAtrbt2 flow
Line 1105: console.log(`[updateItem] impAtrbt2 received in body: ...`)
Line 1334: // TEMP DEBUG  
Line 1335: console.log(`[updateItem] Final data keys being saved: ...`)
Line 1336-1337: impAtrbt2 in final data checks
```

**File**: `Backend/src/controllers/ApproverController.ts`

### DEBUG log in enhancedExtractionController.ts

```
Line 273: // DEBUG: Log token/cost data before saving
Line 274: console.log('💰 [DEBUG] Token/Cost Data:', {...})
```

**File**: `Backend/src/controllers/enhancedExtractionController.ts`

---

## 🟡 Priority 3 — Deferred Features

### Variant RFC (ZMM_VAR_ART_CREATION_RFC) Disabled

- **Location**: `Backend/src/controllers/ApproverController.ts` line 1558
- **Service ready**: `Backend/src/services/zmmVarArtCreationService.ts` fully implemented
- **Blocked by**: SAP team needs to make the RFC endpoint live
- **To activate**: uncomment the block at line 1558 in `approveItems`
- SAP endpoint configured at: `http://192.168.151.36:9005/api/ZMM_VAR_ART_CREATION_RFC`

### User Feedback Not Persisted to DB

- **File**: `Backend/src/routes/userFeedback.ts`
- `POST /api/user-feedback/correction` — logs to console only, `// TODO: Store in DB`
- `GET /api/user-feedback/stats` — returns hardcoded empty stats
- **Impact**: User correction data for AI learning is lost
- **Fix**: Add a `UserFeedback` model to Prisma schema, write to DB

---

## 🟢 Priority 4 — Housekeeping

### Prisma Temp Binary Files in Git

Multiple `query-engine-windows.exe.tmp*` files are tracked in git:
- Path: `Backend/src/generated/prisma/query-engine-windows.exe.tmp*`
- These are OS temp files created by Prisma during development
- Should be added to `.gitignore`

### Watcher Route Missing Role-Based Auth

- `Backend/src/index.ts` line 229
- `// TODO: Add requireApprover middleware` comment
- Currently only API key auth (`authenticateWatcher`), no role check

### develop ↔ main Merge Cadence

- develop was 27 commits behind main before the 2026-05-02 merge
- Consider a more frequent merge schedule (weekly or per feature)

---

## ✅ Recently Fixed (reference)

| Watcher cron jobs disabled | watcher/index.js | 2026-07-23 — both 12 PM & 8 PM scans commented out; re-enable `CRON_SCHEDULES.forEach` block to restore |

| Issue | Fixed in | Commit |
|-------|---------|--------|
| impAtrbt2 not refreshing on approver card after save | develop | `a746fe8`, `db1639d` |
| Stale localValues after save (UI showed old value) | develop | `db1639d` |
| Full reload on every save (now optimistic) | develop | `db1639d`, `effb1d2` |
| referenceArticleDescription wrongly mandatory | develop | `4d55b3d`, `3cbf79c` |
| Missing braces in ApproverDashboard after edit | develop | `d9afcaa` |
| SRM records triggering kids duplication | develop | `a938073` |
| SRM records triggering variant creation | develop | `a938073` |
| pptNumber populated by AI extraction | develop | `b9b8dc9` |
| Mandatory fields from Excel grid not enforced | develop | `936bb99`, `7cd2ee6` |
| 429 Too Many Requests on approver page load | develop | `ed9d598`, `d80b6a0` |
