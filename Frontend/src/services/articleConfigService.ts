/**
 * articleConfigService.ts
 *
 * Fetches SAP field configs and attribute values from the backend DB.
 * Values are scoped by division (MENS | LADIES | KIDS) from the National Grid.
 * In-memory cache so components can call getCachedValues() synchronously after preload.
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

const api = axios.create({ baseURL: `${API_BASE_URL}/article-config` });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SapFieldConfig {
  id: number;
  section: string;
  uiLabel: string;
  dbField: string;
  sapField: string;
  displayOrder: number;
}

// Normalise any division string to MENS | LADIES | KIDS
function normaliseDivision(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (u.startsWith('MEN')) return 'MENS';
  if (u.startsWith('LAD') || u.startsWith('WOM')) return 'LADIES';
  if (u.startsWith('KID') || u.startsWith('JUN') || u.startsWith('BOY') || u.startsWith('GIR')) return 'KIDS';
  return u; // pass-through
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const valuesCache = new Map<string, Record<string, string[]>>();
let fieldsCache: SapFieldConfig[] | null = null;
const pendingLoads = new Map<string, Promise<void>>();

// ─── Public API ───────────────────────────────────────────────────────────────

export async function preloadFieldConfigs(): Promise<SapFieldConfig[]> {
  if (fieldsCache) return fieldsCache;
  const { data } = await api.get<{ data: SapFieldConfig[] }>('/fields');
  fieldsCache = data.data;
  return fieldsCache;
}

/**
 * Preload allowed values for a division (MENS | LADIES | KIDS).
 * Also accepts a full division name like "MENS TOPWEAR" — normalised automatically.
 * Safe to call multiple times — deduplicates in-flight requests.
 */
export async function preloadAttributeValues(divisionOrCategory: string): Promise<void> {
  const division = normaliseDivision(divisionOrCategory);
  if (valuesCache.has(division)) return;
  if (pendingLoads.has(division)) return pendingLoads.get(division)!;

  const load = api
    .get<{ data: Record<string, string[]> }>(`/values?division=${encodeURIComponent(division)}`)
    .then(({ data }) => { valuesCache.set(division, data.data); })
    .finally(() => pendingLoads.delete(division));

  pendingLoads.set(division, load);
  return load;
}

/**
 * Synchronous lookup — returns values from cache.
 * divisionOrCategory is normalised automatically.
 * Call preloadAttributeValues(division) first; returns null if not yet loaded.
 */
export function getCachedValues(
  divisionOrCategory: string,
  dbField: string
): string[] | null {
  const division = normaliseDivision(divisionOrCategory);
  const catData = valuesCache.get(division);
  if (!catData) return null;
  return catData[dbField] ?? null;
}

export function isValuesCached(divisionOrCategory: string): boolean {
  return valuesCache.has(normaliseDivision(divisionOrCategory));
}

export function invalidateValuesCache(divisionOrCategory?: string): void {
  if (divisionOrCategory) {
    const division = normaliseDivision(divisionOrCategory);
    valuesCache.delete(division);
    pendingLoads.delete(division);
  } else {
    valuesCache.clear();
    pendingLoads.clear();
  }
}

export function getCachedFieldConfigs(): SapFieldConfig[] | null {
  return fieldsCache;
}

export function buildDbToSapMap(): Record<string, string> {
  if (!fieldsCache) return {};
  return Object.fromEntries(fieldsCache.map((f) => [f.dbField, f.sapField]));
}

export function buildUiLabelToDbFieldMap(): Record<string, string> {
  if (!fieldsCache) return {};
  return Object.fromEntries(fieldsCache.map((f) => [f.uiLabel, f.dbField]));
}

// ─── Attribute Groups (for dynamic article card layout) ───────────────────────

export interface AttributeGroupEntry {
  key: string;
  type: 'TEXT' | 'SELECT' | 'NUMBER';
  group: string;
}

let attributeGroupsCache: AttributeGroupEntry[] | null = null;
let attributeGroupsPromise: Promise<AttributeGroupEntry[]> | null = null;

