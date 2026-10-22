---
date: 2026-06-17
owner: Udit Malik
author: Akash Agarwal
topic: Article Attributes — Source of Truth, SAP Sync, Article Creation E2E
repo: github.com/akash0631/v2ArticleCreation
supersedes: SIZE_VALIDATION_HANDOVER_2026-06-12 (size×MC only — this is the full picture)
status: ACTIVE
---

# Udit Handover — Article Attributes SoT + SAP Sync + Article Creation E2E

## TL;DR

The Article-Creation app (`articlecreation.v2retail.net`) is now the **planning-side source of truth** for article master data. AI extracts attributes from product images → app stores them → app pushes article + attributes into **standard SAP tables** via the V2 SAP RFC proxy. From this week we stopped writing to legacy `ZCT04_CHARACTER` and now only write to standard `AUSP` (characteristic values) backed by `CT04` (characteristic master, tcode CT04). Everything below is what you need to own this end-to-end.

There are three independent surfaces in this stack, all wired and live:

1. **Attribute Source of Truth** — Supabase + standard SAP `AUSP`/`KSSK`/`KLAH`/`CABN` (`CT04`). Legacy `ZCT04_CHARACTER` is now read-only/deprecated.
2. **Bidirectional SAP sync** — `sapSyncService.ts` (article create) and the bulk-patch chain (`Z_LINK_MATNR_CLASS` + `Z_ART_PATCH_RFC_V64`) for attribute updates.
3. **Article creation E2E** — VLM extraction (Gemini) → variant + attribute table → ZMM_ART_CREATION_RFC (live PROD) → MARA/MAKT/MARM/MVKE → AUSP attribute write-through.

You are the owner of (1) and (3). I own (2) for the bulk-patch path; the per-article write path inside `sapSyncService.ts` is yours.

---

## 1. Architecture (current state)

