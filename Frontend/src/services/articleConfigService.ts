/**
 * articleConfigService.ts
 *
 * Fetches SAP field configs and the grids (major-category, mandatory, national,
 * GM, segment) from the backend, with in-memory caches so components can read
 * them synchronously after a preload.
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

// ─── Cache ────────────────────────────────────────────────────────────────────

let fieldsCache: SapFieldConfig[] | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function preloadFieldConfigs(): Promise<SapFieldConfig[]> {
  if (fieldsCache) return fieldsCache;
  const { data } = await api.get<{ data: SapFieldConfig[] }>('/fields');
  fieldsCache = data.data;
  return fieldsCache;
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

/** True when the loaded grid has at least one attribute for this major category. */
export function hasMajCatGridData(majorCategory: string): boolean {
  const catData = majCatGrid[majorCategory];
  return !!catData && Object.keys(catData).length > 0;
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

// ─── National Grid (from national_grid_master) ───────────────────────────────

/** { M_YARN: [{ code, fullForm }], M_NECK_TYPE: [...], ... } — not category-specific. */
export type NationalGridValues = Record<string, { code: string; fullForm: string }[]>;

let nationalGridPromise: Promise<NationalGridValues> | null = null;

/** Fetch the national grid once per session; a failed fetch is retried on the next call. */
export function preloadNationalGrid(): Promise<NationalGridValues> {
  if (!nationalGridPromise) {
    nationalGridPromise = fetch(`${gridBaseURL()}/approver/national-grid-values`, { headers: authHeader() })
      .then(r => (r.ok ? r.json() : null))
      .then(json => (json?.data as NationalGridValues) ?? {})
      .catch(() => {
        nationalGridPromise = null;
        return {} as NationalGridValues;
      });
  }
  return nationalGridPromise;
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

// ─── GM Article Description Format (from gm_article_description_formate) ─────

export interface GmDescFormatRow {
  familyCode: string;
  familyName: string;
  descSeq: string;
}

const gmDescFormatCache = new Map<string, GmDescFormatRow[]>();
const gmDescFormatPending = new Map<string, Promise<GmDescFormatRow[]>>();

/**
 * Fetch and cache the ordered description format for a GM major category.
 * Returns rows ordered by desc_seq (numeric), only those with a sequence number.
 */
export async function preloadGMDescFormatFor(majorCategory: string): Promise<GmDescFormatRow[]> {
  const key = (majorCategory || '').trim().toUpperCase();
  if (!key) return [];
  if (gmDescFormatCache.has(key)) return gmDescFormatCache.get(key)!;
  if (gmDescFormatPending.has(key)) return gmDescFormatPending.get(key)!;

  const p = fetch(
    `${gridBaseURL()}/approver/gm-description-format?majorCategory=${encodeURIComponent(majorCategory)}`,
    { headers: authHeader() },
  )
    .then(r => (r.ok ? r.json() : { format: [] }))
    .then(json => {
      const rows: GmDescFormatRow[] = (json.format ?? []).map((f: any) => ({
        familyCode: f.familyCode,
        familyName: f.familyName,
        descSeq:    f.descSeq,
      }));
      gmDescFormatCache.set(key, rows);
      return rows;
    })
    .catch(() => [] as GmDescFormatRow[])
    .finally(() => gmDescFormatPending.delete(key));

  gmDescFormatPending.set(key, p);
  return p;
}

/** Synchronous lookup — returns null if not yet loaded. */
export function getCachedGMDescFormat(majorCategory: string): GmDescFormatRow[] | null {
  return gmDescFormatCache.get((majorCategory || '').trim().toUpperCase()) ?? null;
}
