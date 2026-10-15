import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import { APP_CONFIG } from '../../../constants/app/config';
import type { MasterAttribute } from './GMArticleTable';

// ─── Add Color Variants — GM Article pages (design "Option A · 3-step wizard") ──
// 1 · Colors  → pick one or more colors (searchable list)
// 2 · Sizes   → per color, every size is ticked by default; untick what you don't need
// 3 · Images  → one image per color, applied to all of its sizes
// Submits { colors, sizesByColor, colorImages }:
//   source 'gm'   → gm_variants_article_data (sizes from gm_size_master)   — GM Article pages
//   source 'flat' → FG flat variants (sizes from maj_cat_sizes) via /items/:id/add-color

const FALLBACK_COLORS = ['BLACK', 'WHITE', 'RED', 'NAVY', 'GREY', 'BLUE', 'GREEN'];
const STEPS = ['Colors', 'Sizes', 'Images'] as const;

interface GMAddColorModalProps {
  open: boolean;
  genericId: string;
  majorCategory: string;
  /** Existing (size, color) pairs already created, as `SIZE||COLOR` (upper-cased). */
  existingPairs: Set<string>;
  attributes: MasterAttribute[];
  onClose: () => void;
  onAdded: () => void;
  /** Which variant table to write to; defaults to the GM table. */
  source?: 'gm' | 'flat';
}

type ColorOption = { value: string; label: string };

const pairKey = (size: string, color: string) => `${size.trim().toUpperCase()}||${color.trim().toUpperCase()}`;

