# SRM Set Bulk Folder Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a vendor drop several set folders on the SRM stock submission form; an AI sorts each folder into whole set / Top / parts with categories, design numbers come from the folder name, and shared details are entered once per set.

**Architecture:** The browser reads the folders and builds the form's existing `sets[]` / `DesignRow[]` state (so submit, PRES numbering and MDM sync are untouched). A new edge function `srm-set-classify` gets small thumbnails of one set per call and returns roles and categories via one Gemini call. Pure helpers in `setBulk.ts` (unit-tested) do all role / numbering logic.

**Tech Stack:** React 18 + TypeScript + shadcn/ui (Vite), vitest (`src/**/*.test.ts`), Supabase Edge Functions (Deno, `deno test`), Gemini REST.

**Spec:** `docs/superpowers/specs/2026-10-06-srm-set-bulk-upload-design.md`

**How code reaches SRM:** SRM is the Lovable project V2-SRM, `project_id a381fbb9-6fe5-4023-8259-c1b8bee9c82c`. There is no local clone: every code step is a Lovable `send_message` that contains the exact file content / edit below and tells Lovable to apply it **verbatim** and run the named tests. Lovable auto-commits each message; the "commit" step of each task is: `get_diff` / `read_file` the changed files and compare against this plan. Do not publish.

## Global Constraints

- Lovable: preview only, never publish without owner OK; do not regenerate `src/integrations/supabase/types.ts`; no costing / TNA / ASN / roles changes.
- No DB schema change, no new table; `srm-set-classify` makes no DB writes.
- Unchanged: submit / PRES numbering, `sync-presentation-to-mdm`, `srm-fastppt-extract`, the Article Creation repo.
- `srm-set-classify` must have `verify_jwt = true` in `supabase/config.toml` (a function missing from that file deploys open).
- Auth: any signed-in SRM user (vendors use the form) — JWT checked with `getClaims`; no staff check.
- Thumbnails: JPEG, longest side 768 px; max 8 images per call; classify at most 3 sets in parallel; 60 s timeout per set.
- Design numbers: parent = folder name; parts = folder + `-T` (Top), `-B` (bottom), `-D` (dupatta), `-O` (other); repeated kind gets a number (`-B2`).
- Per part only: price, garment weight, design number. Per set: fabric, sizes, no. of colours, quantity, available date, sample size, PPT type.
- Existing `MAX_PHOTOS = 50` and 20 MB compression rule apply to bulk-added photos.
- MDM DB checks are read-only.

## Review Focus

1. Vendor drops loose photos (not in a folder) → those photos are left out with a toast telling them to use one folder per set; nothing breaks. (Task 1 test `counts loose images`, Task 3 toast.)
2. A folder with more than 8 photos, or a drop that would pass 50 photos in total → extra photos skipped with a toast; the first 8 of each set are classified, the rest stay "Other part". (Task 4 Step 6 manual check.)
3. Vendor changes a role, category or design number while the AI is still sorting → the AI answer does not overwrite it. (Task 1 tests `keeps a touched …`.)
4. An unreadable photo (HEIC the browser cannot decode) → excluded from the AI call; if fewer than 2 readable photos remain the set shows "AI failed — set roles manually" and stays editable. (Task 4 Step 6 manual check.)
5. AI returns a category not in the division, or garbage JSON → category left empty (submit validation asks for it), roles fall back to first = whole set, second = Top. (Task 2 tests `unknown category is null`, `garbage input falls back`.)

---

### Task 0: Kick-off in Lovable plan mode

**Files:** none (plan message only)

- [ ] **Step 1: Send the plan summary with `plan_mode=true`**

`send_message(project_id, plan_mode=true)` with: "We are adding bulk folder upload with AI sorting for set articles on the stock submission form (`src/pages/srm/tabs/StockSubmissionForm.tsx`). I will send the exact code in 5 messages: (1) `src/pages/srm/utils/setBulk.ts` + tests, (2) edge function `supabase/functions/srm-set-classify` + config.toml block, (3) `SetFolderDropzone.tsx`, `thumbnail.ts`, `classifySet.ts`, (4) form + `SetArticleCard.tsx` wiring, (5) per-set details strip. Apply each verbatim. Constraints: no DB migrations, do not touch types.ts, submit/sync, fast-track, costing/TNA/ASN/roles; do not publish. Confirm you understand; no code yet."

- [ ] **Step 2: Check the reply** — Lovable confirms and proposes no extra changes. If it proposes extra changes, answer "No, only the messages I send."

---

### Task 1: Pure set helpers (`setBulk.ts`)

**Files:**
- Create: `src/pages/srm/utils/setBulk.ts`
- Test: `src/pages/srm/utils/setBulk.test.ts`

**Interfaces:**
- Consumes: `SetRole` from `src/pages/srm/utils/setCategories.ts` (`"PARENT" | "TOP" | "PIECE"`).
- Produces: `PartKind`, `FolderGroup`, `SetCat`, `Touched`, `SetRowLike`, `ClassifiedItem`, `isImageFile(f)`, `groupFilesByFolder(entries) → { groups, loose, skipped }`, `kindOf(row)`, `renumberSet(rows, setId, folder?)`, `normaliseSetRoles(rows, setId, cat)`, `applyClassification(rows, setId, folder, items, cat)`, `makeWholeSet(rows, rowId, cat, folder?)`, `setPartRole(rows, rowId, role, cat, folder?)`, `markTouched(row, patch)`, `runPool(items, limit, worker)`.

- [ ] **Step 1: Write the failing test** — send Lovable: "Create `src/pages/srm/utils/setBulk.test.ts` with exactly this content, then run `npx vitest run src/pages/srm/utils/setBulk.test.ts` and paste the output (it must fail: module not found)."

