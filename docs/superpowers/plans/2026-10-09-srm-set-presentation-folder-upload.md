# SRM Presentation-Folder Set Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the SRM stock submission form (set mode), the uploader drops one presentation folder; every sub-folder becomes a set card whose own set category, whole-set photo, Top and part categories are picked by AI, with AI-picked set categories confirmed before submit.

**Architecture:** The browser reads the folder and builds the form's existing `sets[]` / `DesignRow[]` state, so submit, PRES numbering and MDM sync stay as they are. `sets[]` grows from `{id, name}` to `SetMeta` (own category + how it was chosen). The existing edge function `srm-set-classify` additionally returns the set's category, snapped to the division's set categories. All role / numbering / category rules are pure, unit-tested helpers in `setBulk.ts`.

**Tech Stack:** React 18 + TypeScript + shadcn/ui (Vite), vitest (`src/**/*.test.ts`), Supabase Edge Functions (Deno, `deno test`), Gemini REST.

**Spec:** `docs/superpowers/specs/2026-10-09-srm-set-presentation-folder-upload-design.md`

**How code reaches SRM:** SRM is the Lovable project V2-SRM, `project_id a381fbb9-6fe5-4023-8259-c1b8bee9c82c`. No local clone: every code step is a Lovable `send_message` containing the exact content / edit below, telling Lovable to apply it **verbatim**, change nothing else, and run the named check. Lovable auto-commits each message; each task's "commit check" is `read_file` / `get_diff` of the changed files compared with this plan. If `send_message` times out on the client, do NOT resend: `list_messages` / `read_file` first (the edit usually landed).

## Global Constraints

- Lovable: preview only, never publish (the set flow is live on srm.v2retail.com; publishing needs owner OK after Task 5). Do not regenerate `src/integrations/supabase/types.ts`. No costing / TNA / ASN / roles changes.
- No DB schema change, no new table; `srm-set-classify` makes no DB writes; DB checks are read-only.
- Unchanged: submit / PRES numbering, `sync-presentation-to-mdm`, `srm-fastppt-extract`, `setCategories.ts`, the Article Creation code.
- `srm-set-classify`: JWT checked with `getClaims` (any signed-in SRM user); max 8 images per call; thumbnails JPEG, longest side 768 px; at most 3 sets sorted in parallel; 60 s timeout per set.
- Design numbers: parent = folder name; parts = folder + `-T` / `-B` / `-D` / `-O`, repeats numbered (`-B2`); a hand-edited value is never overwritten.
- Per part: price, garment weight, design number. Per set strip: fabric, sizes, no. of colors, delivery date, sample size, PPT type.
- Existing `MAX_PHOTOS = 50` and 20 MB compression apply to bulk-added photos.
- An AI-picked set category must be confirmed (✓ or a hand pick) before submit; a set with no category blocks submit.

## Review Focus

1. Top category changed after a bulk upload → only sets still on the default follow it; AI-picked and hand-picked sets keep theirs. (Task 1 test `followTopCategory moves only default sets`.)
2. AI suggests the same category as the default → no needless "check" chip. (Task 1 test `same as default stays confirmed`.)
3. Uploader picks a set category while the AI is still sorting → the AI answer does not override it. (Task 1 test `never overrides a hand pick`.)
4. Uploader clears a set's category ("Change category") → submit blocked naming that set. (Task 1 test `setsNeedingCategory lists missing and unchecked`.)
5. Set moved to another division → its untouched part categories are cleared and re-sorted, touched ones kept. (Task 1 test `resetPartCategories`; Task 5 Step 4.)

---

### Task 0: Kick-off in Lovable plan mode

**Files:** none

- [ ] **Step 1:** `send_message(project_id, plan_mode=true)`: "We are wiring presentation-folder bulk upload for set articles into `src/pages/srm/tabs/StockSubmissionForm.tsx`. I will send exact code in 4 messages: (1) helpers in `src/pages/srm/utils/setBulk.ts` + tests, (2) `srm-set-classify` returns the set's category + tests + deploy, (3) browser utilities, `SetFolderDropzone`, `SetDetailsStrip`, a `filterCategory` prop on `DivisionCascadeSelect`, (4) form + `SetArticleCard` wiring. Apply each verbatim. No DB migrations; do not touch types.ts, submit/sync, fast-track, costing/TNA/ASN/roles; do not publish. Confirm; no code yet."
- [ ] **Step 2:** Lovable confirms with no extra proposals. If it proposes extra changes, reply "No, only the messages I send."

---

### Task 1: Per-set category helpers (`setBulk.ts`)

**Files:**
- Modify: `src/pages/srm/utils/setBulk.ts` (append at end)
- Test: `src/pages/srm/utils/setBulk.test.ts` (append at end)

**Interfaces:**
- Consumes: existing `SetCat`, `SetRowLike` in `setBulk.ts`.
- Produces: `SetMeta`, `SetPick`, `setCatOf(s)`, `newSetMeta(id, cat, folder?)`, `applySetPick(s, pick)`, `pickSetCategory(s, cat)`, `followTopCategory(sets, cat)`, `setsNeedingCategory(sets): string[]`, `resetPartCategories(rows, setId, division)`.