```
┌──────────────────────────── PLANNING SIDE ────────────────────────────┐
│                                                                       │
│  Buyer/Planner uploads product image(s)                                │
│             │                                                          │
│             ▼                                                          │
│  Frontend (React)  ──────────────►  Backend (Node/Express)             │
│  articlecreation.v2retail.net      articlecreation-api.v2retail.net    │
│             │                              │                           │
│             │                              ├─► Gemini VLM (image → attrs)
│             │                              ├─► Claude (normalization)  │
│             │                              ├─► PostgreSQL (Prisma)     │
│             │                              │     extraction_results_flat
│             │                              │     variants              │
│             │                              │     articles              │
│             │                              │                           │
│             │                              ├─► Supabase (Ai-auto-mdm)  │
│             │                              │     maj_cat_grid_values   │
│             │                              │     (size × MC rules)     │
│             │                              │                           │
│             │                              └─► sapSyncService.ts ──┐   │
│             │                                                      │   │
└──────────────────────────────────────────────────────────────────────│──┘
                                                                       │
                                       SAP RFC Proxy                   │
                                       sap-api.v2retail.net            │
                                       (?env=dev|qa|prod)              │
                                       X-RFC-Key + UA spoof            │
                                                                       │
                                                                       ▼
┌──────────────────────────── SAP S/4 HANA ────────────────────────────┐
│                                                                      │
│  Article master            ZMM_ART_CREATION_RFC → ZMM_ART_CRT_V3     │
│  (MARA, MAKT, MARM,        Function group ZMM_ART_CRT_V31            │
│   MVKE, MARC, …)           Writes generic article + variants         │
│                                                                      │
│  Characteristic master     CT04 — class/characteristic UI            │
│  (CABN, CABNT, AUSP,       MDM team owns the catalog                 │
│   KLAH, KSML, KSSK)        ATINNs e.g. M_FAB_MAIN_MVGR_1 = 1251      │
│                                                                      │
│  Attribute writes          Z_LINK_MATNR_CLASS (atomic class link)    │
│  (standard, no Z-table)    Z_ART_PATCH_RFC_V64 (KSML-aware writer)   │
│                            → writes AUSP rows directly               │
│                                                                      │
│  Size × MC mirror          ZART_GRID_VALUES (1515 rows)              │
│                            Z_ART_VALIDATE_VARIANT_SIZE FM            │
│                            Same rules as Supabase RPC                │
│                                                                      │
│  Legacy (deprecated)       ZCT04_CHARACTER — read-only from today.   │
│                            Do NOT add new columns. Do NOT write.     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Why this matters: every other downstream system (Snowflake BRONZE/GOLD, HHT, Power BI, allocation, Z_SB_ARTICLE OData) reads from **standard** SAP tables. The earlier `ZCT04` approach forced double-reads and special-cased every consumer. The standard-AUSP path was proven on PROD on 2026-06-16 with the V64 + link-chain test (160 cells APPLIED, 100% AUSP, 0 ZCT04). That is now the rule for all new writes.

---

## 2. Article Attribute Source of Truth

### Where each attribute lives

| Layer | Owner | Purpose | When to read |
|-------|-------|---------|--------------|
| **Postgres `extraction_results_flat`** | App | Per-image AI extraction output + user edits | UI display, audit, re-extraction |
| **Postgres `variants`** | App | Approved variant master (size × color × design) | Variant create flow, validation |
| **Supabase `maj_cat_grid_values`** | App | 1,515 ACT size×MC rules (303 MCs, 42 sizes) | Size dropdown + variant save validation |
| **SAP `AUSP` (KLART=026)** | SAP/Buyer | Final attribute values per CUOBJ (linked via INOB) | Snowflake BRONZE, HHT, Power BI, allocation |
| **SAP `KSSK`** | SAP/MDM | matnr ↔ class link (legacy + MATKL-class) | V64 chain reads this to find eligible classes |
| **SAP `CABN`/`CABNT`** | MDM team | Characteristic master (ATNAM, ATINN, data type) | Used by V64 to validate attribute is in KSML |
| **SAP `KLAH`/`KSML`** | MDM team | Class → characteristic membership | V64 routes writes only if attr is in class's KSML |
| **SAP `ZART_GRID_VALUES`** | App (push) | Mirror of Supabase maj_cat_grid_values for ZMM_ART1 BDC | Read inside Z_ART_VALIDATE_VARIANT_SIZE FM |
| **SAP `ZCT04_CHARACTER`** | DEPRECATED | Legacy denormalized attribute table | Read-only fallback for old reports. **Do not write.** |

### The rule

> **Standard SAP tables only.** App writes attributes via the V64 chain → `AUSP`. CT04 is the master (characteristic catalog) maintained by the MDM team in tcode CT04. Never insert a column into `ZCT04_CHARACTER` again.

If you see code in `sapSyncService.ts` or anywhere else trying to write `ZCT04` or call a `ZCT04_*` FM, that is the legacy V61 path and must be migrated to V64 (or simply removed — V61 still works, but writes legacy ZCT04).

### Why CT04 (not ZCT04)?

- `CT04` is the SAP standard transaction for characteristic master. Its tables (`CABN`, `CABNT`, `CAWN`, `CAWNT`) hold ATINNs (e.g. `M_FAB_MAIN_MVGR_1 = 1251`), allowed values, languages.
- `AUSP` is the standard table that holds the actual per-object value (one row per CUOBJ × ATINN).
- `ZCT04_CHARACTER` was a denormalized custom table mirroring the same data column-by-column. It was created when AUSP writes were too risky; the V64 chain (built 2026-06-16) makes AUSP writes safe.
- Downstream consumers (Z_SB_ARTICLE OData for Snowflake, HHT, allocation engine) all read from standard AUSP. Removing the ZCT04 write halves the consistency surface.

### Adding a new attribute (end-to-end)

The MDM team owns the SAP side; you own the app side. The flow is:

1. MDM team adds the characteristic in `CT04` (tcode) — creates ATINN row in `CABN`, label in `CABNT`, allowed values in `CAWN`/`CAWNT`.
2. MDM team adds it to the relevant classes in `CL02` — creates `KSML` row per class.
3. You add the attribute to `master-attributes.json` and (if it gets a different SAP name) to `map.json` in the repo.
4. You add the extraction prompt in `Backend/src/services/promptService.ts` so Gemini fills it.
5. You verify the V64 write reaches AUSP for a test matnr (curl example in §3 below).

No SAP code change required for new attributes once V64 is live. V64 is KSML-aware and writes any ATINN that exists in the matnr's class.

---

## 3. Bidirectional SAP Sync

### Direction A — App → SAP (per article on create)

Lives in `Backend/src/services/sapSyncService.ts`. Triggered by approver workflow when an extraction is approved.

Endpoint: `POST https://routemaster.v2retail.com:9010/api/ZMM_ART_CREATION_RFC` (or the sap-api proxy below, depending on `SAP_SYNC_URL` env).