```ts
import { describe, expect, it } from "vitest";
import {
  applyClassification,
  groupFilesByFolder,
  makeWholeSet,
  markTouched,
  renumberSet,
  runPool,
  setPartRole,
  type ClassifiedItem,
  type SetRowLike,
} from "./setBulk";

const img = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const CAT = { division: "LADIES", subDivision: "L_UPPER", majorCategory: "KURTI_ST" };

function row(id: string, extra: Partial<SetRowLike> = {}): SetRowLike {
  return { id, designNumber: "", setGroupId: "S1", setRole: "PIECE", ...extra };
}

describe("groupFilesByFolder", () => {
  it("makes one group per folder that holds images, sorted by name", () => {
    const { groups, loose, skipped } = groupFilesByFolder([
      { path: "Root/KS-102/b.jpg", file: img("b.jpg") },
      { path: "Root/KS-101/10.jpg", file: img("10.jpg") },
      { path: "Root/KS-101/2.jpg", file: img("2.jpg") },
      { path: "Root/KS-101/.DS_Store", file: new File(["x"], ".DS_Store") },
    ]);
    expect(groups.map((g) => g.folder)).toEqual(["KS-101", "KS-102"]);
    expect(groups[0].files.map((f) => f.name)).toEqual(["2.jpg", "10.jpg"]);
    expect(loose).toBe(0);
    expect(skipped).toBe(1);
  });

  it("counts loose images that are not inside a folder", () => {
    const { groups, loose } = groupFilesByFolder([{ path: "a.jpg", file: img("a.jpg") }]);
    expect(groups).toEqual([]);
    expect(loose).toBe(1);
  });

  it("accepts a HEIC file with an empty mime type by extension", () => {
    const { groups } = groupFilesByFolder([{ path: "KS-1/a.HEIC", file: new File(["x"], "a.HEIC") }]);
    expect(groups[0].files).toHaveLength(1);
  });
});

describe("renumberSet", () => {
  it("numbers parent and parts from the folder name and kind", () => {
    const rows = [
      row("p", { setRole: "PARENT" }),
      row("t", { setRole: "TOP", partKind: "TOP" }),
      row("b1", { partKind: "BOTTOM" }),
      row("d", { partKind: "DUPATTA" }),
      row("b2", { partKind: "BOTTOM" }),
      row("o", {}),
    ];
    const out = renumberSet(rows, "S1", "KS-101");
    expect(out.map((r) => r.designNumber)).toEqual([
      "KS-101", "KS-101-T", "KS-101-B", "KS-101-D", "KS-101-B2", "KS-101-O",
    ]);
  });

  it("keeps a touched design number and leaves other sets alone", () => {
    const rows = [
      row("p", { setRole: "PARENT", designNumber: "MINE", touched: { designNumber: true } }),
      row("x", { setGroupId: "S2", designNumber: "OTHER" }),
    ];
    const out = renumberSet(rows, "S1", "KS-101");
    expect(out[0].designNumber).toBe("MINE");
    expect(out[1].designNumber).toBe("OTHER");
  });

  it("does nothing without a folder name", () => {
    const rows = [row("p", { setRole: "PARENT" })];
    expect(renumberSet(rows, "S1", undefined)).toBe(rows);
  });
});

describe("applyClassification", () => {
  const items: ClassifiedItem[] = [
    { key: "a", role: "TOP", part_kind: "TOP", major_category: "L_KURTI", sub_div: "L_UPPER", div: "LADIES" },
    { key: "b", role: "PARENT", part_kind: "OTHER", major_category: null, sub_div: null, div: null },
    { key: "c", role: "PIECE", part_kind: "BOTTOM", major_category: "L_PLAZO", sub_div: "L_LOWER", div: "LADIES" },
  ];

  it("applies AI roles, categories and design numbers", () => {
    const rows = [row("a", { setRole: "PARENT", setMajorCategory: "KURTI_ST" }), row("b", { setRole: "TOP" }), row("c")];
    const out = applyClassification(rows, "S1", "KS-9", items, CAT);
    expect(out.map((r) => r.setRole)).toEqual(["TOP", "PARENT", "PIECE"]);
    expect(out[0].setMajorCategory).toBe("L_KURTI");
    expect(out[1].setMajorCategory).toBe("KURTI_ST");
    expect(out[2].setSubDivision).toBe("L_LOWER");
    expect(out.map((r) => r.designNumber)).toEqual(["KS-9-T", "KS-9", "KS-9-B"]);
  });

  it("keeps a touched role and a touched category", () => {
    const rows = [
      row("a", { setRole: "PARENT", touched: { role: true } }),
      row("b", { setRole: "TOP" }),
      row("c", { setMajorCategory: "L_PANT", touched: { category: true } }),
    ];
    const out = applyClassification(rows, "S1", "KS-9", items, CAT);
    expect(out[0].setRole).toBe("PARENT");
    expect(out[2].setMajorCategory).toBe("L_PANT");
    expect(out.filter((r) => r.setRole === "PARENT")).toHaveLength(1);
    expect(out.filter((r) => r.setRole === "TOP")).toHaveLength(1);
  });
});

describe("makeWholeSet", () => {
  it("swaps the parent, clears the old parent's category, keeps one Top", () => {
    const rows = [
      row("p", { setRole: "PARENT", setMajorCategory: "KURTI_ST" }),
      row("t", { setRole: "TOP", partKind: "TOP", setMajorCategory: "L_KURTI" }),
      row("b", { partKind: "BOTTOM", setMajorCategory: "L_PLAZO" }),
    ];
    const out = makeWholeSet(rows, "t", CAT, "KS-5");
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(byId.t.setRole).toBe("PARENT");
    expect(byId.t.setMajorCategory).toBe("KURTI_ST");
    expect(byId.p.setRole).toBe("PIECE");
    expect(byId.p.setMajorCategory).toBe("");
    expect(byId.b.setRole).toBe("TOP");
    expect(byId.t.designNumber).toBe("KS-5");
    expect(byId.b.designNumber).toBe("KS-5-T");
  });
});

describe("setPartRole", () => {
  it("moves Top to the chosen part and demotes the old Top", () => {
    const rows = [row("p", { setRole: "PARENT" }), row("t", { setRole: "TOP", partKind: "TOP" }), row("b", { partKind: "BOTTOM" })];
    const out = setPartRole(rows, "b", "TOP", CAT);
    expect(out.find((r) => r.id === "b")!.setRole).toBe("TOP");
    expect(out.find((r) => r.id === "t")!.setRole).toBe("PIECE");
  });

  it("making the Top an Other part picks another part as Top", () => {
    const rows = [row("p", { setRole: "PARENT" }), row("t", { setRole: "TOP", partKind: "TOP" }), row("b", { partKind: "BOTTOM" })];
    const out = setPartRole(rows, "t", "PIECE", CAT);
    expect(out.find((r) => r.id === "t")!.setRole).toBe("PIECE");
    expect(out.find((r) => r.id === "b")!.setRole).toBe("TOP");
  });
});

describe("markTouched", () => {
  it("flags the edited fields of a set row only", () => {
    expect(markTouched(row("a"), { designNumber: "X" }).touched).toEqual({ designNumber: true });
    expect(markTouched(row("a", { setGroupId: undefined }), { designNumber: "X" })).toEqual({ designNumber: "X" });
  });
});

describe("runPool", () => {
  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(3);
  });
});
```

- [ ] **Step 2: Verify it fails** — Lovable's output shows `Failed to resolve import "./setBulk"`.

- [ ] **Step 3: Write the implementation** — send Lovable: "Create `src/pages/srm/utils/setBulk.ts` with exactly this content, then run `npx vitest run src/pages/srm/utils/setBulk.test.ts` and paste the output."