- [ ] **Step 1: Write the failing tests** — send Lovable: "Append exactly this to the END of `src/pages/srm/utils/setBulk.test.ts` and add `applySetPick, followTopCategory, newSetMeta, pickSetCategory, resetPartCategories, setsNeedingCategory, type SetMeta` to its import from `./setBulk`. Run `npx vitest run src/pages/srm/utils/setBulk.test.ts` and paste the output (it must fail)."

```ts
describe("presentation folder", () => {
  it("gives one set per sub-folder of the presentation folder", () => {
    const { groups } = groupFilesByFolder([
      { path: "PRES-OCT/KS-101/1.jpg", file: img("1.jpg") },
      { path: "PRES-OCT/KS-101/2.jpg", file: img("2.jpg") },
      { path: "PRES-OCT/BS-7/1.jpg", file: img("1.jpg") },
    ]);
    expect(groups.map((g) => g.folder)).toEqual(["BS-7", "KS-101"]);
  });
});

describe("set categories", () => {
  const TOP = { division: "LADIES", subDivision: "LK&L", majorCategory: "L_KURTI_ST" };
  const KIDS = { division: "KIDS", subDivision: "KB-SETS", majorCategory: "JB_SUIT" };
  const aiKids = { major_category: "JB_SUIT", sub_div: "KB-SETS", div: "KIDS", source: "ai" as const };

  it("a new set follows the top category and is confirmed", () => {
    const s = newSetMeta("S1", TOP, "KS-101");
    expect(s).toMatchObject({ name: "KS-101", folder: "KS-101", ...TOP, catSource: "default", catConfirmed: true });
  });

  it("an AI pick replaces the default and needs a check", () => {
    const s = applySetPick(newSetMeta("S1", TOP), aiKids);
    expect(s).toMatchObject({ ...KIDS, catSource: "ai", catConfirmed: false });
  });

  it("same as default stays confirmed", () => {
    const pick = { major_category: "L_KURTI_ST", sub_div: "LK&L", div: "LADIES", source: "ai" as const };
    expect(applySetPick(newSetMeta("S1", TOP), pick)).toMatchObject({ catSource: "default", catConfirmed: true });
  });

  it("never overrides a hand pick, and ignores a default or missing answer", () => {
    const mine = pickSetCategory(newSetMeta("S1", TOP), KIDS);
    expect(applySetPick(mine, { ...aiKids, major_category: "YB_SUIT" })).toBe(mine);
    const s = newSetMeta("S2", TOP);
    expect(applySetPick(s, { major_category: "L_KURTI_ST", sub_div: null, div: null, source: "default" })).toBe(s);
    expect(applySetPick(s, null)).toBe(s);
  });

  it("a hand pick is confirmed; clearing it is not", () => {
    expect(pickSetCategory(newSetMeta("S1", TOP), KIDS)).toMatchObject({ ...KIDS, catSource: "user", catConfirmed: true });
    expect(pickSetCategory(newSetMeta("S1", TOP), { division: "", subDivision: "", majorCategory: "" }).catConfirmed).toBe(false);
  });

  it("followTopCategory moves only default sets", () => {
    const sets: SetMeta[] = [newSetMeta("A", TOP), applySetPick(newSetMeta("B", TOP), aiKids), pickSetCategory(newSetMeta("C", TOP), KIDS)];
    const NEW = { division: "LADIES", subDivision: "LU", majorCategory: "L_CO-ORD_SET" };
    const out = followTopCategory(sets, NEW);
    expect(out.map((s) => s.majorCategory)).toEqual(["L_CO-ORD_SET", "JB_SUIT", "JB_SUIT"]);
  });

  it("setsNeedingCategory lists missing and unchecked", () => {
    const sets: SetMeta[] = [
      newSetMeta("A", TOP, "KS-1"),
      applySetPick(newSetMeta("B", TOP, "KS-2"), aiKids),
      pickSetCategory(newSetMeta("C", TOP), { division: "", subDivision: "", majorCategory: "" }),
    ];
    expect(setsNeedingCategory(sets)).toEqual(["KS-2", "Set 3"]);
  });

  it("resetPartCategories clears untouched part categories only", () => {
    const rows = [
      row("p", { setRole: "PARENT", setMajorCategory: "JB_SUIT" }),
      row("a", { setDivision: "LADIES", setSubDivision: "L_UPPER", setMajorCategory: "L_KURTI" }),
      row("b", { setMajorCategory: "J_PANT", touched: { category: true } }),
      row("x", { setGroupId: "S2", setMajorCategory: "L_KURTI" }),
    ];
    const out = resetPartCategories(rows, "S1", "KIDS");
    expect(out[0].setMajorCategory).toBe("JB_SUIT");
    expect(out[1]).toMatchObject({ setDivision: "KIDS", setSubDivision: "", setMajorCategory: "" });
    expect(out[2].setMajorCategory).toBe("J_PANT");
    expect(out[3].setMajorCategory).toBe("L_KURTI");
  });
});
```