Recommended endpoint going forward (already PROD-unblocked 2026-06-02):

```
POST https://sap-api.v2retail.net/api/ZMM_ART_CREATION_RFC?env=prod
Headers: X-RFC-Key: v2-rfc-proxy-2026, User-Agent: curl/8.4.0, Content-Type: application/json
```

This calls `ZMM_ART_CRT_V3` (FG `ZMM_ART_CRT_V31`) → creates `MARA` row, `MAKT` descriptions, `MARM` UoMs, `MVKE` sales views, `MARC` plant views. Returns SAP article number.

Once article is created, attribute push is a separate call (Direction B below). The split exists because creating the matnr and writing its attributes are two separate LUWs in SAP. Tying them together caused commit-conflict deadlocks in early V1.

### Direction A1 — App → SAP (per article, attribute write)

Use the V64 chain. Two FMs, called in order:

```bash
# Step 1: ensure matnr is linked to its MATKL-class (idempotent — skip if KSSK row exists)
curl -X POST 'https://sap-api.v2retail.net/api/rfc/proxy?env=prod' \
  -H 'X-RFC-Key: v2-rfc-proxy-2026' -H 'User-Agent: curl/8.4.0' \
  -d '{
    "bapiname":"Z_LINK_MATNR_CLASS",
    "IV_MATNR":"000000001112015027",
    "IV_CLASS":"112020705",
    "IV_KLART":"026"
  }'

# Step 2: write attribute values (V64 picks the right class via KSML lookup)
curl -X POST 'https://sap-api.v2retail.net/api/rfc/proxy?env=prod' \
  -H 'X-RFC-Key: v2-rfc-proxy-2026' -H 'User-Agent: curl/8.4.0' \
  -d '{
    "bapiname":"Z_ART_PATCH_RFC_V64",
    "IV_MATNR":"000000001112015027",
    "IV_CHANGES":"M_YARN=C|M_FAB_MAIN_MVGR_1=DNM_SLD",
    "IV_TEST_MODE":""
  }'
```

V64 behavior:
- Returns `{ok:true, plan:[...]}` on success.
- Returns `{ok:false, plan:[...]}` if **any** attribute is NIC (Not In Class) or LOCKED. The whole call is atomic — nothing is written.
- For mixed batches: filter to PLANNED-only attributes and retry. Reference driver: `~/.tmp/bulk_patch_diff.py` (V61 version, port the pattern).

### Direction B — App → SAP (bulk size×MC mirror)

Supabase `maj_cat_grid_values` is mirrored into SAP `ZART_GRID_VALUES`. This is the only Z-table left in the SoT path because it's reference data, not per-article state.

Push is via `Z_ART_GRID_UPSERT_BATCH` — already built, already PROD-ready (1515 rows in 8.9s in QA).

The daily sync worker (`app → SAP mirror`) is on my plate, not yours. Today the table is hand-pushed when planning edits rules; the cron lands next sprint.

### Direction C — SAP → App (reverse reconciliation)

Currently manual. When a buyer edits attributes directly in SAP (rare but happens for legacy matnrs), the app does not pick it up automatically. The Z_SB_ARTICLE OData feed publishes article+attribute deltas; if/when the app needs a reverse-sync, point it at:

```
https://sap-odata.v2retail.net/sap/opu/odata/sap/Z_SB_ARTICLE_SRV/?env=prod
```

with `BronzeBot2026` creds. Not urgent — defer until a real divergence shows up.

### Direction D — Size validation (read-only, both directions enforce)

Both flows enforce identical size×MC rules:

- App: Supabase RPC `is_size_allowed(p_major_category, p_size)` and `get_allowed_sizes(p_major_category)`.
- SAP BDC: ABAP `CALL FUNCTION 'Z_ART_VALIDATE_VARIANT_SIZE'` (Vaibhav patched ZMM_ART1 with this — see `vaibhav/` folder in the 2026-06-12 zip).

You do not need to do anything new for size validation. The work in the 2026-06-12 handover (3 PRs) is still the same checklist — that zip has the code snippets. Treat that zip's contents as a subset of this handover.

---

## 4. Article Creation E2E

### Flow

```
1. Buyer uploads product image(s) via UI
        ↓
2. Backend POST /vlmExtraction
        → Gemini VLM extracts: fabric, GSM, color, pattern, neckline, sleeve, fit, …
        → Claude normalizes to canonical attribute names (per master-attributes.json)
        → row written to extraction_results_flat
        ↓
3. Buyer reviews + edits in UI (corrections feed back to userFeedback)
        ↓
4. Buyer picks Major Category (MC) and variant sizes
        → Supabase RPC get_allowed_sizes filters dropdown
        → Backend variant POST calls is_size_allowed before INSERT (422 on fail)
        ↓
5. Approver workflow → final approve
        ↓
6. sapSyncService.syncToSap()
        → POST sap-api.v2retail.net/api/ZMM_ART_CREATION_RFC?env=prod
        → SAP creates MARA + variants + MAKT + MARM + MVKE
        → Returns sapArticleNumber, written back to articles table
        ↓
7. Attribute write-through (NEW — replaces ZCT04 write)
        → For each approved attribute: build IV_CHANGES string "ATNAM=VAL|ATNAM2=VAL2|…"
        → POST sap-api.v2retail.net/api/rfc/proxy with Z_LINK_MATNR_CLASS (idempotent)
        → POST sap-api.v2retail.net/api/rfc/proxy with Z_ART_PATCH_RFC_V64
        → Writes AUSP rows
        → On {ok:false}: filter PLANNED-only attrs, retry once
        ↓
8. Audit row written to extractions log + cost tracker
```

### What changed from the old flow

- **Old:** sapSyncService ended at step 6 (create article in SAP). Attributes were patched separately, often days later, via a batch xlsx → ZCT04 write (see [[247K Article PROD Patch 2026-06-15]] in Obsidian — 247,881 rows, 8h 43min run on PROD).
- **New:** step 7 happens immediately after step 6, same request lifecycle. AUSP is populated on article-create. ZCT04 is no longer touched.

### Code locations (in this repo)

| File | Purpose | Action |
|------|---------|--------|
| `Backend/src/services/sapSyncService.ts` | Article create call (step 6) | Add post-create attribute push (step 7) |
| `Backend/src/services/variantCreationService.ts` | Variant creation + size validation | Verify Supabase RPC call is in place (size validation) |
| `Backend/src/services/extractionService.ts` | VLM extraction orchestration | No change |
| `map.json` | Attribute → SAP API name map | Add new attrs here when MDM extends CT04 |
| `master-attributes.json` | Canonical attribute list | Add new attrs here when extending extraction |
| `Backend/src/routes/approver.ts` | Approve → sync trigger | Confirm it awaits both step 6 and step 7 |

### What to build (3 surgical PRs)

#### PR 1 — Step 7 attribute push in sapSyncService.ts

After `syncToSap()` returns `sapArticleNumber`, build the `IV_CHANGES` string from the approved attribute map and call:

```ts
// new helper
async function pushAttributesToSap(matnr: string, attributes: Record<string, string>) {
  const matkl = await fetchMatkl(matnr) // RFC_READ_TABLE MARA or cached
  // 1. ensure class link
  await rfcProxy('Z_LINK_MATNR_CLASS', {
    IV_MATNR: matnr.padStart(18, '0'),
    IV_CLASS: matkl,
    IV_KLART: '026',
  })
  // 2. write attributes
  const ivChanges = Object.entries(attributes)
    .filter(([_, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('|')
  const res = await rfcProxy('Z_ART_PATCH_RFC_V64', {
    IV_MATNR: matnr.padStart(18, '0'),
    IV_CHANGES: ivChanges,
    IV_TEST_MODE: '',
  })
  if (!res.ok) {
    // filter PLANNED-only and retry
    const planned = res.plan.filter((p: any) => p.status === 'PLANNED').map((p: any) => `${p.atnam}=${p.value}`).join('|')
    if (planned) {
      await rfcProxy('Z_ART_PATCH_RFC_V64', {
        IV_MATNR: matnr.padStart(18, '0'),
        IV_CHANGES: planned,
        IV_TEST_MODE: '',
      })
    }
  }
  return res
}

async function rfcProxy(bapiname: string, body: Record<string, any>) {
  const url = `${process.env.SAP_RFC_PROXY_URL}/api/rfc/proxy?env=${process.env.SAP_ENV || 'prod'}`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RFC-Key': process.env.SAP_RFC_KEY!,
      'User-Agent': 'v2-article-creation/1.0',
    },
    body: JSON.stringify({ bapiname, ...body }),
  })
  return r.json()
}
```

#### PR 2 — Drop ZCT04 write paths

Search the codebase for any reference to `ZCT04`, `Z_CHAR_PATCH`, `Z_ART_PATCH_RFC_V61`, `Z_ART_PATCH_RFC_V62`. Replace with V64 or delete if redundant. The MM41 BDC path through `ZMM_ART_CREATION_RFC` does not write ZCT04 — only the bulk patch path did. If you find none, just confirm it in the PR description.

#### PR 3 — Wire size validation RPCs (carried over from 2026-06-12 handover)

The 3 PRs in the 2026-06-12 handover are still valid:

- Backend variant save: call `is_size_allowed` before INSERT, 422 on fail.
- Frontend dropdown: populate via `get_allowed_sizes` keyed on selected MC.
- Bulk xlsx upload: `validate_variant_sizes` batch check, return invalid rows in error response.

If these are already merged, skip. If partially merged, finish them.

---

## 5. Environments & Endpoints

### SAP RFC Proxy

| Env | URL | Auth |
|-----|-----|------|
| DEV | `https://sap-api.v2retail.net/api/rfc/proxy?env=dev` | `X-RFC-Key: v2-rfc-proxy-2026` + UA spoof |
| QA  | `https://sap-api.v2retail.net/api/rfc/proxy?env=qa`  | same |
| PROD| `https://sap-api.v2retail.net/api/rfc/proxy?env=prod`| same |