```ts
/**
 * Bulk set upload helpers: group dropped folders, number set designs from the folder
 * name, and keep a set's roles consistent (one whole-set photo, one Top) while the AI
 * and the vendor both change them. Pure functions; the form owns the state.
 */
import type { SetRole } from "./setCategories";

export type PartKind = "TOP" | "BOTTOM" | "DUPATTA" | "OTHER";
const SUFFIX: Record<PartKind, string> = { TOP: "T", BOTTOM: "B", DUPATTA: "D", OTHER: "O" };

export type FolderGroup = { folder: string; files: File[] };
export type SetCat = { division: string; subDivision: string; majorCategory: string };
/** Fields the vendor changed by hand: an AI answer arriving later must not overwrite them. */
export type Touched = { role?: boolean; category?: boolean; designNumber?: boolean };

export type SetRowLike = {
  id: string;
  designNumber: string;
  setGroupId?: string;
  setRole?: SetRole;
  setDivision?: string;
  setSubDivision?: string;
  setMajorCategory?: string;
  partKind?: PartKind;
  touched?: Touched;
};

/** One photo's answer from the srm-set-classify edge function. */
export type ClassifiedItem = {
  key: string;
  role: SetRole;
  part_kind: PartKind;
  major_category: string | null;
  sub_div: string | null;
  div: string | null;
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
export const isImageFile = (f: File) => f.type.startsWith("image/") || IMAGE_EXT.test(f.name);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Every folder that directly holds images is one set, named after that folder.
 * `path` is the file's relative path ("Root/KS-101/a.jpg"); images with no folder are `loose`.
 */
export function groupFilesByFolder(entries: { path: string; file: File }[]): {
  groups: FolderGroup[];
  loose: number;
  skipped: number;
} {
  const byDir = new Map<string, FolderGroup>();
  let loose = 0;
  let skipped = 0;
  for (const { path, file } of entries) {
    if (!isImageFile(file)) {
      skipped++;
      continue;
    }
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length < 2) {
      loose++;
      continue;
    }
    const dir = parts.slice(0, -1).join("/");
    let group = byDir.get(dir);
    if (!group) {
      group = { folder: parts[parts.length - 2].trim(), files: [] };
      byDir.set(dir, group);
    }
    group.files.push(file);
  }
  const groups = [...byDir.values()];
  for (const g of groups) g.files.sort((a, b) => byName(a.name, b.name));
  groups.sort((a, b) => byName(a.folder, b.folder));
  return { groups, loose, skipped };
}

/** The kind a part is numbered by: the Top is always T. */
export function kindOf(row: SetRowLike): PartKind {
  if (row.setRole === "TOP") return "TOP";
  return row.partKind && row.partKind !== "TOP" ? row.partKind : "OTHER";
}

/** Parent = folder name, parts = folder + suffix; a touched design number is kept. */
export function renumberSet<T extends SetRowLike>(rows: T[], setId: string, folder?: string): T[] {
  const base = (folder ?? "").trim();
  if (!base) return rows;
  const seen: Partial<Record<PartKind, number>> = {};
  return rows.map((r) => {
    if (r.setGroupId !== setId) return r;
    let dn = base;
    if (r.setRole !== "PARENT") {
      const k = kindOf(r);
      seen[k] = (seen[k] ?? 0) + 1;
      dn = `${base}-${SUFFIX[k]}${seen[k]! > 1 ? seen[k] : ""}`;
    }
    return r.touched?.designNumber || r.designNumber === dn ? r : { ...r, designNumber: dn };
  });
}

/** Exactly one PARENT (with the set category) and exactly one TOP per set. */
export function normaliseSetRoles<T extends SetRowLike>(rows: T[], setId: string, cat: SetCat): T[] {
  const inSet = rows.filter((r) => r.setGroupId === setId);
  if (!inSet.length) return rows;
  const parent =
    inSet.find((r) => r.setRole === "PARENT" && r.touched?.role) ??
    inSet.find((r) => r.setRole === "PARENT") ??
    inSet[0];
  const parts = inSet.filter((r) => r.id !== parent.id);
  const top =
    parts.find((r) => r.setRole === "TOP" && r.touched?.role) ??
    parts.find((r) => r.setRole === "TOP") ??
    parts.find((r) => r.partKind === "TOP") ??
    parts.find((r) => !r.touched?.role) ??
    parts[0];
  return rows.map((r) => {
    if (r.setGroupId !== setId) return r;
    if (r.id === parent.id) {
      return {
        ...r,
        setRole: "PARENT" as SetRole,
        setDivision: cat.division,
        setSubDivision: cat.subDivision,
        setMajorCategory: cat.majorCategory,
      };
    }
    const role: SetRole = r.id === top?.id ? "TOP" : "PIECE";
    if (r.setRole === role) return r;
    // a former parent loses the set category: a part needs its own
    const wasParent = r.setRole === "PARENT";
    return {
      ...r,
      setRole: role,
      ...(wasParent ? { setDivision: cat.division, setSubDivision: cat.subDivision, setMajorCategory: "" } : {}),
    };
  });
}

/** Apply the AI's answer to one set, skipping every field the vendor already touched. */
export function applyClassification<T extends SetRowLike>(
  rows: T[],
  setId: string,
  folder: string | undefined,
  items: ClassifiedItem[],
  cat: SetCat,
): T[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const userPickedParent = rows.some((r) => r.setGroupId === setId && r.setRole === "PARENT" && r.touched?.role);
  const next = rows.map((r) => {
    if (r.setGroupId !== setId) return r;
    const it = byKey.get(r.id);
    if (!it) return r;
    // built as SetRowLike: TypeScript won't let us assign fields on a generic T
    const out: SetRowLike = { ...r, partKind: it.part_kind };
    if (!r.touched?.role && !(userPickedParent && it.role === "PARENT")) out.setRole = it.role;
    if (out.setRole !== "PARENT" && !r.touched?.category) {
      if (it.major_category) {
        out.setMajorCategory = it.major_category;
        out.setDivision = it.div ?? cat.division;
        out.setSubDivision = it.sub_div ?? cat.subDivision;
      } else if (r.setRole === "PARENT") {
        out.setMajorCategory = "";
      }
    }
    return out as T;
  });
  return renumberSet(normaliseSetRoles(next, setId, cat), setId, folder);
}

/** "Make whole set": this part becomes the parent, the old parent becomes a part. */
export function makeWholeSet<T extends SetRowLike>(rows: T[], rowId: string, cat: SetCat, folder?: string): T[] {
  const target = rows.find((r) => r.id === rowId);
  if (!target?.setGroupId) return rows;
  const setId = target.setGroupId;
  const next = rows.map((r) => {
    if (r.setGroupId !== setId) return r;
    if (r.id === rowId) {
      return {
        ...r,
        setRole: "PARENT" as SetRole,
        setDivision: cat.division,
        setSubDivision: cat.subDivision,
        setMajorCategory: cat.majorCategory,
        touched: { ...r.touched, role: true },
      };
    }
    if (r.setRole === "PARENT") {
      return {
        ...r,
        setRole: "PIECE" as SetRole,
        partKind: "OTHER" as PartKind,
        setDivision: cat.division,
        setSubDivision: cat.subDivision,
        setMajorCategory: "",
        touched: { ...r.touched, role: true, category: false },
      };
    }
    return r;
  });
  return renumberSet(normaliseSetRoles(next, setId, cat), setId, folder);
}

/** Top / Other part switch: one Top per set. */
export function setPartRole<T extends SetRowLike>(
  rows: T[],
  rowId: string,
  role: "TOP" | "PIECE",
  cat: SetCat,
  folder?: string,
): T[] {
  const target = rows.find((r) => r.id === rowId);
  if (!target?.setGroupId) return rows;
  const setId = target.setGroupId;
  const next = rows.map((r) => {
    if (r.setGroupId !== setId) return r;
    if (r.id === rowId) {
      return {
        ...r,
        setRole: role as SetRole,
        partKind: role === "PIECE" && r.partKind === "TOP" ? ("OTHER" as PartKind) : r.partKind,
        touched: { ...r.touched, role: true },
      };
    }
    if (role === "TOP" && r.setRole === "TOP") return { ...r, setRole: "PIECE" as SetRole };
    return r;
  });
  return renumberSet(normaliseSetRoles(next, setId, cat), setId, folder);
}

/** Record which set fields a hand edit changed. Non-set rows pass through. */
export function markTouched<T extends SetRowLike>(row: T, patch: Partial<T>): Partial<T> {
  if (!row.setGroupId) return patch;
  const touched: Touched = { ...row.touched };
  if ("designNumber" in patch) touched.designNumber = true;
  if ("setRole" in patch) touched.role = true;
  if ("setMajorCategory" in patch) touched.category = true;
  return { ...patch, touched };
}

/** Run `worker` over `items`, at most `limit` at a time. `worker` must not throw. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}
```

- [ ] **Step 4: Verify it passes** — Lovable's vitest output: all `setBulk.test.ts` tests PASS.

- [ ] **Step 5: Commit check** — `read_file` both files; content equals this plan.

---

### Task 2: Edge function `srm-set-classify`

**Files:**
- Create: `supabase/functions/srm-set-classify/normalize.ts`
- Create: `supabase/functions/srm-set-classify/normalize.test.ts`
- Create: `supabase/functions/srm-set-classify/index.ts`
- Modify: `supabase/config.toml` (append block at end)