- [ ] **Step 2: Verify it fails** — output shows the new imports are not exported (e.g. `newSetMeta is not a function`).

- [ ] **Step 3: Write the implementation** — send Lovable: "Append exactly this to the END of `src/pages/srm/utils/setBulk.ts`, change nothing else, then run `npx vitest run src/pages/srm/utils/setBulk.test.ts` and paste the output."

```ts
/** One set card: its own category and how it was chosen (presentation-folder upload). */
export type SetMeta = {
  id: string;
  name: string;
  folder?: string;
  division: string;
  subDivision: string;
  majorCategory: string;
  /** default = the form's top category, ai = picked by srm-set-classify, user = picked by hand */
  catSource: "default" | "ai" | "user";
  /** false while the category is missing or an AI pick is not yet checked */
  catConfirmed: boolean;
};

/** The set-category part of an srm-set-classify answer. */
export type SetPick = {
  major_category: string;
  sub_div: string | null;
  div: string | null;
  source: "ai" | "default";
};

export const setCatOf = (s: SetMeta): SetCat => ({
  division: s.division,
  subDivision: s.subDivision,
  majorCategory: s.majorCategory,
});

/** A new set that follows the form's top category. */
export function newSetMeta(id: string, cat: SetCat, folder?: string): SetMeta {
  return { id, name: folder ?? "", folder, ...cat, catSource: "default", catConfirmed: true };
}

/** Take the AI's set category unless the uploader chose one; a changed AI pick must be checked. */
export function applySetPick(s: SetMeta, pick: SetPick | null | undefined): SetMeta {
  if (!pick || pick.source !== "ai" || !pick.div || !pick.sub_div || s.catSource === "user") return s;
  if (pick.major_category === s.majorCategory) return s;
  return {
    ...s,
    division: pick.div,
    subDivision: pick.sub_div,
    majorCategory: pick.major_category,
    catSource: "ai",
    catConfirmed: false,
  };
}

/** The uploader picked (or cleared) the set's category by hand. */
export function pickSetCategory(s: SetMeta, cat: SetCat): SetMeta {
  return { ...s, ...cat, catSource: "user", catConfirmed: !!cat.majorCategory };
}

/** The form's top category changed: sets still on the default follow it. */
export function followTopCategory(sets: SetMeta[], cat: SetCat): SetMeta[] {
  return sets.map((s) => (s.catSource === "default" ? { ...s, ...cat } : s));
}

/** Names of sets that block submit: no category, or an AI pick not yet checked. */
export function setsNeedingCategory(sets: SetMeta[]): string[] {
  return sets.flatMap((s, i) => (s.majorCategory && s.catConfirmed ? [] : [s.name.trim() || `Set ${i + 1}`]));
}

/** A set moved to another division: its parts' untouched categories no longer fit. */
export function resetPartCategories<T extends SetRowLike>(rows: T[], setId: string, division: string): T[] {
  return rows.map((r) =>
    r.setGroupId === setId && r.setRole !== "PARENT" && !r.touched?.category
      ? { ...r, setDivision: division, setSubDivision: "", setMajorCategory: "" }
      : r,
  );
}
```

- [ ] **Step 4: Verify it passes** — all `setBulk.test.ts` tests PASS (old ones included).
- [ ] **Step 5: Commit check** — `read_file` both files; the appended blocks equal this plan, nothing else changed.

---

### Task 2: `srm-set-classify` returns the set's category

**Files:**
- Modify: `supabase/functions/srm-set-classify/normalize.ts` (append)
- Modify: `supabase/functions/srm-set-classify/index.ts`
- Test: `supabase/functions/srm-set-classify/normalize.test.ts` (append)

**Interfaces:**
- Consumes: existing `Candidate`, `snapToGrid`, `normaliseClassification`.
- Produces: `normaliseSetCategory(raw, setCandidates, fallback): SetPick`; HTTP response `{ ok: true, items, set: { major_category, sub_div, div, source: "ai" | "default" }, usd }`. The browser's `SetPick` (Task 1) matches this shape.

- [ ] **Step 1: Write the failing tests** — send Lovable: "Append exactly this to the END of `supabase/functions/srm-set-classify/normalize.test.ts`, change its import to `import { normaliseClassification, normaliseSetCategory, type Candidate } from \"./normalize.ts\";`, run the `srm-set-classify` Deno tests and paste the output (the new tests must fail)."

```ts
const SET_CANDS: Candidate[] = [
  { maj_cat: "L_KURTI_ST", sub_div: "LK&L", div: "LADIES" },
  { maj_cat: "L_CO-ORD_SET", sub_div: "LU", div: "LADIES" },
];

Deno.test("set category: an exact answer is the AI's pick", () => {
  const out = normaliseSetCategory({ set_category: "L_CO-ORD_SET", items: [] }, SET_CANDS, "L_KURTI_ST");
  assertEquals(out, { major_category: "L_CO-ORD_SET", sub_div: "LU", div: "LADIES", source: "ai" });
});

Deno.test("set category: unknown, missing or no candidates falls back to the default", () => {
  const fb = { major_category: "L_KURTI_ST", sub_div: null, div: null, source: "default" };
  assertEquals(normaliseSetCategory({ set_category: "M_JEANS_XYZ", items: [] }, SET_CANDS, "L_KURTI_ST"), fb);
  assertEquals(normaliseSetCategory([{ key: "p1" }], SET_CANDS, "L_KURTI_ST"), fb);
  assertEquals(normaliseSetCategory({ set_category: "L_CO-ORD_SET" }, [], "L_KURTI_ST"), fb);
});
```