**Gotchas (learned the hard way):**
- `env` is read from the **query string**, not the body. Body `env` is silently ignored, defaults to DEV. Always `?env=prod`.
- CF blocks `Python-urllib/*` and similar default UAs with WAF error `1010`. Spoof `User-Agent: curl/8.4.0` (or anything that isn't a stock library default).
- Request body is **flat**. Don't nest under `params`, `tables`, `TABLES`, `data` — the proxy reads top-level keys only and silently drops nested. (Burned 2h on this once; check memory `reference_sap_api_proxy_payload_shape`.)
- For batch FMs, pass arrays as the top-level table param name (e.g. `IT_ROWS: [...]`).

### OData (read-only, for reverse-sync future)

| Env | URL | Service |
|-----|-----|---------|
| DEV | `https://sap-odata.v2retail.net/sap/opu/odata/sap/Z_SB_ARTICLE_SRV/?env=dev` | Z_SB_ARTICLE |
| QA  | `https://sap-odata-qa.v2retail.net/sap/opu/odata/sap/Z_SB_ARTICLE_SRV/` (note: separate hostname) | Z_SB_ARTICLE |
| PROD| `https://sap-odata.v2retail.net/sap/opu/odata/sap/Z_SB_ARTICLE_SRV/?env=prod` | Z_SB_ARTICLE |

Creds: `BRONZE_BOT / BronzeBot2026` (do not use POWERBI — that user is back to legacy n8n password).

### Supabase

- Project: `Ai-auto-mdm` (`hgdftqswlvkspzjtlrll`, ap-south-1)
- Functions live: `is_size_allowed`, `get_allowed_sizes`, `validate_variant_sizes`
- Table: `maj_cat_grid_values` (1,515 rows)
- Keys: ANON + SERVICE_ROLE in repo `.env` and `~/.secrets/article-creation.env`. **Do not rotate.**

### Backend env vars to set (add to `.env.example` if missing)

```
SAP_RFC_PROXY_URL=https://sap-api.v2retail.net
SAP_RFC_KEY=v2-rfc-proxy-2026
SAP_ENV=prod                               # dev|qa|prod
SAP_SYNC_URL=https://sap-api.v2retail.net/api/ZMM_ART_CREATION_RFC
SAP_SYNC_ENABLED=true
SAP_RETRY_VENDOR_ONLY_ON_UNKNOWN_ELEMENT=false
SUPABASE_URL=https://hgdftqswlvkspzjtlrll.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from ~/.secrets/article-creation.env>
SUPABASE_ANON_KEY=<from ~/.secrets/article-creation.env>
```

---

## 6. Smoke Tests (run after each PR)

### Article create + attribute write (PROD, single article)

```bash
# 1. Create article via app's normal approver flow OR direct curl:
curl -X POST 'https://sap-api.v2retail.net/api/ZMM_ART_CREATION_RFC?env=prod' \
  -H 'Content-Type: application/json' \
  -H 'X-RFC-Key: v2-rfc-proxy-2026' \
  -d '{ "IM_DATA": [ { /* article payload from sapSyncService */ } ] }'
# Expect: { ok: true, sapArticleNumber: "1xxxxxxxxxx" }

# 2. Lookup MATKL
curl -X POST 'https://sap-api.v2retail.net/api/rfc/proxy?env=prod' \
  -H 'X-RFC-Key: v2-rfc-proxy-2026' -H 'User-Agent: curl/8.4.0' \
  -d '{"bapiname":"RFC_READ_TABLE","QUERY_TABLE":"MARA","FIELDS":[{"FIELDNAME":"MATKL"}],"OPTIONS":[{"TEXT":"MATNR = '"'"'000000001xxxxxxxxxx'"'"'"}],"ROWCOUNT":1,"DELIMITER":"^"}'

# 3. Link class
curl -X POST 'https://sap-api.v2retail.net/api/rfc/proxy?env=prod' \
  -H 'X-RFC-Key: v2-rfc-proxy-2026' -H 'User-Agent: curl/8.4.0' \
  -d '{"bapiname":"Z_LINK_MATNR_CLASS","IV_MATNR":"000000001xxxxxxxxxx","IV_CLASS":"<MATKL>","IV_KLART":"026"}'

# 4. Write attributes
curl -X POST 'https://sap-api.v2retail.net/api/rfc/proxy?env=prod' \
  -H 'X-RFC-Key: v2-rfc-proxy-2026' -H 'User-Agent: curl/8.4.0' \
  -d '{"bapiname":"Z_ART_PATCH_RFC_V64","IV_MATNR":"000000001xxxxxxxxxx","IV_CHANGES":"M_YARN=C|M_FAB_MAIN_MVGR_1=DNM_SLD","IV_TEST_MODE":""}'
# Expect: { ok: true, plan: [ {atnam, status:"APPLIED", route:"AUSP"}, ... ] }

# 5. Verify in SAP (or via OData):
curl 'https://sap-odata.v2retail.net/sap/opu/odata/sap/Z_SB_ARTICLE_SRV/Articles?$filter=Matnr%20eq%20%271xxxxxxxxxx%27&env=prod' \
  -u 'BRONZE_BOT:BronzeBot2026'
```

### Size validation (already in 2026-06-12 handover — reproduced)

```bash
curl -X POST "https://hgdftqswlvkspzjtlrll.supabase.co/rest/v1/rpc/is_size_allowed" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_major_category":"JB_TEES_FS","p_size":"2-3Y"}'
# → true

curl -X POST "https://hgdftqswlvkspzjtlrll.supabase.co/rest/v1/rpc/is_size_allowed" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_major_category":"JB_TEES_FS","p_size":"XXXL"}'
# → false
```

---

## 7. Known Gotchas (read before you code)

1. **MATNR padding.** SAP wants 18-char zero-padded. `'1112015027'.padStart(18, '0')` → `'000000001112015027'`. Skipping the pad gives silent "matnr not found" errors.
2. **MATKL ≠ CLASS always.** Most matnrs sit in their MATKL-named class; some sit in a legacy class with only MVGR_* attributes. `Z_LINK_MATNR_CLASS` is the link that lets V64 write modern attrs to those matnrs. Always call it before V64.
3. **AUSP keyed by CUOBJ via INOB.** AUSP rows are not keyed by MATNR — they're keyed by `CUOBJ` (the internal classification object id), which is looked up via `INOB.OBJEK = matnr` filtered by `KLART = 026`. V64 handles this for you; if you ever drop down to direct AUSP reads, lookup INOB first.
4. **V61 vs V62 vs V64.** V61 picks one class via `SELECT SINGLE` on KSSK — misses modern class. V62 unlocks 4 previously-locked attrs (M_FAB_DIV, BODY_ART_NO, DSG_NO, PRICE_BAND_CATEGORY) but still writes ZCT04. **Use V64.** V64 enumerates ALL classes for a matnr and writes to AUSP. Anything older is legacy.
5. **NIC = Not In Class.** If an attribute isn't in the matnr's KSML, V64 reports `NIC` and atomic-fails the whole call. Filter and retry PLANNED-only. ~12% of matnrs hit this; MDM team is patching class masters (see Obsidian `HANDOVER-V64-LINK-CHAIN-2026-06-16.md` → MDM class master fix list).
6. **CF 5xx halve-on-retry.** Bulk batches sometimes 502/503/504 from CF. Driver halves batch on retry recursively to size 1. Build this into any new bulk path you add.
7. **OData V2 strips MANDT.** Reverse-sync if you ever build it: OData payload drops `RCLNT` (client). Use CamelCase exact JSON keys (`Rldnr` not `rldnr`) in any Snowflake/PG mapping.
8. **MAJOR_CATEGORY case + whitespace.** Supabase RPCs are case-insensitive and trim both sides — but `vendorCode` and other non-RPC fields are not. Always trim before INSERT.

---

## 8. What I Own (Akash) vs You Own (Udit)

### Akash (me)

- SAP FM build, debug, ship — V64, V62, V61, Z_LINK_MATNR_CLASS, Z_ART_GRID_*, ZMM_ART_CRT_V3
- STMS DEV→QA→PROD pushes for SAP changes
- Bulk patch driver (`bulk_patch_diff.py`) — for one-off mass updates from xlsx
- Daily `maj_cat_grid_values` sync worker (CF cron, app→SAP)
- 2-pass V64 driver build (next sprint)
- 9 JSON parse error fix in V64 output (next sprint)
- ZCT04 cleanup for the 247K xlsx matnrs (deferred)
- Class master fix list → MDM team (deferred)
- Reverse sync (SAP→app) if/when needed

### Udit (you)

- Step 7 attribute write integration in `sapSyncService.ts` (PR 1 above)
- ZCT04 write path removal in this repo (PR 2 above)
- 3 size-validation PRs from the 2026-06-12 handover if not already merged (PR 3 above)
- New attribute additions to `master-attributes.json` + `map.json` when MDM extends CT04
- Frontend UX for showing AUSP write status per article (post-MVP)
- userFeedback → re-extraction loop quality
- Cost tracking / quota management on Gemini/Claude

### MDM team (Aditi / planning)

- CT04 characteristic master maintenance (ATINN catalog)
- CL02 class master maintenance (KSML rows per class)
- The 5-class fix list in `HANDOVER-V64-LINK-CHAIN-2026-06-16.md` (deferred)

### Vaibhav (ABAP)

- ZMM_ART1 BDC patch — 4-line `CALL FUNCTION 'Z_ART_VALIDATE_VARIANT_SIZE'` (already documented in `vaibhav/ZMM_ART1_INTEGRATION_FOR_VAIBHAV.md`)

---

## 9. Reference — Where to find more detail

### Obsidian notes (canonical detail)

- `v2retail/HANDOVER-V64-LINK-CHAIN-2026-06-16.md` — V64 + link chain ship state, MDM fix list
- `v2retail/247K Article PROD Patch 2026-06-15.md` — 247K bulk patch run + diff driver pattern
- `v2retail/Z_ART_PATCH_RFC_V62 Unlock 2026-06-13.md` — V62 unlocks 4 attrs
- `v2retail/ZART_CHAR_PATCH V61 PROD Ship 2026-06-12.md` — V61 PROD baseline
- `v2retail/zart-grid-size-sot.md` — Size×MC SoT architecture
- `v2retail/ZMM_ART_CREATION_RFC PROD Unblock 2026-06-02.md` — PROD-unblock for article create
- `v2retail/Attribute Priority Rules.md` — Allocation scoring uses these attrs
- `v2retail/Article Attributes OData Handover Shubham 2026-06-10.md` — Z_SB_ARTICLE OData (reverse-sync source)
- `v2retail/Bulk Article Patch Diff Driver Pattern.md` — diff-cache driver pattern

### Memory references (claude-mem)

- `project_v64_link_chain_2026_06_16`
- `project_247k_blank_xlsx_2026_06_13`
- `project_zart_patch_v62_2026_06_13`
- `project_zart_grid_size_sot` (size validation arch)
- `reference_sap_api_proxy_payload_shape` (proxy flat-keys gotcha)
- `reference_api_layer_staged_luw` (one BAPI per FM, one COMMIT per LUW)

### Code references (this repo, `akash0631/v2ArticleCreation`)

- `Backend/src/services/sapSyncService.ts` — current article-create call
- `Backend/src/services/variantCreationService.ts` — variant + size validation
- `Backend/src/services/extractionService.ts` — VLM orchestrator
- `Backend/src/routes/approver.ts` — final approve hook
- `map.json` — SAP attribute name map
- `master-attributes.json` — canonical attribute list
- `excelmap.json` — Excel column → DB field map
- `Backend/src/data/mc-code-list-major-category.json` (+ Frontend copy) — MC catalog, edited directly

### Earlier handover bundle

- `~/Documents/SIZE_VALIDATION_HANDOVER_2026-06-12_EMAIL.zip` — size×MC slice (subset of this doc)
- `~/Documents/SIZE_VALIDATION_HANDOVER_2026-06-12_CREDS_SECURE_SHARE_ONLY.zip` — `.env` with Supabase keys

---

## 10. Ship Sequence

1. Read this doc. Ping me with questions.
2. Read `Backend/src/services/sapSyncService.ts` end to end.
3. Open PR 1 — add step 7 (attribute push via V64 chain) after step 6 (`syncToSap`). Use DEV first (`SAP_ENV=dev`), smoke against a test matnr, then promote to PROD.
4. Open PR 2 — remove any ZCT04 write paths if present.
5. Open PR 3 — finish 2026-06-12 size-validation PRs if not done.
6. Deploy to PROD (Azure App Service backend + static frontend host).
7. Monitor `extractions` table for 24h: every approved row should have a `sapArticleNumber` AND a non-empty AUSP write log.

ETA estimate: 2–3 hours for PR 1, ≤1 hour each for PR 2 and PR 3.

---

## 11. If anything looks wrong

- **V64 returns "NIC" for an attr you expect to write** → MDM has not added that ATINN to the matnr's class KSML. Verify with `RFC_READ_TABLE` on `KSML` for the class. Either ask MDM to add it (CL02) or accept the matnr is out-of-scope for that attribute.
- **`Z_LINK_MATNR_CLASS` returns "already linked"** → idempotent no-op, safe to ignore.
- **CF 1010 error** → User-Agent header missing or default urllib. Spoof curl UA.
- **Empty body response on proxy POST** → nested JSON. Flatten to top-level keys.
- **`env=prod` route returning DEV data** → body `env` is ignored. Use query string.
- **Supabase RPC null/error** → check arg names are `p_major_category` / `p_size` (Postgres strict on function arg names).

If still stuck, ping me on Telegram with the curl command + response. Faster than email.

---

**Bottom line:** Write to standard SAP `AUSP` via the V64 chain. Stop touching `ZCT04`. Size validation is the same SoT enforced both sides. Article create + attribute write happen in the same approver lifecycle. 3 PRs total to land all of this.

— Akash, 2026-06-17