export async function preloadAttributeGroups(): Promise<AttributeGroupEntry[]> {
  if (attributeGroupsCache) return attributeGroupsCache;
  if (attributeGroupsPromise) return attributeGroupsPromise;

  const baseURL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
  const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');

  attributeGroupsPromise = fetch(`${baseURL}/admin/attributes`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(r => r.ok ? r.json() : null)
    .then(json => {
      const attrs: AttributeGroupEntry[] = (json?.data ?? [])
        .filter((a: any) => a.group && a.isActive)
        .map((a: any) => ({ key: a.key, type: a.type, group: a.group }));
      attributeGroupsCache = attrs;
      return attrs;
    })
    .catch(() => [] as AttributeGroupEntry[])
    .finally(() => { attributeGroupsPromise = null; });

  return attributeGroupsPromise;
}

export function getCachedAttributeGroups(): AttributeGroupEntry[] | null {
  return attributeGroupsCache;
}

// ─── Per-category enabled/required attribute config ───────────────────────────

export interface CategoryAttrConfig {
  configured: boolean;      // false = no mappings yet, show all (fallback)
  enabled: Set<string>;     // schema keys that are enabled
  required: Set<string>;    // schema keys that are required
}

const CATEGORY_ATTR_TTL_MS = 3 * 60 * 1000; // 3 minutes
const categoryAttrCache = new Map<string, { config: CategoryAttrConfig; ts: number }>();
const categoryAttrPending = new Map<string, Promise<CategoryAttrConfig>>();

export async function preloadCategoryAttributes(categoryCode: string): Promise<CategoryAttrConfig> {
  const cached = categoryAttrCache.get(categoryCode);
  if (cached && Date.now() - cached.ts < CATEGORY_ATTR_TTL_MS) return cached.config;
  if (categoryAttrPending.has(categoryCode)) return categoryAttrPending.get(categoryCode)!;

  const baseURL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
  const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');

  const p = fetch(`${baseURL}/article-config/category-attributes/${encodeURIComponent(categoryCode)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(r => r.ok ? r.json() : null)
    .then((json): CategoryAttrConfig => {
      if (!json?.success) return { configured: false, enabled: new Set(), required: new Set() };
      const result: CategoryAttrConfig = {
        configured: json.configured,
        enabled: new Set<string>(json.enabled ?? []),
        required: new Set<string>(json.required ?? []),
      };
      categoryAttrCache.set(categoryCode, { config: result, ts: Date.now() });
      return result;
    })
    .catch((): CategoryAttrConfig => ({ configured: false, enabled: new Set(), required: new Set() }))
    .finally(() => categoryAttrPending.delete(categoryCode));

  categoryAttrPending.set(categoryCode, p);
  return p;
}

export function getCachedCategoryAttributes(categoryCode: string): CategoryAttrConfig | null {
  const cached = categoryAttrCache.get(categoryCode);
  if (!cached) return null;
  if (Date.now() - cached.ts >= CATEGORY_ATTR_TTL_MS) {
    categoryAttrCache.delete(categoryCode);
    return null;
  }
  return cached.config;
}

export function invalidateCategoryAttributeCache(categoryCode?: string) {
  if (categoryCode) categoryAttrCache.delete(categoryCode);
  else categoryAttrCache.clear();
}

// ─── Major-Category Grid Values (from uploaded Excel) ─────────────────────────
// Structure: { [majorCategory]: { [excelAttrName]: string[] } }
// e.g.  { "L_PLAZO": { "M_FAB_DIV": ["K","W","DNM"], ... }, ... }

type MajCatGrid = Record<string, Record<string, string[]>>;

// Merged store of grid values, populated either fully (preloadMajCatGrid) or
// one major category at a time (preloadMajCatGridFor). Starts as an empty
// object so synchronous lookups never crash.
const majCatGrid: MajCatGrid = {};
let fullGridLoaded = false;
let majCatGridPromise: Promise<MajCatGrid> | null = null;

// Per-major-category load tracking, so the article card only pulls the grid for
// the category it is showing (not the entire maj_cat_grid_values table).
const loadedCats = new Set<string>();                 // UPPER(category) → loaded
const inflightCats = new Map<string, Promise<void>>(); // UPPER(category) → in-flight fetch

const catKey = (c: string) => (c || '').trim().toUpperCase();

function gridBaseURL(): string {
  return import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
}
function authHeader(): Record<string, string> {
  const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetch the grid for a SINGLE major category and merge it into the store.
 * This is what the article card uses — it avoids downloading the whole grid.
 * Safe to call repeatedly: cached per category + de-duped while in flight.
 */
export async function preloadMajCatGridFor(majorCategory: string): Promise<void> {
  const cat = (majorCategory || '').trim();
  if (!cat) return;
  const key = catKey(cat);
  if (fullGridLoaded || loadedCats.has(key)) return;
  const existing = inflightCats.get(key);
  if (existing) return existing;

  const p = fetch(`${gridBaseURL()}/article-config/majcat-grid?majorCategory=${encodeURIComponent(cat)}`, {
    headers: authHeader(),
  })
    .then(r => (r.ok ? r.json() : { data: {} }))
    .then(json => {
      const data = (json?.data as MajCatGrid) ?? {};
      // Merge this category's entry (data is keyed by the actual major_category).
      Object.assign(majCatGrid, data);
      loadedCats.add(key); // mark loaded even if empty, so we don't refetch
    })
    .catch(() => {
      loadedCats.add(key); // treat failure as "no grid" — don't loop
    })
    .finally(() => { inflightCats.delete(key); });

  inflightCats.set(key, p);
  return p;
}

/** True once the grid for this specific major category has been loaded. */
export function isMajCatGridLoadedFor(majorCategory: string): boolean {
  return fullGridLoaded || loadedCats.has(catKey(majorCategory));
}

/**
 * Fetch the FULL major-category grid (all categories) — used by admin pages.
 * The article card should use preloadMajCatGridFor() instead.
 */
export async function preloadMajCatGrid(): Promise<MajCatGrid> {
  if (fullGridLoaded) return majCatGrid;
  if (majCatGridPromise) return majCatGridPromise;

  majCatGridPromise = fetch(`${gridBaseURL()}/article-config/majcat-grid`, {
    headers: authHeader(),
  })
    .then(r => (r.ok ? r.json() : { data: {} }))
    .then(json => {
      Object.assign(majCatGrid, (json?.data as MajCatGrid) ?? {});
      fullGridLoaded = true;
      return majCatGrid;
    })
    .catch(() => {
      fullGridLoaded = true;
      return majCatGrid;
    })
    .finally(() => { majCatGridPromise = null; });

  return majCatGridPromise;
}

/**
 * Synchronous lookup — returns allowed values for a major category + Excel attribute name.
 * Returns null if that category's grid isn't loaded or no entry found.
 * Call preloadMajCatGridFor(majorCategory) first.
 */
export function getMajCatGridEntry(majorCategory: string, excelAttrName: string): string[] | null {
  const catData = majCatGrid[majorCategory];
  if (!catData) return null;
  return catData[excelAttrName] ?? null;
}

/** True once the FULL grid has been loaded (admin use). */
export function isMajCatGridLoaded(): boolean {
  return fullGridLoaded;
}

/** Returns true if the major category has ANY rows in the loaded maj-cat grid. */
export function isMajCatInGrid(majorCategory: string): boolean {
  return majorCategory in majCatGrid;
}

export function invalidateMajCatGrid(): void {
  for (const k of Object.keys(majCatGrid)) delete majCatGrid[k];
  fullGridLoaded = false;
  majCatGridPromise = null;
  loadedCats.clear();
  inflightCats.clear();
}

// ─── Mandatory Grid (from uploaded mandatory Excel) ────────────────────────────
// Structure: { [majorCategory]: { [sapKey]: { isActive: boolean; label: string | null } } }
// e.g.  { "MW_TEES_FS": { "M_FAB": { isActive: true, label: "WEAVE-01" }, ... }, ... }

type MandatoryGridEntry = { isActive: boolean; label: string | null };
type MandatoryGrid = Record<string, Record<string, MandatoryGridEntry>>;

// Merged store, populated either fully or one major category at a time.
const mandatoryGrid: MandatoryGrid = {};
let fullMandatoryLoaded = false;
let mandatoryGridPromise: Promise<MandatoryGrid> | null = null;
const loadedMandatoryCats = new Set<string>();
const inflightMandatoryCats = new Map<string, Promise<void>>();

/**
 * Fetch the mandatory grid for a SINGLE major category and merge it in.
 * Used by the article card so it doesn't pull the whole maj_cat_mandatory_grid.
 * Cached per category + de-duped while in flight.
 */
export async function preloadMandatoryGridFor(majorCategory: string): Promise<void> {
  const cat = (majorCategory || '').trim();
  if (!cat) return;
  const key = catKey(cat);
  if (fullMandatoryLoaded || loadedMandatoryCats.has(key)) return;
  const existing = inflightMandatoryCats.get(key);
  if (existing) return existing;

  const p = fetch(`${gridBaseURL()}/article-config/mandatory-grid?majorCategory=${encodeURIComponent(cat)}`, {
    headers: authHeader(),
  })
    .then(r => (r.ok ? r.json() : { data: {} }))
    .then(json => {
      Object.assign(mandatoryGrid, (json?.data as MandatoryGrid) ?? {});
      loadedMandatoryCats.add(key);
    })
    .catch(() => { loadedMandatoryCats.add(key); })
    .finally(() => { inflightMandatoryCats.delete(key); });

  inflightMandatoryCats.set(key, p);
  return p;
}

/** True once the mandatory grid for this specific major category has loaded. */
export function isMandatoryGridLoadedFor(majorCategory: string): boolean {
  return fullMandatoryLoaded || loadedMandatoryCats.has(catKey(majorCategory));
}

/**
 * Fetch the FULL mandatory grid (all categories) — admin use / back-compat.
 */
export async function preloadMandatoryGrid(): Promise<MandatoryGrid> {
  if (fullMandatoryLoaded) return mandatoryGrid;
  if (mandatoryGridPromise) return mandatoryGridPromise;

  mandatoryGridPromise = fetch(`${gridBaseURL()}/article-config/mandatory-grid`, {
    headers: authHeader(),
  })
    .then(r => (r.ok ? r.json() : { data: {} }))
    .then(json => {
      Object.assign(mandatoryGrid, (json?.data as MandatoryGrid) ?? {});
      fullMandatoryLoaded = true;
      return mandatoryGrid;
    })
    .catch(() => {
      fullMandatoryLoaded = true;
      return mandatoryGrid;
    })
    .finally(() => { mandatoryGridPromise = null; });

  return mandatoryGridPromise;
}

/**
 * Synchronous check — is a SAP key active (visible) for a major category?
 * Returns true if active, false if inactive, null if grid not loaded or category not found.
 *
 * Two-pass lookup:
 *  1. Direct sap_key match  (fast path — the normal case)
 *  2. Label match fallback  — handles Excel uploads where the column header (sap_key)
 *     and the display label (row 4 text) differ.
 *     Example: sap_key=M_EMBROIDERY, label=M_EMBROIDERY_STYLE → looking up
 *     'M_EMBROIDERY_STYLE' now correctly finds the entry via its label.
 */
export function isMandatoryGridFieldActive(majorCategory: string, sapKey: string): boolean | null {
  const catData = mandatoryGrid[majorCategory];
  if (!catData) return null;

  // Pass 1: direct sap_key lookup
  const entry = catData[sapKey];
  if (entry) return entry.isActive;

  // Pass 2: label fallback — find any entry whose label equals the requested sapKey
  const byLabel = Object.values(catData).find(e => e.label === sapKey);
  if (byLabel) return byLabel.isActive;

  return null;
}

/**
 * Returns the human-readable label for a SAP key from the mandatory grid
 * (Row 4 of the uploaded Excel). Returns null if not found.
 * The label is the same across all major categories — we just pick the first one found.
 */
export function getMandatoryGridFieldLabel(sapKey: string): string | null {
  for (const catData of Object.values(mandatoryGrid)) {
    const entry = catData[sapKey];
    if (entry?.label) return entry.label;
  }
  return null;
}

/** True once the FULL mandatory grid has been loaded (admin use). */
export function isMandatoryGridLoaded(): boolean {
  return fullMandatoryLoaded;
}

/** Returns true if the major category has ANY rows in the loaded mandatory grid. */
export function isMajCatInMandatoryGrid(majorCategory: string): boolean {
  return majorCategory in mandatoryGrid;
}

export function invalidateMandatoryGrid(): void {
  for (const k of Object.keys(mandatoryGrid)) delete mandatoryGrid[k];
  fullMandatoryLoaded = false;
  mandatoryGridPromise = null;
  loadedMandatoryCats.clear();
  inflightMandatoryCats.clear();
}

// ─── GM Major Category Grid Values (from gm_major_category_grid_values) ────────

export interface GmGridAttr {
  familyCode: string;
  familyName: string;
  mandatory: boolean;
  values: string[];
}

const gmGridCache = new Map<string, GmGridAttr[]>();
const gmGridPending = new Map<string, Promise<GmGridAttr[]>>();

/**
 * Fetch and cache GM attribute grid values for a major category.
 * Returns { familyCode, familyName, mandatory, values[] } per attribute.
 */
export async function preloadGMGridFor(majorCategory: string): Promise<GmGridAttr[]> {
  const key = (majorCategory || '').trim().toUpperCase();
  if (!key) return [];
  if (gmGridCache.has(key)) return gmGridCache.get(key)!;
  if (gmGridPending.has(key)) return gmGridPending.get(key)!;

  const p = fetch(
    `${gridBaseURL()}/approver/gm-grid-values?majorCategory=${encodeURIComponent(majorCategory)}`,
    { headers: authHeader() },
  )
    .then(r => (r.ok ? r.json() : { data: [] }))
    .then(json => {
      const attrs: GmGridAttr[] = (json.data ?? []).map((entry: any) => ({
        familyCode: entry.familyCode,
        familyName: entry.familyName ?? entry.familyCode,
        mandatory: !!entry.mandatory,
        values: entry.values ?? [],
      }));
      gmGridCache.set(key, attrs);
      return attrs;
    })
    .catch(() => [] as GmGridAttr[])
    .finally(() => gmGridPending.delete(key));

  gmGridPending.set(key, p);
  return p;
}

/** Synchronous lookup — returns null if not yet loaded. */
export function getCachedGMGrid(majorCategory: string): GmGridAttr[] | null {
  return gmGridCache.get((majorCategory || '').trim().toUpperCase()) ?? null;
}

export function invalidateGMGrid(): void {
  gmGridCache.clear();
  gmGridPending.clear();
}