- [ ] **Step 2: Verify it fails** — `normaliseSetCategory` is not exported.

- [ ] **Step 3: Implement `normaliseSetCategory`** — send Lovable: "Append exactly this to the END of `supabase/functions/srm-set-classify/normalize.ts`, change nothing else, re-run the Deno tests and paste the summary (expect 8 passed)."

```ts
export type SetPick = {
  major_category: string;
  sub_div: string | null;
  div: string | null;
  source: "ai" | "default";
};

/** The set's own category: the model's `set_category` snapped to the division's set categories, else the fallback. */
export function normaliseSetCategory(raw: unknown, setCandidates: Candidate[], fallback: string): SetPick {
  const said = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).set_category
    : null;
  const allowed = [...new Set(setCandidates.map((c) => c.maj_cat))];
  const snapped = typeof said === "string" && said.trim() ? snapToGrid(said, allowed) : null;
  const cand = snapped ? setCandidates.find((c) => c.maj_cat === snapped) ?? null : null;
  if (cand) return { major_category: cand.maj_cat, sub_div: cand.sub_div, div: cand.div, source: "ai" };
  return { major_category: fallback, sub_div: null, div: null, source: "default" };
}
```

- [ ] **Step 4: Verify** — 8 Deno tests pass.

- [ ] **Step 5: Edit `index.ts` and deploy** — send Lovable: "Apply exactly these four edits to `supabase/functions/srm-set-classify/index.ts`, change nothing else, re-run the Deno tests, then deploy only `srm-set-classify`."

(a) Import line becomes:
```ts
import { normaliseClassification, normaliseSetCategory, type Candidate } from "./normalize.ts";
```

(b) Replace the whole `buildPrompt` function with:
```ts
function buildPrompt(setCategory: string, setCategories: string[], categories: string[], n: number): string {
  const setLine = setCategories.length
    ? `- "set_category": which set this is, from this list ONLY, copied exactly: ${setCategories.join(", ")}. The uploader's default is ${setCategory}; pick another only if the photos clearly show a different set (age group, sleeve length, garment types).\n`
    : "";
  return `You are sorting the photos of ONE garment set uploaded by a vendor.
There are ${n} photos, labelled p1 to p${n}; each label is written just before its photo.
${setLine}- Exactly one photo should show the WHOLE SET: all garments of the set together (for example kurti + bottom + dupatta worn or laid out together). Mark it "whole_set": true; every other photo "whole_set": false.
- Every other photo shows ONE part of the set. Give "part_kind": "TOP" (kurti, kurta, top, shirt: the upper garment), "BOTTOM" (plazo, pant, salwar, legging, skirt, sharara), "DUPATTA" (dupatta, stole, scarf) or "OTHER".
- "garment_count": how many separate garments are visible in the photo.
- "major_category": the best match for that part from this list ONLY, copied exactly: ${categories.join(", ")}. Use null for the whole-set photo.
Return ONLY JSON:
{"set_category":"${setCategory}","items":[{"key":"p1","whole_set":true,"garment_count":3,"part_kind":"OTHER","major_category":null}]}`;
}
```

(c) Replace the candidate loop (from `const seen = new Set<string>();` through the `if (!candidates.length) ...` line) with:
```ts
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const setCandidates: Candidate[] = [];
  for (const r of (menu || []) as Candidate[]) {
    if (seen.has(r.maj_cat)) continue;
    seen.add(r.maj_cat);
    (isSetCode(String(r.maj_cat)) ? setCandidates : candidates).push(r);
  }
  if (!candidates.length) return json({ ok: false, error: "no_categories_for_division" }, 422);
```

(d) Replace the line building `parts` with:
```ts
    const parts: unknown[] = [{
      text: buildPrompt(setCategory, setCandidates.map((c) => c.maj_cat), candidates.map((c) => c.maj_cat), imgs.length),
    }];
```
and replace
```ts
    const normalised = normaliseClassification(parseModelJson(text), labels, candidates);
```
with
```ts
    const parsed = parseModelJson(text);
    const normalised = normaliseClassification(parsed, labels, candidates);
    const set = normaliseSetCategory(parsed, setCandidates, setCategory);