**Interfaces:**
- Consumes: `corsHeaders` from `supabase/functions/_shared/cors.ts`; table `broader_menu_mirror (div, sub_div, maj_cat)`; env `GEMINI_API_KEY` | `GOOGLE_GEMINI_API_KEY`, `FASTPPT_MODEL`.
- Produces: `POST /functions/v1/srm-set-classify` body `{ set_category: string, division: string, images: [{ key: string, mime: string, data: string }] }` → `{ ok: true, items: ClassifiedItem[], usd: number }` (shape = `ClassifiedItem` in Task 1) or `{ ok: false, error: string }` with 400 / 401 / 422 / 500 / 502.

- [ ] **Step 1: Write the failing test** — send Lovable: "Create `supabase/functions/srm-set-classify/normalize.test.ts` with exactly this content and run the edge-function tests for `srm-set-classify` (Deno). Paste the output; it must fail (module missing)."

```ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normaliseClassification, type Candidate } from "./normalize.ts";

const CANDS: Candidate[] = [
  { maj_cat: "L_KURTI", sub_div: "L_UPPER", div: "LADIES" },
  { maj_cat: "L_PLAZO", sub_div: "L_LOWER", div: "LADIES" },
  { maj_cat: "L_DUPATTA", sub_div: "L_ACC", div: "LADIES" },
];
const KEYS = ["p1", "p2", "p3"];

Deno.test("picks the whole set, the Top, and snaps categories", () => {
  const out = normaliseClassification({
    items: [
      { key: "p1", whole_set: false, part_kind: "TOP", major_category: "l kurti" },
      { key: "p2", whole_set: true, garment_count: 3, part_kind: "OTHER", major_category: null },
      { key: "p3", whole_set: false, part_kind: "BOTTOM", major_category: "L_PLAZO" },
    ],
  }, KEYS, CANDS);
  assertEquals(out.map((o) => o.role), ["TOP", "PARENT", "PIECE"]);
  assertEquals(out[0].major_category, "L_KURTI");
  assertEquals(out[2].sub_div, "L_LOWER");
  assertEquals(out[1].major_category, null);
});

Deno.test("no whole_set: the photo with most garments is the parent", () => {
  const out = normaliseClassification([
    { key: "p1", garment_count: 1, part_kind: "TOP" },
    { key: "p2", garment_count: 1, part_kind: "BOTTOM" },
    { key: "p3", garment_count: 3, part_kind: "OTHER" },
  ], KEYS, CANDS);
  assertEquals(out.map((o) => o.role), ["TOP", "PIECE", "PARENT"]);
});

Deno.test("two whole_set and two TOP: keep the first of each", () => {
  const out = normaliseClassification([
    { key: "p1", whole_set: true },
    { key: "p2", whole_set: true, part_kind: "TOP" },
    { key: "p3", part_kind: "TOP" },
  ], KEYS, CANDS);
  assertEquals(out.map((o) => o.role), ["PARENT", "TOP", "PIECE"]);
  assertEquals(out[2].part_kind, "OTHER");
});

Deno.test("no TOP: the first part becomes Top", () => {
  const out = normaliseClassification([
    { key: "p1", whole_set: true },
    { key: "p2", part_kind: "BOTTOM" },
    { key: "p3", part_kind: "DUPATTA" },
  ], KEYS, CANDS);
  assertEquals(out[1].role, "TOP");
  assertEquals(out[1].part_kind, "TOP");
});

Deno.test("unknown category is null", () => {
  const out = normaliseClassification([
    { key: "p1", whole_set: true },
    { key: "p2", part_kind: "TOP", major_category: "M_JEANS_XYZ_NOT_HERE" },
  ], ["p1", "p2"], CANDS);
  assertEquals(out[1].major_category, null);
  assertEquals(out[1].div, null);
});

Deno.test("garbage input falls back to first = parent, second = Top", () => {
  const out = normaliseClassification("not json", KEYS, CANDS);
  assertEquals(out.map((o) => o.role), ["PARENT", "TOP", "PIECE"]);
  assertEquals(out.every((o) => o.major_category === null), true);
});
```

- [ ] **Step 2: Verify it fails** — output shows module `./normalize.ts` not found.

- [ ] **Step 3: Write `normalize.ts`** — send Lovable: "Create `supabase/functions/srm-set-classify/normalize.ts` with exactly this content and re-run the `srm-set-classify` Deno tests."

```ts
// Turns the model's answer for one set into exactly one whole-set photo, exactly one Top,
// and categories snapped to the division's real major categories. Pure: no I/O.
export type PartKind = "TOP" | "BOTTOM" | "DUPATTA" | "OTHER";
export type Role = "PARENT" | "TOP" | "PIECE";
export type Candidate = { maj_cat: string; sub_div: string; div: string };
export type OutItem = {
  key: string;
  role: Role;
  part_kind: PartKind;
  major_category: string | null;
  sub_div: string | null;
  div: string | null;
};

const KINDS = new Set<string>(["TOP", "BOTTOM", "DUPATTA", "OTHER"]);

// Same matching as srm-fastppt-extract's snapToGrid (copied: that function is not shared).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function snapToGrid(raw: string, allowed: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nv = norm(raw.trim());
  if (!nv || !allowed.length) return null;
  for (const a of allowed) if (norm(a) === nv) return a;
  let best: string | null = null;
  let bestScore = 0;
  for (const a of allowed) {
    const na = norm(a);
    if (!na) continue;
    const score = na.includes(nv) || nv.includes(na)
      ? Math.min(na.length, nv.length) / Math.max(na.length, nv.length)
      : 1 - levenshtein(nv, na) / Math.max(nv.length, na.length);
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return bestScore >= 0.6 ? best : null;
}

export function normaliseClassification(raw: unknown, keys: string[], candidates: Candidate[]): OutItem[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const k = String((r as Record<string, unknown>).key ?? "");
    if (keys.includes(k) && !byKey.has(k)) byKey.set(k, r as Record<string, unknown>);
  }
  const rows = keys.map((key) => {
    const r = byKey.get(key) ?? {};
    const kind = String(r.part_kind ?? "").toUpperCase();
    const count = Number(r.garment_count);
    return {
      key,
      whole: r.whole_set === true,
      count: Number.isFinite(count) ? count : 0,
      kind: (KINDS.has(kind) ? kind : "OTHER") as PartKind,
      cat: typeof r.major_category === "string" ? r.major_category : "",
    };
  });
  if (!rows.length) return [];

  let parentIdx = rows.findIndex((r) => r.whole);
  if (parentIdx === -1) {
    parentIdx = 0;
    rows.forEach((r, i) => { if (r.count > rows[parentIdx].count) parentIdx = i; });
  }

  const allowed = [...new Set(candidates.map((c) => c.maj_cat))];
  let topSeen = false;
  const out: OutItem[] = rows.map((r, i) => {
    if (i === parentIdx) {
      return { key: r.key, role: "PARENT", part_kind: "OTHER", major_category: null, sub_div: null, div: null };
    }
    let kind = r.kind;
    let role: Role = "PIECE";
    if (kind === "TOP") {
      if (topSeen) kind = "OTHER";
      else { role = "TOP"; topSeen = true; }
    }
    const snapped = r.cat ? snapToGrid(r.cat, allowed) : null;
    const cand = snapped ? candidates.find((c) => c.maj_cat === snapped) ?? null : null;
    return { key: r.key, role, part_kind: kind, major_category: snapped, sub_div: cand?.sub_div ?? null, div: cand?.div ?? null };
  });
  if (!topSeen) {
    const first = out.find((o) => o.role !== "PARENT");
    if (first) { first.role = "TOP"; first.part_kind = "TOP"; }
  }
  return out;
}
```