const GMAddColorModal: React.FC<GMAddColorModalProps> = ({
  open,
  genericId,
  majorCategory,
  existingPairs,
  attributes,
  onClose,
  onAdded,
  source = 'gm',
}) => {
  const sizesPath = source === 'gm' ? 'gm-sizes-for-majcat' : 'sizes-for-majcat';
  const submitPath = source === 'gm' ? `gm-articles/${genericId}/variants` : `items/${genericId}/add-color`;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [search, setSearch] = useState('');
  const [masterColors, setMasterColors] = useState<{ code: string; name: string }[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  // color → sizes the user unticked (everything else is ticked by default)
  const [untickedSizes, setUntickedSizes] = useState<Record<string, string[]>>({});
  const [colorImages, setColorImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setSearch('');
      setSelectedColors([]);
      setUntickedSizes({});
      setColorImages({});
      setUploading({});
      return;
    }
    const token = localStorage.getItem('authToken');
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    fetch(`${APP_CONFIG.api.baseURL}/approver/colors`, { headers })
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => setMasterColors(Array.isArray(d?.colors) ? d.colors : []))
      .catch(() => setMasterColors([]));
    if (majorCategory) {
      fetch(`${APP_CONFIG.api.baseURL}/approver/${sizesPath}/${encodeURIComponent(majorCategory)}`, { headers })
        .then((r) => (r.ok ? r.json() : { sizes: [] }))
        .then((d) => setSizes(Array.isArray(d?.sizes) ? d.sizes : []))
        .catch(() => setSizes([]));
    } else {
      setSizes([]);
    }
  }, [open, majorCategory, sizesPath]);

  // Colors from color_master (value = SAP code, label = "NAME - CODE"); falls back
  // to the COLOR attribute, then a short hardcoded list.
  const options: ColorOption[] = useMemo(() => {
    if (masterColors.length > 0) return masterColors.map((c) => ({ value: c.code, label: `${c.name} - ${c.code}` }));
    const colorAttr = attributes.find((a) => ['COLOR', 'COLOUR'].includes(a.key.toUpperCase()) || ['COLOR', 'COLOUR'].includes(a.label.toUpperCase()));
    const base = colorAttr && colorAttr.allowedValues.length > 0
      ? colorAttr.allowedValues.map((v) => ({ code: v.shortForm, label: v.fullForm }))
      : FALLBACK_COLORS.map((c) => ({ code: c, label: c }));
    return base.map(({ code, label }) => ({ value: code, label: label !== code ? `${code} — ${label}` : code }));
  }, [masterColors, attributes]);

  const labelOf = (code: string) => options.find((o) => o.value === code)?.label ?? code;
  const sizeExists = (size: string, color: string) => existingPairs.has(pairKey(size, color));
  // A color is only blocked once every size of it already exists.
  const colorFullyAdded = (color: string) => sizes.length > 0 && sizes.every((s) => sizeExists(s, color));

  const sizesFor = (color: string) =>
    sizes.filter((s) => !sizeExists(s, color) && !(untickedSizes[color] ?? []).includes(s));
  const totalVariants = selectedColors.reduce((n, c) => n + sizesFor(c).length, 0);
  const colorWithoutSizes = selectedColors.find((c) => sizesFor(c).length === 0);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));

  const toggleColor = (code: string) =>
    setSelectedColors((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const toggleSize = (color: string, size: string) =>
    setUntickedSizes((prev) => {
      const off = prev[color] ?? [];
      return { ...prev, [color]: off.includes(size) ? off.filter((s) => s !== size) : [...off, size] };
    });

  const setAllSizes = (color: string, on: boolean) =>
    setUntickedSizes((prev) => ({ ...prev, [color]: on ? [] : [...sizes] }));

  const uploadColorImage = async (code: string, file: File) => {
    setUploading((u) => ({ ...u, [code]: true }));
    try {
      const token = localStorage.getItem('authToken');
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/upload-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!r.ok) throw new Error('Upload failed');
      const d = await r.json();
      setColorImages((m) => ({ ...m, [code]: d.url }));
    } catch {
      message.error(`Failed to upload image for ${code}`);
    } finally {
      setUploading((u) => ({ ...u, [code]: false }));
    }
  };

  const anyUploading = Object.values(uploading).some(Boolean);
  const allImagesReady = selectedColors.length > 0 && selectedColors.every((c) => !!colorImages[c]);

  const handleSubmit = async () => {
    if (!allImagesReady || colorWithoutSizes) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const sizesByColor = Object.fromEntries(selectedColors.map((c) => [c, sizesFor(c)]));
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/${submitPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ colors: selectedColors, sizesByColor, colorImages }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || payload?.error || 'Failed to add color variants');
      }
      const result = await response.json();
      message.success(`${result.count} variant${result.count !== 1 ? 's' : ''} created`);
      onAdded();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add colors');
    } finally {
      setSaving(false);
    }
  };

  const primaryBtn = 'h-10 bg-slate-800 px-5 font-semibold text-white hover:bg-slate-900';
  const outlineBtn = 'h-10 border-slate-300 px-4 font-semibold text-slate-800 hover:border-slate-800 hover:bg-slate-50';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[21px] font-semibold text-slate-900">Add color variants</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <ol className="m-0 flex list-none gap-2 p-0 text-xs font-semibold">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const reached = step >= n;
            return (
              <li
                key={label}
                className={cn('flex-1 border-t-[3px] pt-1.5', reached ? 'border-slate-800 text-slate-900' : 'border-slate-200 text-slate-500')}
              >
                {step > n ? `✓ ${label}` : `${n} · ${label}`}
              </li>
            );
          })}
        </ol>

        {/* Step 1 — colors */}
        {step === 1 && (
          <div className="flex flex-col gap-2.5">
            <label className="flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 px-3 text-slate-500 focus-within:border-slate-800">
              <Search className="h-4 w-4" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search colors…"
                aria-label="Search colors"
                className="flex-1 bg-transparent text-[13px] text-slate-900 outline-none"
              />
            </label>
            {selectedColors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedColors.map((c) => (
                  <span key={c} className="flex h-7 items-center gap-1.5 rounded-full bg-slate-800 pl-2.5 pr-1.5 text-xs font-semibold text-white">
                    {labelOf(c)}
                    <button type="button" aria-label={`Remove ${c}`} onClick={() => toggleColor(c)} className="text-slate-300 hover:text-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="max-h-[300px] overflow-y-auto rounded-[10px] border border-slate-200">
              {filtered.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-500">No colors match “{search}”.</div>}
              {filtered.map((o) => {
                const checked = selectedColors.includes(o.value);
                const blocked = colorFullyAdded(o.value);
                return (
                  <label
                    key={o.value}
                    className={cn(
                      'flex min-h-[40px] cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 text-[13px] last:border-b-0',
                      checked ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50',
                      blocked && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={blocked}
                      onChange={() => toggleColor(o.value)}
                      className="h-4 w-4 accent-slate-800"
                    />
                    <span className="flex-1">{o.label}</span>
                    {blocked && <span className="text-[11px] text-slate-500">already added</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2 — sizes (all ticked by default) */}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px] text-slate-600">All sizes are ticked. Untick any size you don't want for a color.</p>
            {sizes.length === 0 && (
              <div className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                No sizes are set up for {majorCategory || 'this major category'}. Add them in the {source === 'gm' ? 'GM Size Master' : 'Size Master'} (Admin).
              </div>
            )}
            <div className="flex max-h-[50vh] flex-col gap-2.5 overflow-y-auto">
              {selectedColors.map((color) => {
                const ticked = sizesFor(color).length;
                const available = sizes.filter((s) => !sizeExists(s, color)).length;
                return (
                  <div key={color} className="flex flex-col gap-2.5 rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-[13.5px] text-slate-900">{labelOf(color)}</b>
                      <span className="flex items-center gap-2.5 text-xs">
                        <span className={ticked === 0 ? 'font-semibold text-orange-700' : 'text-slate-600'}>
                          {ticked} of {available}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAllSizes(color, ticked < available)}
                          className="font-semibold text-slate-800 underline hover:text-slate-950"
                        >
                          {ticked < available ? 'Select all' : 'Clear all'}
                        </button>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {sizes.map((size) => {
                        const exists = sizeExists(size, color);
                        const on = !exists && !(untickedSizes[color] ?? []).includes(size);
                        return (
                          <button
                            key={size}
                            type="button"
                            disabled={exists}
                            aria-pressed={on}
                            title={exists ? 'Already created' : undefined}
                            onClick={() => toggleSize(color, size)}
                            className={cn(
                              'h-9 min-w-[52px] rounded-[9px] px-3 text-[13px] font-semibold transition-colors',
                              exists
                                ? 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400'
                                : on
                                ? 'border border-slate-800 bg-slate-800 text-white hover:bg-slate-900'
                                : 'border border-dashed border-slate-400 bg-white text-slate-500 line-through hover:border-slate-800',
                            )}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                    {ticked === 0 && <span className="text-[11.5px] text-orange-700">Tick at least one size, or remove this color.</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3 — one image per color */}
        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px] text-slate-600">Upload an image for each color. It's applied to all sizes of that color.</p>
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {selectedColors.map((code) => {
                const url = colorImages[code];
                const busy = uploading[code];
                return (
                  <div key={code} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {url ? (
                        <img src={url} alt={code} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-500">No image</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-slate-900">{labelOf(code)}</div>
                      <div className={cn('text-[11.5px]', busy ? 'text-slate-500' : url ? 'text-slate-700' : 'text-orange-700')}>
                        {busy ? 'Uploading…' : url ? (
                          <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> Image uploaded · {sizesFor(code).length} sizes</span>
                        ) : (
                          `Image required · ${sizesFor(code).length} sizes`
                        )}
                      </div>
                    </div>
                    <label className="shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-slate-800">
                      {url ? 'Replace' : 'Upload'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadColorImage(code, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-[12.5px] text-slate-600">
            {step === 1
              ? `${selectedColors.length} color${selectedColors.length !== 1 ? 's' : ''} selected`
              : <b className="text-slate-900">{totalVariants} variant{totalVariants !== 1 ? 's' : ''} will be created</b>}
          </span>
          <span className="flex gap-2">
            {step === 1 ? (
              <>
                <Button variant="outline" className={outlineBtn} onClick={onClose}>Cancel</Button>
                <Button className={primaryBtn} disabled={selectedColors.length === 0} onClick={() => setStep(2)}>
                  Next: sizes →
                </Button>
              </>
            ) : step === 2 ? (
              <>
                <Button variant="outline" className={outlineBtn} onClick={() => setStep(1)}>← Back</Button>
                <Button className={primaryBtn} disabled={!!colorWithoutSizes || totalVariants === 0} onClick={() => setStep(3)}>
                  Next: images →
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" className={outlineBtn} onClick={() => setStep(2)} disabled={saving || anyUploading}>← Back</Button>
                <Button className={primaryBtn} onClick={handleSubmit} disabled={saving || anyUploading || !allImagesReady}>
                  {saving ? 'Adding…' : `Add ${totalVariants} variant${totalVariants !== 1 ? 's' : ''}`}
                </Button>
              </>
            )}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GMAddColorModal;