```
and `return json({ ok: true, items, usd });` with `return json({ ok: true, items, set, usd });`.

- [ ] **Step 6: Verify deploy** — Supabase `get_edge_function(pymdqnnwwxrgeolvgvgv, srm-set-classify)`: version > 24 and the deployed `index.ts` contains `normaliseSetCategory`. Ask Lovable to call the function without an Authorization header → `401`.

---

### Task 3: Browser utilities, drop zone, details strip, set-only picker

**Files:**
- Create: `src/pages/srm/utils/thumbnail.ts`, `src/pages/srm/utils/classifySet.ts`, `src/pages/srm/components/SetFolderDropzone.tsx`, `src/pages/srm/components/SetDetailsStrip.tsx`
- Modify: `src/pages/srm/components/DivisionCascadeSelect.tsx`

**Interfaces:**
- Consumes: `groupFilesByFolder`, `FolderGroup`, `ClassifiedItem`, `SetPick` (Task 1 / existing); edge response (Task 2); `FabricCombobox` (`value`, `onChange`, `disabled`, `placeholder`).
- Produces: `makeThumbnail(file, maxSide = 768): Promise<{ mime: "image/jpeg"; data: string } | null>`; `classifySet(input: { setCategory: string; division: string; images: { key: string; mime: string; data: string }[] }, timeoutMs = 60000): Promise<{ items: ClassifiedItem[]; set: SetPick | null }>`; `<SetFolderDropzone onFolders={(groups: FolderGroup[]) => void} disabled? />`; `SetDetails`, `EMPTY_SET_DETAILS`, `<SetDetailsStrip value onChange onApply disabled pptTypeEnabled pptOptions />`; `DivisionCascadeSelect` prop `filterCategory?: (majorCategory: string) => boolean`.

Browser glue only (canvas, drag-and-drop, network, layout); logic is unit-tested in Tasks 1-2. Verified by type-check here and end-to-end in Task 5.

- [ ] **Step 1: Send the files** — send Lovable: "Create these four files with exactly this content and apply the DivisionCascadeSelect edit; change nothing else. Run `npm run type-check` and paste any errors in these files."

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
import type { ClassifiedItem, SetPick } from "./setBulk";

/** Ask srm-set-classify to sort one set's photos. Throws on error or after `timeoutMs`. */
export async function classifySet(
  input: { setCategory: string; division: string; images: { key: string; mime: string; data: string }[] },
  timeoutMs = 60000,
): Promise<{ items: ClassifiedItem[]; set: SetPick | null }> {
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
    return { items: data.items as ClassifiedItem[], set: (data.set ?? null) as SetPick | null };
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

/** Drop or pick a presentation folder: every sub-folder with photos becomes one set. */
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
          Drop the presentation folder: one sub-folder per set (whole-set photo + each part). AI sorts
          the photos and picks each set's category; design numbers come from the sub-folder name.
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

`src/pages/srm/components/SetDetailsStrip.tsx`:
```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FabricCombobox } from "@/pages/srm/components/FabricCombobox";

/** Details shared by every part of one set. Price, weight and design no. stay per part. */
export type SetDetails = {
  fabric: string;
  sizes: string;
  noOfColors: string;
  availableDate: string;
  sampleSize: string;
  pptType: string;
};

export const EMPTY_SET_DETAILS: SetDetails = {
  fabric: "",
  sizes: "",
  noOfColors: "",
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

`src/pages/srm/components/DivisionCascadeSelect.tsx` edit:
- In `Props`, after `fabricMode?: boolean;` add:
```ts
  /** Only list major categories this returns true for (e.g. set categories). */
  filterCategory?: (majorCategory: string) => boolean;
```
- Add `filterCategory,` to the destructured parameters after `fabricMode = false,`.
- In the `triples` `useMemo`, as the first line inside `for (const r of hierarchyQ.data || []) {` add `if (filterCategory && !filterCategory(r.maj_cat)) continue;`, and change its dependency list to `[hierarchyQ.data, filterCategory]`.

- [ ] **Step 2: Verify** — type-check: no errors in these five files; `read_file` each new file equals this plan; `get_diff` of DivisionCascadeSelect shows only the three listed changes.

---

### Task 4: Wire it into the form and the set card

**Files:**
- Modify: `src/pages/srm/components/SetArticleCard.tsx`
- Modify: `src/pages/srm/tabs/StockSubmissionForm.tsx` (imports ~L59-63; `DesignRow` ~L158-181; after `PPT_TYPE_OPTIONS` ~L183-187; state ~L425; `addPhotos` set fields ~L545-556; `updateDesign` ~L584-588; `addSet` ~L645-651; `catOf` ~L658-666; set-mode effect ~L678-693; submit set check ~L812-828; set-mode JSX ~L1836-1918)

**Interfaces:**
- Consumes: Tasks 1-3 exports; existing `isSetCategory`, `DivisionCascadeSelect`, `compressImageToLimit`, `newId`, `MAX_PHOTOS`, `MAX_BYTES`, `PPT_TYPE_OPTIONS`, `pptTypeEnabled`, `Label`, `Badge`, `Button`.
- Produces: `SetArticleCard` props `aiStatus?`, `categoryCheck?`, `onConfirmCategory?`, `categoryNode?`, `detailsNode?`.

- [ ] **Step 1: Send the card edits** — send Lovable: "Apply exactly these edits to `src/pages/srm/components/SetArticleCard.tsx`; change nothing else."

- lucide import becomes `import { Check, ImagePlus, Layers, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";`
- In `Props`, after `children?: ReactNode;` add:
```ts
  /** Bulk upload: AI sorting state of this set. */
  aiStatus?: "sorting" | "sorted" | "failed";
  /** The set category was picked by AI and still needs the uploader's check. */
  categoryCheck?: boolean;
  onConfirmCategory?: () => void;
  /** Set category picker and per-set details strip, rendered by the form. */
  categoryNode?: ReactNode;
  detailsNode?: ReactNode;
```
  and add `aiStatus, categoryCheck, onConfirmCategory, categoryNode, detailsNode,` to the destructured parameters.
- Replace `<Badge variant="outline">{categoryLabel}</Badge>` with:
```tsx
          <Badge variant="outline">{categoryLabel || "No set category"}</Badge>
          {categoryCheck && (
            <>
              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200">
                AI picked — check
              </Badge>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1" onClick={onConfirmCategory} disabled={disabled}>
                <Check className="h-3.5 w-3.5" /> Correct
              </Button>
            </>
          )}
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
- Directly before `{/* Step A: whole set */}` add `{categoryNode}` and `{detailsNode}`.
- Directly after the `b. Parts ({partCount})` `<h4>` add:
```tsx
          {hasParent && partCount === 0 && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Add parts: this set has only the whole-set photo.
            </p>
          )}