- [ ] **Step 4: Verify tests pass** — all 6 Deno tests PASS.

- [ ] **Step 5: Write `index.ts` and the config block** — send Lovable: "Create `supabase/functions/srm-set-classify/index.ts` with exactly this content, append the block below to the END of `supabase/config.toml` (change nothing else in that file), and deploy only the `srm-set-classify` function."

```ts
// Bulk set upload: sort the photos of ONE set folder.
//
// POST { set_category, division, images: [{ key, mime, data }] }   (any signed-in SRM user)
//
// One Gemini call sees every photo of the set (768 px thumbnails sent by the browser) and
// says which photo is the whole set, what kind each part is, and its major category from
// the division's broader_menu_mirror list. normalize.ts guarantees one parent and one Top.
// No DB writes.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normaliseClassification, type Candidate } from "./normalize.ts";

const MODEL = Deno.env.get("FASTPPT_MODEL") || "gemini-3.8-flash";
const PRICE_PER_M = { in: 0.75, out: 3.75 }; // USD, gemini-3.8-flash
// Keep in sync with SET_CATEGORY_FRAGMENTS in src/pages/srm/utils/setCategories.ts:
// a part is never itself a set category.
const SET_FRAGMENTS = ["KURTI_ST", "B_SUIT"];
const MAX_IMAGES = 8;
const MAX_B64 = 1_500_000; // a 768 px JPEG thumbnail is ~100-200 KB of base64

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as Error)?.message ?? e);
      const retriable = /\b(429|500|502|503|504)\b|timeout|fetch failed|connection|reset/i.test(msg);
      if (!retriable || i === tries) break;
      await sleep(1500 * i + Math.random() * 500);
    }
  }
  throw last;
}

function parseModelJson(raw: string): unknown {
  let s = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = s.search(/[[{]/);
  const last = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (first === -1 || last === -1) return null;
  s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { /* fall through */ }
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch { return null; }
}

function buildPrompt(setCategory: string, categories: string[], n: number): string {
  return `You are sorting the photos of ONE garment set (set category: ${setCategory}) uploaded by a vendor.
