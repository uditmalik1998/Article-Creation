# AI Extraction Pipeline

#ai #extraction #vlm #attributes

← [[00 - Index]] | [[02 - Full Workflow]]

---

## Pipeline Overview

```mermaid
flowchart TD
    IMG[Image bytes] --> B64[Convert to Base64]
    B64 --> QUEUE[Queue Manager\nmaxConcurrent=4, TPM=40k]
    QUEUE --> PROM[Prompt Builder\ndepartment + category context]
    PROM --> VLM[VLM Service]

    VLM --> |primary| CLAUDE[claude-3.5-sonnet\nAnthropic]
    VLM --> |fallback| GPT4[gpt-4o\nOpenAI]
    VLM --> |specialized| FCLIP[FashionCLIP\nHuggingFace]
    VLM --> |on-premises| OLLAMA[Ollama\nLocal]

    CLAUDE & GPT4 & FCLIP & OLLAMA --> RESP[JSON Response\n{attribute: value, confidence}]
    RESP --> MATCH[Attribute Matching\ntokenization + normalization]
    MATCH --> FILTER[Confidence Filter\nmin 65-75%]
    FILTER --> FLAT[ExtractionResultFlat row]
```

---

## AI Models

| Model | Provider | Use Case |
|-------|---------|---------|
| `claude-3.5-sonnet` | Anthropic | Primary — best attribute understanding |
| `gpt-4o` | OpenAI | Fallback |
| FashionCLIP | HuggingFace | Specialized fashion vision classification |
| Ollama | Local | On-premises option (configurable) |

---

## Two Extraction Workflows

### A. Enhanced VLM Pipeline (Watcher / Standard Upload)
**Controller**: `EnhancedExtractionController.extractFromUploadVLM`  
**Attributes**: 40+ full attribute set  
**Prompt types**:
- `generateOptimizedPrompt()` — token-optimized, uses department context
- `generateCategorySpecificPrompt()` — category-aware (e.g. different for jeans vs shirts)
- `generateDiscoveryPrompt()` — research/enhanced mode
- `generateGenericPrompt()` — full fabric classification guidance

### B. Simplified VLM Pipeline (User Upload)
**Controller**: `SimplifiedExtractionController.extractSimplified`  
**Attributes**: 27 fixed attributes  
**Prompt**: `SimplifiedPromptService` — more focused, faster

---

## Attributes Extracted (Full Set)

### FAB Group — Fabric
```
macroMvgr      Main MVGR (macro category code)
yarn1          Primary yarn type
mainMvgr       Main MVGR
fabricMainMvgr Fabric main MVGR
weave          Weave type
mFab2          Secondary fabric
composition    Fabric composition (e.g. 100% Cotton)
fCount         Thread count
fConstruction  Fabric construction
lycra          Lycra/stretch content
finish         Fabric finish
gsm            GSM weight
fOunce         Weight in ounces
fWidth         Fabric width
shade          Shade type
weight         Garment weight
```

### BODY Group
```
collar         Collar type
collarStyle    Collar style variation
neckDetails    Neck detail
neck           Neck type
placket        Placket style
fatherBelt     Father belt
sleeve         Sleeve type
sleeveFold     Sleeve fold style
bottomFold     Bottom fold
noOfPocket     Number of pockets
pocketType     Pocket type
extraPocket    Extra pocket presence
fit            Fit type (slim/regular/loose)
pattern        Body style / pattern
length         Length category
childBelt      Child belt
frontOpenStyle Front open style
```

### VA ACC Group — Value Add Accessories
```
drawcord       Drawcord presence
dcShape        Drawcord shape
button         Button type
btnColour      Button colour
zipper         Zipper type
zipColour      Zipper colour
patchesType    Patches type
patches        Patches presence
htrfType       HTRF type
htrfStyle      HTRF style
```

### VA PRCS Group — Value Add Processing
```
printType         Print type
printStyle        Print style
printPlacement    Print placement
embroidery        Embroidery presence
embroideryType    Embroidery type
embPlacement      Embroidery placement
wash              Wash type
ageGroup          Age group
articleFashionType Article fashion type
mvgrBrandVendor   MVGR brand/vendor
```

### Business Fields (derived, not extracted from image)
```
mrp               Maximum retail price
rate              Cost/rate
impAtrbt2         Important attribute 2 (mandatory SAP field)
vendorName        Vendor name
designNumber      Design number
pptNumber         PPT/Presentation number (SRM only)
referenceArticleDescription  Reference article desc
```

---

## Attribute Matching Logic

After raw AI output, values are matched to `AttributeAllowedValue` master list:

```
1. Exact match (case-insensitive)
2. Token match — split value into words, check if all tokens appear in allowed value
3. Alias match — check synonym list
4. Normalize — remove special chars, handle "colour"/"color" variants
5. Confidence filter — drop values below threshold (65-75%)
6. If no match found → leave null for approver to fill
```

---

## Queue Management

The old `queueManagementService.ts` (in-memory priority queue) was never wired into the server and was deleted on 2026-10-22.

## Cost Tracking

- Every extraction records: `tokensUsed`, `costUsd`, `modelUsed`, `processingTimeMs`
- Stored in `CostSummary` table per user
- Viewable in Admin Panel → Expenses (`/admin/expenses`)
- **DEBUG log** still present in `enhancedExtractionController.ts:274` (to be cleaned up — see [[13 - Pending Issues]])