```

- [ ] **Step 2: Send the form edits** — send Lovable: "Apply exactly these edits to `src/pages/srm/tabs/StockSubmissionForm.tsx`. Do not change anything else: submit upload, insert and sync code stay as they are."

(a) After `import { isSetCategory, type SetRole } from "../utils/setCategories";` add:
```ts
import { SetFolderDropzone } from "../components/SetFolderDropzone";
import { EMPTY_SET_DETAILS, SetDetailsStrip, type SetDetails } from "../components/SetDetailsStrip";
import {
  applyClassification,
  applySetPick,
  followTopCategory,
  makeWholeSet,
  markTouched,
  newSetMeta,
  normaliseSetRoles,
  pickSetCategory,
  renumberSet,
  resetPartCategories,
  runPool,
  setCatOf,
  setPartRole,
  setsNeedingCategory,
  type FolderGroup,
  type PartKind,
  type SetCat,
  type SetMeta,
  type Touched,
} from "../utils/setBulk";
import { makeThumbnail } from "../utils/thumbnail";
import { classifySet } from "../utils/classifySet";
```

(b) In `DesignRow`, after `setMajorCategory?: string;` add:
```ts
  /** Bulk set upload: the AI's part kind and the fields the uploader changed by hand. */
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

(d) Replace `const [sets, setSets] = useState<{ id: string; name: string }[]>([]);` with:
```ts
  const [sets, setSets] = useState<SetMeta[]>([]);
  // read by AI callbacks that finish after later renders
  const setsRef = useRef<SetMeta[]>([]);
  setsRef.current = sets;
  const [setAi, setSetAi] = useState<Record<string, "sorting" | "sorted" | "failed">>({});
  const [setDetails, setSetDetails] = useState<Record<string, SetDetails>>({});
```

(e) In `addPhotos`, replace
```ts
        setFields = {
          setGroupId: setTarget.id,
          setRole: role,
          setDivision: division,
          setSubDivision: subDivision,
          // Parent = the set category picked on the form; parts choose their own.
          setMajorCategory: role === "PARENT" ? majorCategory : "",
        };
```
with
```ts
        const meta = sets.find((s) => s.id === setTarget.id);
        const setCat = meta ? setCatOf(meta) : { division, subDivision, majorCategory };
        setFields = {
          setGroupId: setTarget.id,
          setRole: role,
          setDivision: setCat.division,
          setSubDivision: setCat.subDivision,
          // Parent = this set's own category; parts choose their own.
          setMajorCategory: role === "PARENT" ? setCat.majorCategory : "",
        };
```

(f) Replace `updateDesign` with:
```ts
  const updateDesign = (id: string, patch: Partial<DesignRow>) => {
    setDesigns((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...markTouched(d, patch) } : d))
    );
  };
```