There are ${n} photos, labelled p1 to p${n}; each label is written just before its photo.
- Exactly one photo should show the WHOLE SET: all garments of the set together (for example kurti + bottom + dupatta worn or laid out together). Mark it "whole_set": true; every other photo "whole_set": false.
- Every other photo shows ONE part of the set. Give "part_kind": "TOP" (kurti, kurta, top, shirt: the upper garment), "BOTTOM" (plazo, pant, salwar, legging, skirt, sharara), "DUPATTA" (dupatta, stole, scarf) or "OTHER".
- "garment_count": how many separate garments are visible in the photo.
- "major_category": the best match for that part from this list ONLY, copied exactly: ${categories.join(", ")}. Use null for the whole-set photo.
Return ONLY JSON, one entry per photo:
{"items":[{"key":"p1","whole_set":true,"garment_count":3,"part_kind":"OTHER","major_category":null}]}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_GEMINI_API_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY || !GEMINI_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(authHeader.slice(7));
  if (claimsErr || !claims?.claims?.sub) return json({ ok: false, error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    set_category?: unknown;
    division?: unknown;
    images?: unknown;
  };
  const setCategory = String(body.set_category ?? "").trim();
  const division = String(body.division ?? "").trim();
  const images = Array.isArray(body.images) ? body.images : [];
  const valid = images.every((i) => {
    const im = i as { key?: unknown; mime?: unknown; data?: unknown };
    return typeof im?.key === "string" && typeof im.mime === "string" && im.mime.startsWith("image/") &&
      typeof im.data === "string" && im.data.length > 0 && im.data.length <= MAX_B64;
  });
  if (!setCategory || !division || images.length < 1 || images.length > MAX_IMAGES || !valid) {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const imgs = images as { key: string; mime: string; data: string }[];

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: menu, error: menuErr } = await admin
    .from("broader_menu_mirror")
    .select("div, sub_div, maj_cat")
    .eq("div", division)
    .not("maj_cat", "is", null)
    .not("sub_div", "is", null)
    .range(0, 9999);
  if (menuErr) return json({ ok: false, error: "category_read_failed" }, 500);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of (menu || []) as Candidate[]) {
    const code = String(r.maj_cat).toUpperCase();
    if (seen.has(r.maj_cat) || SET_FRAGMENTS.some((f) => code.includes(f))) continue;
    seen.add(r.maj_cat);
    candidates.push(r);
  }
  if (!candidates.length) return json({ ok: false, error: "no_categories_for_division" }, 422);

  const labels = imgs.map((_, i) => `p${i + 1}`);
  const t0 = Date.now();
  try {
    const parts: unknown[] = [{ text: buildPrompt(setCategory, candidates.map((c) => c.maj_cat), imgs.length) }];
    imgs.forEach((im, i) => {
      parts.push({ text: `Photo ${labels[i]}:` });
      parts.push({ inlineData: { mimeType: im.mime, data: im.data } });
    });
    const gem = await withRetry(async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(50000),
        },
      );
      const text = await res.text();
      if (!res.ok) throw new Error(`gemini ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    });

    const text = (gem.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p.text).filter(Boolean).join("");
    const normalised = normaliseClassification(parseModelJson(text), labels, candidates);
    const items = normalised.map((o, i) => ({ ...o, key: imgs[i].key }));

    const u = gem.usageMetadata || {};
    const outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    const usd = Number(((u.promptTokenCount || 0) / 1e6 * PRICE_PER_M.in + outTok / 1e6 * PRICE_PER_M.out).toFixed(5));
    console.log(JSON.stringify({ fn: "srm-set-classify", user: claims.claims.sub, n: imgs.length, usd, ms: Date.now() - t0 }));
    return json({ ok: true, items, usd });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    console.error(JSON.stringify({ fn: "srm-set-classify", error: msg, ms: Date.now() - t0 }));
    return json({ ok: false, error: msg }, 502);
  }
});
```

Append to `supabase/config.toml`:

```toml

# Bulk set upload (stock submission form): sorts one set folder's photos with Gemini.
# Called by vendors and staff via supabase.functions.invoke with the user's JWT; the handler
# also verifies the JWT with getClaims. Stated explicitly: a function absent from this file
# deploys open.
[functions.srm-set-classify]
verify_jwt = true
```

- [ ] **Step 6: Verify deploy and gate** — `read_file supabase/config.toml` ends with the block; `read_file` index.ts matches. Then ask Lovable: "Call `srm-set-classify` with no Authorization header and report the HTTP status" → expected `401`.

---

### Task 3: Browser utilities and the drop zone

**Files:**
- Create: `src/pages/srm/utils/thumbnail.ts`
- Create: `src/pages/srm/utils/classifySet.ts`
- Create: `src/pages/srm/components/SetFolderDropzone.tsx`

**Interfaces:**
- Consumes: `groupFilesByFolder`, `FolderGroup`, `ClassifiedItem` (Task 1); edge function contract (Task 2); `supabase` from `@/integrations/supabase/client`.
- Produces: `makeThumbnail(file: File, maxSide = 768): Promise<{ mime: "image/jpeg"; data: string } | null>`; `classifySet(input: { setCategory: string; division: string; images: { key: string; mime: string; data: string }[] }, timeoutMs = 60000): Promise<ClassifiedItem[]>`; `<SetFolderDropzone onFolders={(groups: FolderGroup[]) => void} disabled?: boolean />`.

These three are browser glue (canvas, drag-and-drop, network); their logic is in Task 1 / Task 2 and is unit-tested there. They are verified by type-check here and end-to-end in Task 6.

- [ ] **Step 1: Send the three files** — send Lovable: "Create these three files with exactly this content, then run `npm run type-check` and paste any errors for these files."

`src/pages/srm/utils/thumbnail.ts`:

```ts
/**
 * A small JPEG of a photo for the AI (longest side `maxSide` px), as base64 without the
 * data: prefix. Returns null when the browser cannot decode the file (e.g. HEIC in Chrome).
 */
export async function makeThumbnail(
  file: File,
  maxSide = 768,
): Promise<{ mime: "image/jpeg"; data: string } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const url = canvas.toDataURL("image/jpeg", 0.8);
    const data = url.slice(url.indexOf(",") + 1);
    return data ? { mime: "image/jpeg", data } : null;
  } catch {
    return null;
  }
}
```

`src/pages/srm/utils/classifySet.ts`:

```ts
import { supabase } from "@/integrations/supabase/client";
import type { ClassifiedItem } from "./setBulk";

/** Ask srm-set-classify to sort one set's photos. Throws on error or after `timeoutMs`. */
export async function classifySet(
  input: { setCategory: string; division: string; images: { key: string; mime: string; data: string }[] },
  timeoutMs = 60000,
): Promise<ClassifiedItem[]> {
  const call = supabase.functions.invoke("srm-set-classify", {
    body: { set_category: input.setCategory, division: input.division, images: input.images },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    const { data, error } = await Promise.race([call, timeout]);
    if (error) throw error;
    if (!data?.ok || !Array.isArray(data.items)) throw new Error(data?.error || "classify_failed");
    return data.items as ClassifiedItem[];
  } finally {
    clearTimeout(timer);
  }
}
```

`src/pages/srm/components/SetFolderDropzone.tsx`:

```tsx
import { useEffect, useRef, useState, type DragEvent } from "react";
import { FolderUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupFilesByFolder, type FolderGroup } from "../utils/setBulk";

type Entry = { path: string; file: File };

const readBatch = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
const entryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: FileSystemEntry, prefix: string, out: Entry[]) {
  if (entry.isFile) {
    out.push({ path: prefix + entry.name, file: await entryFile(entry as FileSystemFileEntry) });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries hands back at most ~100 entries per call: read until empty
  for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

type Props = { onFolders: (groups: FolderGroup[]) => void; disabled?: boolean };

/** Drop several set folders at once (one set per folder), or pick a folder. */
export function SetFolderDropzone({ onFolders, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    // not in React's input typings
    inputRef.current?.setAttribute("webkitdirectory", "");
    inputRef.current?.setAttribute("directory", "");
  }, []);

  const handle = (entries: Entry[]) => {
    const { groups, loose, skipped } = groupFilesByFolder(entries);
    if (loose) toast.warning(`${loose} photo(s) were not inside a folder and were left out. Put each set in its own folder.`);
    if (skipped) toast.info(`${skipped} non-photo file(s) ignored.`);
    if (!groups.length) {
      if (!loose) toast.error("No photos found in the folder(s).");
      return;
    }
    onFolders(groups);
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    // must be read before the first await: the item list is cleared after the event
    const roots = Array.from(e.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((x): x is FileSystemEntry => !!x);
    const out: Entry[] = [];
    try {
      for (const root of roots) await walk(root, "", out);
    } catch {
      toast.error("Couldn't read the dropped folder(s).");
      return;
    }
    handle(out);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors sm:flex-row sm:text-left",
        over ? "border-primary bg-primary/5" : "border-muted-foreground/30",
        disabled && "opacity-60",
      )}
    >
      <FolderUp className="h-6 w-6 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Bulk add sets</p>
        <p className="text-xs text-muted-foreground">
          Drag set folders here, one folder per set (whole-set photo + each part). AI sorts the photos;
          design numbers come from the folder name.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          handle(files.map((file) => ({ path: file.webkitRelativePath || file.name, file })));
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose folder
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — type-check reports no errors in these three files; `read_file` each matches.

---

### Task 4: Wire bulk sets, AI sorting and role switches into the form

**Files:**
- Modify: `src/pages/srm/tabs/StockSubmissionForm.tsx` (imports ~L59-63; `DesignRow` L158-181; after `PPT_TYPE_OPTIONS` L183-187; state L425; `addPhotos` L501-582; `updateDesign` L584-588; `addSet` L645-651; set-mode JSX L1836-1918)
- Modify: `src/pages/srm/components/SetArticleCard.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, Task 3 `makeThumbnail`, `classifySet`, `SetFolderDropzone`; existing `presCat` (`{ division, subDivision, majorCategory }`, L670), `compressImageToLimit`, `newId`, `MAX_PHOTOS`, `MAX_BYTES`.
- Produces: `SetArticleCard` prop `aiStatus?: "sorting" | "sorted" | "failed"` (Task 5 adds `detailsNode`).

- [ ] **Step 1: Send the form edits** — send Lovable: "Apply exactly these edits to `src/pages/srm/tabs/StockSubmissionForm.tsx`. Do not change anything else (submit, upload, sync code stay as they are)."

(a) Imports — after `import { isSetCategory, type SetRole } from "../utils/setCategories";` add:

```ts
import { SetFolderDropzone } from "../components/SetFolderDropzone";
import {
  applyClassification,
  makeWholeSet,
  markTouched,
  renumberSet,
  runPool,
  setPartRole,
  type FolderGroup,
  type PartKind,
  type Touched,
} from "../utils/setBulk";
import { makeThumbnail } from "../utils/thumbnail";
import { classifySet } from "../utils/classifySet";
```

(b) `DesignRow` — after `setMajorCategory?: string;` add:

```ts
  /** Bulk set upload: the AI's part kind and the fields the vendor changed by hand. */
  partKind?: PartKind;
  touched?: Touched;
```

(c) After the `PPT_TYPE_OPTIONS` constant add:

```ts
/** set_group_id is a uuid column. */
function newSetId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000-000000000000`;
}

/** The photo itself, or a compressed copy under MAX_BYTES; null when it can't be used. */
async function fitPhoto(f: File): Promise<{ file: File; compressed: boolean } | null> {
  if (!f.type.startsWith("image/")) return null;
  if (f.size <= MAX_BYTES) return { file: f, compressed: false };
  const shrunk = await compressImageToLimit(f);
  return shrunk ? { file: shrunk, compressed: true } : null;
}

function newDesignRow(file: File, extra: Partial<DesignRow> = {}): DesignRow {
  return {
    id: newId(),
    file,
    previewUrl: URL.createObjectURL(file),
    designNumber: "",
    fabric: "",
    sizes: "",
    noOfColors: "",
    quantity: "",
    price: "",
    availableDate: "",
    notes: "",
    sampleSize: "",
    garmentWeightGrams: "",
    pptType: "",
    costSheetFile: null,
    costSheetPreviewUrl: null,
    ...extra,
  };
}
```

(d) State — replace `const [sets, setSets] = useState<{ id: string; name: string }[]>([]);` with:

```ts
  const [sets, setSets] = useState<{ id: string; name: string; folder?: string }[]>([]);
  const [setAi, setSetAi] = useState<Record<string, "sorting" | "sorted" | "failed">>({});