(g) Replace the whole `addSet` function with:
```ts
  const addSet = () => {
    setSets((prev) => [...prev, newSetMeta(newSetId(), { division, subDivision, majorCategory })]);
  };

  /** Ask the AI to sort one set (roles, part categories, the set's category). Never throws. */
  const sortSet = async (setId: string, rows: DesignRow[]) => {
    const meta = setsRef.current.find((s) => s.id === setId);
    if (!meta || !meta.majorCategory) return;
    const label = meta.name.trim() || "A set";
    setSetAi((prev) => ({ ...prev, [setId]: "sorting" }));
    try {
      const mine = rows.filter((d) => d.setGroupId === setId).slice(0, 8);
      const thumbs = await Promise.all(mine.map((r) => makeThumbnail(r.file)));
      const images = mine.flatMap((r, i) => (thumbs[i] ? [{ key: r.id, ...thumbs[i]! }] : []));
      if (images.length < 2) throw new Error("fewer than 2 readable photos");
      const res = await classifySet({ setCategory: meta.majorCategory, division: meta.division, images });
      const now = setsRef.current.find((s) => s.id === setId);
      if (!now) return; // removed while sorting
      const next = applySetPick(now, res.set);
      setsRef.current = setsRef.current.map((s) => (s.id === setId ? next : s));
      setSets((prev) => prev.map((s) => (s.id === setId ? applySetPick(s, res.set) : s)));
      setDesigns((prev) => applyClassification(prev, setId, now.folder, res.items, setCatOf(next)));
      setSetAi((prev) => ({ ...prev, [setId]: "sorted" }));
      setTimeout(
        () =>
          setSetAi((prev) => {
            if (prev[setId] !== "sorted") return prev;
            const rest = { ...prev };
            delete rest[setId];
            return rest;
          }),
        3000,
      );
    } catch {
      setSetAi((prev) => ({ ...prev, [setId]: "failed" }));
      toast.error(`${label}: AI couldn't sort the photos. Set the roles by hand.`);
    }
  };

  /** Bulk add: one set per sub-folder, then the AI sorts each set. */
  const addFolderSets = async (groups: FolderGroup[]) => {
    const top = { division, subDivision, majorCategory };
    let next = [...designs];
    // the empty starter set (no photos, no name) gives way to the folders
    const nextSets = sets.filter((s) => s.name.trim() || next.some((d) => d.setGroupId === s.id));
    const created: { setId: string; count: number }[] = [];
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
            setDivision: top.division,
            setSubDivision: top.subDivision,
            setMajorCategory: role === "PARENT" ? top.majorCategory : "",
            partKind: role === "TOP" ? "TOP" : role === "PIECE" ? "OTHER" : undefined,
          }),
        );
      }
      if (!rows.length) continue;
      next = renumberSet(next.concat(rows), setId, g.folder);
      nextSets.push(newSetMeta(setId, top, g.folder));
      created.push({ setId, count: rows.length });
    }
    if (skipped > 0)
      toast.warning(`Skipped ${skipped} photo(s): the ${MAX_PHOTOS}-photo limit was reached or the file couldn't be used.`);
    if (compressed > 0) toast.info(`${compressed} photo(s) were auto-compressed to fit the 20 MB limit.`);
    if (!created.length) return;
    setsRef.current = nextSets;
    setSets(nextSets);
    setDesigns(next);
    toast.success(`Added ${created.length} set(s). AI is sorting the photos…`);
    await runPool(
      created.filter((c) => c.count >= 2),
      3,
      (c) => sortSet(c.setId, next),
    );
  };

  /** The uploader picked (or cleared) a set's category. */
  const changeSetCategory = (setId: string, cat: SetCat) => {
    const s = sets.find((x) => x.id === setId);
    if (!s) return;
    const nextSets = sets.map((x) => (x.id === setId ? pickSetCategory(x, cat) : x));
    setsRef.current = nextSets;
    setSets(nextSets);
    const divChanged = !!cat.division && cat.division !== s.division;
    let rows = normaliseSetRoles(designs, setId, cat);
    if (divChanged) rows = resetPartCategories(rows, setId, cat.division);
    setDesigns(rows);
    if (divChanged && cat.majorCategory && rows.filter((d) => d.setGroupId === setId).length >= 2) {
      void sortSet(setId, rows);
    }
  };

  const confirmSetCategory = (setId: string) =>
    setSets((prev) => prev.map((x) => (x.id === setId ? { ...x, catConfirmed: true } : x)));

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

(h) Replace `catOf` with:
```ts
  /** Division / sub-division / category that applies to one design (a set photo carries its own). */
  const catOf = (d: DesignRow) =>
    d.setGroupId
      ? {
          division: d.setDivision ?? "",
          subDivision: d.setSubDivision ?? "",
          majorCategory: d.setMajorCategory ?? "",
        }
      : { division, subDivision, majorCategory };
```

(i) Replace the effect under the comment `// Changing the set's division / sub-division re-seeds parts that haven't` (both comment lines and the whole `useEffect`) with:
```ts
  // Changing the top category moves the sets still on the default (and their
  // parents, plus parts with no category yet). AI- or hand-picked sets keep theirs.
  useEffect(() => {
    if (!setMode) return;
    const followers = new Set(sets.filter((s) => s.catSource === "default").map((s) => s.id));
    setSets((prev) => followTopCategory(prev, { division, subDivision, majorCategory }));
    setDesigns((prev) =>
      prev.map((d) =>
        !d.setGroupId || !followers.has(d.setGroupId)
          ? d
          : d.setRole === "PARENT"
            ? { ...d, setDivision: division, setSubDivision: subDivision, setMajorCategory: majorCategory }
            : d.setMajorCategory
              ? d
              : { ...d, setDivision: division, setSubDivision: subDivision },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMode, division, subDivision, majorCategory]);
```

(j) In submit, directly after the line `if (setMode) {` that starts the block `// Set mode: every set needs its whole-set photo and at least one part.`, add:
```ts
      const unchecked = setsNeedingCategory(sets);
      if (unchecked.length) {
        toast.error(`Choose or confirm the set category of: ${unchecked.join(", ")}`, { duration: 10000 });
        return;
      }
```