```

(e) In `addPhotos`, replace the block from `let toUse = f;` through the closing `});` of `next.push({...})` with:

```ts
      const fit = await fitPhoto(f);
      if (!fit) {
        skipped++;
        continue;
      }
      if (fit.compressed) compressed++;
      const baseName = f.name.replace(/\.[^.]+$/, "");
      const commaIdx = baseName.indexOf(",");
      const parsedDesign = (commaIdx >= 0 ? baseName.slice(0, commaIdx) : baseName).trim();
      const afterComma = commaIdx >= 0 ? baseName.slice(commaIdx + 1).trim() : "";
      const parsedPrice = /^\d+(\.\d+)?$/.test(afterComma) ? afterComma : "";
      let setFields: Partial<DesignRow> = {};
      if (setTarget) {
        const hasPiece = next.some(
          (x) => x.setGroupId === setTarget.id && x.setRole !== "PARENT",
        );
        const role: SetRole =
          setTarget.kind === "parent" ? "PARENT" : hasPiece ? "PIECE" : "TOP";
        setFields = {
          setGroupId: setTarget.id,
          setRole: role,
          setDivision: division,
          setSubDivision: subDivision,
          // Parent = the set category picked on the form; parts choose their own.
          setMajorCategory: role === "PARENT" ? majorCategory : "",
        };
      }
      next.push(newDesignRow(fit.file, { designNumber: parsedDesign, price: parsedPrice, ...setFields }));
```

and delete the now-unused `if (!f.type.startsWith("image/")) { skipped++; continue; }` check above it (fitPhoto does it).

(f) Directly after `addPhotos` add:

```ts
  /** Bulk add: one set per dropped folder, then the AI sorts each set's photos. */
  const addFolderSets = async (groups: FolderGroup[]) => {
    let next = [...designs];
    // the empty starter set (no photos, no name) gives way to the folders
    const nextSets = sets.filter((s) => s.name.trim() || next.some((d) => d.setGroupId === s.id));
    const created: { setId: string; folder: string; count: number }[] = [];
    let skipped = 0;
    let compressed = 0;
    for (const g of groups) {
      const setId = newSetId();
      const rows: DesignRow[] = [];
      for (const f of g.files) {
        if (next.length + rows.length >= MAX_PHOTOS) {
          skipped++;
          continue;
        }
        const fit = await fitPhoto(f);
        if (!fit) {
          skipped++;
          continue;
        }
        if (fit.compressed) compressed++;
        // first guess until the AI answers: first photo = whole set, second = Top
        const role: SetRole = rows.length === 0 ? "PARENT" : rows.length === 1 ? "TOP" : "PIECE";
        rows.push(
          newDesignRow(fit.file, {
            setGroupId: setId,
            setRole: role,
            setDivision: division,
            setSubDivision: subDivision,
            setMajorCategory: role === "PARENT" ? majorCategory : "",
            partKind: role === "TOP" ? "TOP" : role === "PIECE" ? "OTHER" : undefined,
          }),
        );
      }
      if (!rows.length) continue;
      next = renumberSet(next.concat(rows), setId, g.folder);
      nextSets.push({ id: setId, name: g.folder, folder: g.folder });
      created.push({ setId, folder: g.folder, count: rows.length });
    }
    setSets(nextSets);
    setDesigns(next);
    if (skipped > 0)
      toast.warning(`Skipped ${skipped} photo(s): the ${MAX_PHOTOS}-photo limit was reached or the file couldn't be used.`);
    if (compressed > 0) toast.info(`${compressed} photo(s) were auto-compressed to fit the 20 MB limit.`);

    const toSort = created.filter((c) => c.count >= 2);
    if (!toSort.length) return;
    const cat = { division, subDivision, majorCategory };
    setSetAi((prev) => ({ ...prev, ...Object.fromEntries(toSort.map((c) => [c.setId, "sorting" as const])) }));
    await runPool(toSort, 3, async (c) => {
      try {
        const rows = next.filter((d) => d.setGroupId === c.setId).slice(0, 8);
        const thumbs = await Promise.all(rows.map((r) => makeThumbnail(r.file)));
        const images = rows.flatMap((r, i) => (thumbs[i] ? [{ key: r.id, ...thumbs[i]! }] : []));
        if (images.length < 2) throw new Error("fewer than 2 readable photos");
        const items = await classifySet({ setCategory: majorCategory, division, images });
        setDesigns((prev) => applyClassification(prev, c.setId, c.folder, items, cat));
        setSetAi((prev) => ({ ...prev, [c.setId]: "sorted" }));
        setTimeout(
          () =>
            setSetAi((prev) => {
              if (prev[c.setId] !== "sorted") return prev;
              const rest = { ...prev };
              delete rest[c.setId];
              return rest;
            }),
          3000,
        );
      } catch {
        setSetAi((prev) => ({ ...prev, [c.setId]: "failed" }));
        toast.error(`Set ${c.folder}: AI couldn't sort the photos. Set the roles by hand.`);
      }
    });
  };
```

(g) Replace `updateDesign` with:

```ts
  const updateDesign = (id: string, patch: Partial<DesignRow>) => {
    setDesigns((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...markTouched(d, patch) } : d))
    );
  };