(k) Set-mode JSX:
- As the first child of `<div className="space-y-4">` that wraps `{sets.map((s, si) => {`, add `<SetFolderDropzone disabled={submitting} onFolders={addFolderSets} />`.
- On `<SetArticleCard`: change `categoryLabel={majorCategory}` to `categoryLabel={s.majorCategory}` and add:
```tsx
                          aiStatus={setAi[s.id]}
                          categoryCheck={s.catSource === "ai" && !s.catConfirmed}
                          onConfirmCategory={() => confirmSetCategory(s.id)}
                          categoryNode={
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Set Major Category <span className="text-destructive">*</span>
                              </Label>
                              <DivisionCascadeSelect
                                division={s.division}
                                subDivision={s.subDivision}
                                majorCategory={s.majorCategory}
                                onChange={(n) => changeSetCategory(s.id, n)}
                                disabled={submitting}
                                filterCategory={isSetCategory}
                              />
                            </div>
                          }
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
- Replace `{division} › {subDivision} › {majorCategory} (fixed)` with `{s.division} › {s.subDivision} › {s.majorCategory}`.
- In the part header, replace the role `<Select ... onValueChange={(v) => updateDesign(d.id, { setRole: v as SetRole })}` handler with `onValueChange={(v) => setDesigns((prev) => setPartRole(prev, d.id, v as "TOP" | "PIECE", setCatOf(s), s.folder))}`, and after the closing `</div>` of `<div className="w-40">` add:
```tsx
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={submitting}
                                  onClick={() => setDesigns((prev) => makeWholeSet(prev, d.id, setCatOf(s), s.folder))}
                                >
                                  Make whole set
                                </Button>
```

- [ ] **Step 3: Verify build and tests** — Lovable runs `npm run type-check` and `npx vitest run`: no type errors, all tests pass.
- [ ] **Step 4: Commit check** — `get_diff` for both messages: only the listed regions changed; the upload / insert / `sync` / R2 code in submit is untouched.
- [ ] **Step 5: Smoke check on preview** — pick L_KURTI_ST: the drop zone shows above "Set 1"; Set 1 shows a "Set Major Category" picker listing only set categories; the manual "Choose whole-set photo" / "Add part" buttons still work; a normal (non-set) category shows the normal form.

---

### Task 5: End-to-end verification on preview (spec §4)

**Files:** none (plus the handover note in Step 7)

Test data from the owner: folder `PRES-TEST` with sub-folders `KS-T1`, `KS-T2` (Ladies kurti sets: whole set + kurti + plazo + dupatta) and `CO-T1` (Ladies co-ord set: whole set + top + bottom).

- [ ] **Step 1:** Preview → New Presentation → internal upload, category L_KURTI_ST → drop `PRES-TEST`. Expected: 3 set cards `CO-T1`, `KS-T1`, `KS-T2`; chips "AI sorting…" then "AI sorted"; `CO-T1` shows L_CO-ORD_SET with "AI picked — check"; kurti sets stay L_KURTI_ST without the chip; in each set the whole-set photo is the parent and the kurti/top is Top; numbers like `KS-T1`, `KS-T1-T`, `KS-T1-B`, `KS-T1-D`.
- [ ] **Step 2:** Fill Approved By, each set's strip (Apply to parts), price + weight per part. Submit → blocked: "Choose or confirm the set category of: CO-T1". Click ✓ Correct → submit succeeds with one PRES number.
- [ ] **Step 3:** New upload, drop the same folder, then change the top category to LW_KURTI_ST → only sets still on the default move; `CO-T1` keeps its category.
- [ ] **Step 4:** Change `KS-T2`'s set category to a KIDS set category (e.g. JB_KURTA_ST) → its untouched part categories clear, "AI sorting…" runs again, parts get KIDS categories; a part whose category was picked by hand keeps it. Discard the upload.
- [ ] **Step 5:** Read-only SRM check (Supabase `pymdqnnwwxrgeolvgvgv`):
```sql
SELECT i.set_name, i.set_role, i.major_category, i.design_number
FROM srm_presentation_images i JOIN srm_presentations p ON p.id = i.presentation_id
WHERE p.ref_no = '<PRES from Step 2>'
ORDER BY i.set_name, i.set_role;
```
Expected: per set 1 PARENT with that set's own category (CO-T1 → L_CO-ORD_SET, KS-* → L_KURTI_ST), 1 TOP, the rest PIECE.
- [ ] **Step 6:** Read-only MDM check (Supabase `hgdftqswlvkspzjtlrll`), after a minute:
```sql
SELECT set_name, set_role, major_category, COUNT(*) AS photos
FROM raw_articles WHERE presentation_no = '<PRES from Step 2>'
GROUP BY set_name, set_role, major_category ORDER BY set_name, set_role;
```
Expected: same sets / roles / categories as Step 5. Do not write to either DB.
- [ ] **Step 7:** Regression: a manual set (Add another set, pick photos by hand) and a normal non-set upload both still submit. Update `HANDOVER-SET-ARTICLE.md` (In progress): folder upload built on preview, test PRES number, anything that failed. Do not publish.