```

(h) In `addSet`, replace the `const id = ...;` expression with `const id = newSetId();`.

(i) Set-mode JSX: directly inside `<div className="space-y-4">` that wraps `{sets.map((s, si) => {`, add as its first child:

```tsx
                    <SetFolderDropzone disabled={submitting} onFolders={addFolderSets} />
```

On `<SetArticleCard` add the prop `aiStatus={setAi[s.id]}`.

Replace the part header block (the `<div className="flex flex-wrap items-center gap-2">` containing `Part {pi + 1}` and the role `<Select>`) with:

```tsx
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">Part {pi + 1}</Badge>
                                <div className="w-40">
                                  <Select
                                    value={d.setRole ?? "PIECE"}
                                    onValueChange={(v) =>
                                      setDesigns((prev) => setPartRole(prev, d.id, v as "TOP" | "PIECE", presCat, s.folder))
                                    }
                                    disabled={submitting}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="TOP">Top (primary part)</SelectItem>
                                      <SelectItem value="PIECE">Other part</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={submitting}
                                  onClick={() => setDesigns((prev) => makeWholeSet(prev, d.id, presCat, s.folder))}
                                >
                                  Make whole set
                                </Button>
                              </div>
```

- [ ] **Step 2: Send the card edits** — send Lovable: "Apply exactly these edits to `src/pages/srm/components/SetArticleCard.tsx`."

- Import line: `import { ImagePlus, Layers, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";`
- `Props`: add `/** Bulk upload: AI sorting state of this set. */ aiStatus?: "sorting" | "sorted" | "failed";` and destructure `aiStatus` in the component parameters.
- After `<Badge variant="outline">{categoryLabel}</Badge>` add:

```tsx
          {aiStatus === "sorting" && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> AI sorting…
            </Badge>
          )}
          {aiStatus === "sorted" && (
            <Badge variant="outline" className="gap-1 text-green-700 dark:text-green-400">
              <Sparkles className="h-3 w-3" /> AI sorted
            </Badge>
          )}
          {aiStatus === "failed" && <Badge variant="destructive">AI failed — set roles manually</Badge>}
```

- Under the `b. Parts ({partCount})` paragraph add:

```tsx
          {hasParent && partCount === 0 && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Add parts: this set has only the whole-set photo.
            </p>
          )}
```

- [ ] **Step 3: Verify build and existing tests** — ask Lovable to run `npm run type-check` and `npx vitest run`; expected: no type errors, all tests pass (Task 1 suite included).

- [ ] **Step 4: Commit check** — `get_diff` for the message: only the listed regions of the two files changed; submit / upload / sync code untouched.

- [ ] **Step 5: Smoke check on preview** — open the preview, pick a KURTI_ST category: the drop zone shows above "Set 1"; the manual "Choose whole-set photo" / "Add part" buttons still work.

- [ ] **Step 6: Review-focus manual checks** (preview):
  - Drop 2 loose photos (no folder) → warning toast, no set added.
  - Drop a folder with 10 photos → 10 rows, AI call made with 8 (function log `n: 8`), rows 9-10 stay "Other part".
  - Drop a folder containing a HEIC + one JPG → set shows "AI failed — set roles manually", rows editable.

---

### Task 5: Per-set details strip

**Files:**
- Create: `src/pages/srm/components/SetDetailsStrip.tsx`
- Modify: `src/pages/srm/components/SetArticleCard.tsx`
- Modify: `src/pages/srm/tabs/StockSubmissionForm.tsx`

**Interfaces:**
- Consumes: `FabricCombobox` (`@/pages/srm/components/FabricCombobox`, props `value`, `onChange`, `disabled`, `placeholder`), form's `PPT_TYPE_OPTIONS`, `pptTypeEnabled`.
- Produces: `SetDetails` type, `EMPTY_SET_DETAILS`, `<SetDetailsStrip value onChange onApply disabled pptTypeEnabled pptOptions />`; `SetArticleCard` prop `detailsNode?: ReactNode`.

- [ ] **Step 1: Send the strip component** — send Lovable: "Create `src/pages/srm/components/SetDetailsStrip.tsx` with exactly this content."

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FabricCombobox } from "@/pages/srm/components/FabricCombobox";

/** Details that are the same for every part of one set. Price, weight and design no. stay per part. */
export type SetDetails = {
  fabric: string;
  sizes: string;
  noOfColors: string;
  quantity: string;
  availableDate: string;
  sampleSize: string;
  pptType: string;
};

export const EMPTY_SET_DETAILS: SetDetails = {
  fabric: "",
  sizes: "",
  noOfColors: "",
  quantity: "",
  availableDate: "",
  sampleSize: "",
  pptType: "",
};

type Props = {
  value: SetDetails;
  onChange: (next: SetDetails) => void;
  onApply: () => void;
  disabled?: boolean;
  pptTypeEnabled: boolean;
  pptOptions: { value: string; label: string }[];
};

export function SetDetailsStrip({ value, onChange, onApply, disabled, pptTypeEnabled, pptOptions }: Props) {
  const [open, setOpen] = useState(false);
  const set = (k: keyof SetDetails, v: string) => onChange({ ...value, [k]: v });

  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-left text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Set details (same for all parts)
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Fabric</Label>
              <FabricCombobox value={value.fabric} onChange={(v) => set("fabric", v)} disabled={disabled} placeholder="Pick from list" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sizes</Label>
              <Input placeholder="e.g. S, M, L, XL" value={value.sizes} onChange={(e) => set("sizes", e.target.value)} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">No. of Colors</Label>
              <Input type="number" min={0} value={value.noOfColors} onChange={(e) => set("noOfColors", e.target.value)} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity</Label>
              <Input type="number" min={0} value={value.quantity} onChange={(e) => set("quantity", e.target.value)} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Date</Label>
              <Input type="date" value={value.availableDate} onChange={(e) => set("availableDate", e.target.value)} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sample Size</Label>
              <Input placeholder="e.g. S" value={value.sampleSize} onChange={(e) => set("sampleSize", e.target.value)} disabled={disabled} />
            </div>
            {pptTypeEnabled && (
              <div className="space-y-1.5">
                <Label className="text-xs">PPT Type</Label>
                <Select value={value.pptType || undefined} onValueChange={(v) => set("pptType", v)} disabled={disabled}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {pptOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={onApply} disabled={disabled} className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Apply to parts
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Send the card and form edits** — send Lovable: "Apply exactly these edits."

`SetArticleCard.tsx`: add prop `/** Per-set details strip, rendered by the form. */ detailsNode?: ReactNode;`, destructure it, and render `{detailsNode}` directly after the closing `</div>` of the header row (before `{/* Step A: whole set */}`).

`StockSubmissionForm.tsx`:
- Import: `import { EMPTY_SET_DETAILS, SetDetailsStrip, type SetDetails } from "../components/SetDetailsStrip";`
- State, after the `setAi` line: `const [setDetails, setSetDetails] = useState<Record<string, SetDetails>>({});`
- After `addFolderSets` add:

```ts
  /** Copy a set's filled details to every part of that set (the parent derives from its parts). */
  const applySetDetails = (setId: string) => {
    const filled = Object.fromEntries(
      Object.entries(setDetails[setId] ?? EMPTY_SET_DETAILS).filter(([, v]) => v !== ""),
    ) as Partial<DesignRow>;
    if (!Object.keys(filled).length) {
      toast.info("Fill in at least one set detail first");
      return;
    }
    const count = designs.filter((d) => d.setGroupId === setId && d.setRole !== "PARENT").length;
    setDesigns((prev) =>
      prev.map((d) => (d.setGroupId === setId && d.setRole !== "PARENT" ? { ...d, ...filled } : d)),
    );
    toast.success(`Applied to ${count} part(s)`);
  };
```

- On `<SetArticleCard` add:

```tsx
                          detailsNode={
                            <SetDetailsStrip
                              value={setDetails[s.id] ?? EMPTY_SET_DETAILS}
                              onChange={(v) => setSetDetails((prev) => ({ ...prev, [s.id]: v }))}
                              onApply={() => applySetDetails(s.id)}
                              disabled={submitting}
                              pptTypeEnabled={pptTypeEnabled}
                              pptOptions={PPT_TYPE_OPTIONS}
                            />
                          }
```

- [ ] **Step 3: Verify** — Lovable runs `npm run type-check` and `npx vitest run`: no errors, all pass. `get_diff`: only the listed regions changed.

- [ ] **Step 4: Manual check** — on preview, with two sets: fill Fabric + Sizes in Set 1's strip, Apply → toast "Applied to N part(s)", Set 1 parts show the values, Set 2 parts unchanged, Set 1 whole-set row shows the Top's fabric (derived).

---

### Task 6: End-to-end verification on preview (spec §6)

**Files:** none

Test data: three folders `KS-T1`, `KS-T2`, `KS-T3`, each with a whole-set photo + kurti + plazo + dupatta photo (owner supplies real sample photos).

- [ ] **Step 1:** Preview → Stock submission → category KURTI_ST → drop all three folders at once. Expected: 3 sets named after the folders, chips "AI sorting…" then "AI sorted"; in each set the whole-set photo is the parent, kurti = Top with a kurti category, plazo / dupatta categories in the same division; design numbers `KS-T1`, `KS-T1-T`, `KS-T1-B`, `KS-T1-D`.
- [ ] **Step 2:** In set 2 press "Make whole set" on the plazo → plazo becomes parent with the set category, old parent becomes "Other part" with an empty category; exactly one Top; design numbers recomputed. Then drop a 4th folder and, while it says "AI sorting…", change one part's category → after "AI sorted" the changed category is still there.
- [ ] **Step 3:** Fill each set's strip + price and weight per part; check the whole-set row shows price = sum of parts.
- [ ] **Step 4:** Submit. Expected: success dialog with one PRES number.
- [ ] **Step 5:** Read-only MDM check (Backend `.env` DATABASE_URL via pooler, `ssl:{rejectUnauthorized:false}`, never print the URL):

```sql
SELECT set_group_id, set_role, set_name, COUNT(*) AS photos
FROM extraction_results_flat
WHERE ppt_number = '<PRES number from step 4>'
GROUP BY set_group_id, set_role, set_name
ORDER BY set_name, set_role;
```

Expected: one `set_group_id` per folder, each with 1 `PARENT`, 1 `TOP`, the rest `PIECE`, `set_name` = folder name. (If rows are not there yet, sync runs after submit — re-check after a minute; do not write to the DB.)

- [ ] **Step 6:** Update `HANDOVER-SET-ARTICLE.md` "In progress" section: bulk upload built on preview, test PRES number, anything that failed.
