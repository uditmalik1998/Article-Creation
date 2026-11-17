import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ImagePlus, Loader2, Plus, Search, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import { APP_CONFIG } from '../../../constants/app/config';
import type { ApproverItem } from '../types';
import VariantGrid, { StatusPill } from './VariantGrid';

const FALLBACK_COLORS = ['BLACK', 'WHITE', 'RED', 'NAVY', 'GREY', 'BLUE', 'GREEN'];

interface VariantSubTableProps {
  genericId: string;
  genericRecord: ApproverItem;
  onRefresh: () => void;
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
  refreshKey?: number;
  /** Major category was just changed: the server is re-creating the colour variants. */
  rebuilding?: boolean;
}

// ── Add Color modal ───────────────────────────────────────────────────────────

interface AddColorModalProps {
  open: boolean;
  genericId: string;
  majorCategory: string;
  existingColors: string[];
  /** Existing (size, color) pairs already created, as `SIZE||COLOR` (upper-cased). */
  existingPairs: Set<string>;
  sizeCount: number;
  /** Article / design number shown in the header. */
  articleLabel?: string;
  onClose: () => void;
  onAdded: () => void;
}

type ColorOption = { value: string; label: string; name: string; disabled: boolean };

// Colour family = last word of the name ("ALMOND BEIGE" -> BEIGE), used to group the dropdown.
const colorFamily = (name: string) => {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  return words[words.length - 1] || 'OTHER';
};

// Searchable colour dropdown: type to filter (name or code), grouped by family, multi-select.
const ColorDropdown: React.FC<{
  options: ColorOption[];
  value: string[];
  onChange: (v: string[]) => void;
}> = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toUpperCase();
  const filtered = useMemo(
    () => options.filter((o) => !q || o.name.toUpperCase().includes(q) || o.value.toUpperCase().includes(q)),
    [options, q],
  );
  // Selectable options grouped by family (A-Z), already-added ones last.
  const groups = useMemo(() => {
    const map = new Map<string, ColorOption[]>();
    for (const o of filtered.filter((x) => !x.disabled)) {
      const fam = colorFamily(o.name);
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(o);
    }
    const out = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    const added = filtered.filter((x) => x.disabled);
    if (added.length) out.push(['ALREADY ADDED', added]);
    return out;
  }, [filtered]);
  const flat = groups.flatMap(([, os]) => os).filter((o) => !o.disabled);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && flat[active]) toggle(flat[active].value); else setOpen(true); }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); e.preventDefault(); setOpen(false); } }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-lg border-[1.5px] bg-white px-3',
          open ? 'border-[#1e293b] ring-2 ring-slate-200' : 'border-slate-300',
        )}
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search colour name or code"
          aria-label="Search colours"
          aria-expanded={open}
          className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={(e) => { e.stopPropagation(); setQuery(''); }} className="text-slate-400 hover:text-slate-700">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={open ? 'Close colour list' : 'Open colour list'}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          className="text-slate-500"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[300px] overflow-y-auto rounded-[10px] border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,.18)]"
        >
          {groups.length === 0 && <div className="px-3 py-4 text-center text-[13px] text-slate-500">No colour matches "{query}"</div>}
          {groups.map(([fam, os]) => (
            <div key={fam}>
              <div className="sticky top-0 z-[1] border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10.5px] font-bold tracking-[0.08em] text-slate-500">
                {fam}
              </div>
              {os.map((o) => {
                const on = value.includes(o.value);
                const isActive = !o.disabled && flat[active]?.value === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={o.disabled}
                    data-active={isActive}
                    onMouseEnter={() => { const i = flat.findIndex((f) => f.value === o.value); if (i >= 0) setActive(i); }}
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                      o.disabled ? 'cursor-not-allowed opacity-60' : isActive ? 'bg-slate-100' : on ? 'bg-slate-50' : 'hover:bg-slate-50',
                    )}
                  >
                    {o.disabled ? (
                      <span className="h-4 w-4 shrink-0 rounded bg-slate-200" />
                    ) : on ? (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#1e293b]"><Check className="h-3 w-3 text-white" strokeWidth={3.2} /></span>
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded border-[1.5px] border-slate-400" />
                    )}
                    <span className={cn('text-[13px] text-slate-900', on ? 'font-bold' : 'font-medium')}>{o.name}</span>
                    {o.disabled && <span className="text-[11px] text-slate-500">already added</span>}
                    <span className="ml-auto rounded bg-slate-100 px-1.5 py-px font-mono text-[11.5px] font-semibold text-slate-700">{o.value}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AddColorModal: React.FC<AddColorModalProps> = ({
  open,
  genericId,
  majorCategory,
  existingColors,
  existingPairs,
  sizeCount,
  articleLabel,
  onClose,
  onAdded,
}) => {
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [masterColors, setMasterColors] = useState<{ code: string; name: string }[]>([]);
  // Step 2: per-color image upload. step 1 = pick colors/sizes, step 2 = upload images.
  const [step, setStep] = useState<1 | 2>(1);
  const [colorImages, setColorImages] = useState<Record<string, string>>({}); // color code → uploaded URL
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) { setSelectedColors([]); setStep(1); setColorImages({}); setUploading({}); return; }
    const token = localStorage.getItem('authToken');
    // Colors from the color_master table.
    fetch(`${APP_CONFIG.api.baseURL}/approver/colors`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => setMasterColors(Array.isArray(d?.colors) ? d.colors : []))
      .catch(() => setMasterColors([]));
  }, [open, majorCategory]);

  // color code → "Name - CODE" label for the image step.
  const colorLabel = (code: string) => {
    const m = masterColors.find((c) => c.code.toUpperCase() === code.toUpperCase());
    return m ? `${m.name} - ${m.code}` : code;
  };

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

  const handleNext = () => {
    if (selectedColors.length === 0) { message.warning('Please select at least one color'); return; }
    setStep(2);
  };

  const handleOk = async () => {
    if (selectedColors.length === 0) {
      message.warning('Please select at least one color');
      return;
    }
    if (!allImagesReady) {
      message.warning('Upload an image for every color');
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const body = { colors: selectedColors, colorImages };
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/add-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
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

  const isColorDisabled = (code: string, label?: string): boolean => {
    const codeU = code.toUpperCase();
    const labelU = label?.toUpperCase();
    return existingColors.some((ec) => ec.toUpperCase() === codeU || (labelU ? ec.toUpperCase() === labelU : false));
  };

  // Colors come from the color_master table (child_color + sap_create_old).
  // value  = sap_create_old (stored on the variant), label = "CHILD COLOR - SAP_CODE".
  // Falls back to a fixed list only if color_master is unavailable.
  const options: ColorOption[] =
    masterColors.length > 0
      ? masterColors.map((c) => ({
          value: c.code,
          name: c.name,
          label: `${c.name} - ${c.code}`,
          disabled: isColorDisabled(c.code),
        }))
      : FALLBACK_COLORS.map((c) => ({ value: c, name: c, label: c, disabled: isColorDisabled(c, c) }));

  const colorName = (code: string) => masterColors.find((c) => c.code.toUpperCase() === code.toUpperCase())?.name ?? code;
  const variantCount = selectedColors.length * sizeCount;
  const readyCount = selectedColors.filter((c) => !!colorImages[c]).length;

  const stepper = (
    <div className="mt-3 flex items-center gap-2">
      {(['Colours', 'Images'] as const).map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const cur = step === n;
        return (
          <React.Fragment key={label}>
            {i > 0 && <span className="h-[1.5px] w-7 bg-slate-600" />}
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-bold', cur || done ? 'text-white' : 'text-slate-400')}>
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                  cur ? 'bg-white text-[#1e293b]' : done ? 'bg-white/20 text-white' : 'border-[1.5px] border-slate-500 text-slate-400',
                )}
              >
                {done ? <Check className="h-2.5 w-2.5" strokeWidth={3.2} /> : n}
              </span>
              {label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );

  const busyClose = saving || anyUploading;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busyClose) onClose(); }}>
      <DialogContent showClose={false} className="max-w-[640px] gap-0 overflow-visible p-0 outline-none">
        <div className="relative rounded-t-[var(--radius-card)] bg-[#1e293b] px-5 pb-4 pt-[18px] text-white">
          <div className="text-[11px] font-bold tracking-[0.08em] text-slate-400">
            ADD COLOUR VARIANTS{articleLabel ? ` · ${articleLabel}` : ''}
          </div>
          <DialogTitle className="mt-1 text-xl font-semibold text-white">
            {step === 1 ? 'Pick colours' : 'Add an image for each colour'}
          </DialogTitle>
          {stepper}
          <button
            type="button"
            aria-label="Close"
            disabled={busyClose}
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-3 px-5 py-4">
            <ColorDropdown options={options} value={selectedColors} onChange={setSelectedColors} />
            <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center">
                <b className="text-[12.5px] text-slate-900">Selected ({selectedColors.length})</b>
                {selectedColors.length > 0 && (
                  <button type="button" onClick={() => setSelectedColors([])} className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-800">
                    Clear
                  </button>
                )}
              </div>
              {selectedColors.length === 0 ? (
                <p className="m-0 text-xs text-slate-500">Search above and tick one or more colours. Each colour gets one variant per size of this major category.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedColors.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-1.5">
                      <span className="text-[12.5px] font-bold text-slate-900">{colorName(code)}</span>
                      <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] font-semibold text-slate-700">{code}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${code}`}
                        onClick={() => setSelectedColors((sel) => sel.filter((c) => c !== code))}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {existingColors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                Already on this article:
                {existingColors.map((c) => (
                  <span key={c} className="rounded bg-slate-100 px-1.5 font-mono text-[11px] font-semibold text-slate-700">{c}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3 px-5 py-4">
            <p className="m-0 text-[13px] text-slate-600">One image per colour — it is used for every size of that colour. Click a card or drop an image on it.</p>
            <div className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {selectedColors.map((code) => {
                const url = colorImages[code];
                const busy = uploading[code];
                return (
                  <label
                    key={code}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && f.type.startsWith('image/') && !busy) uploadColorImage(code, f);
                    }}
                    className={cn(
                      'flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-slate-200 p-3 text-center hover:border-slate-400',
                      busy && 'pointer-events-none',
                    )}
                  >
                    <div className="flex h-[120px] w-[96px] items-center justify-center overflow-hidden rounded-lg">
                      {url ? (
                        <img src={url} alt={code} className="h-full w-full object-cover" />
                      ) : busy ? (
                        <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-100">
                          <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
                        </div>
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-slate-400 bg-slate-50 text-[10px] font-semibold text-slate-500">
                          <ImagePlus className="h-5 w-5" />
                          Drop or click
                        </div>
                      )}
                    </div>
                    <span className="text-[12.5px] font-bold text-slate-900">{colorName(code)}</span>
                    <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] font-semibold text-slate-700">{code}</span>
                    <span className={cn('text-[11.5px]', url ? 'font-semibold text-slate-900' : 'text-slate-500')}>
                      {busy ? 'Uploading…' : url ? 'Uploaded · Replace' : 'Image needed'}
                    </span>
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
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 rounded-b-[var(--radius-card)] border-t border-slate-200 bg-slate-50 px-5 py-3">
          {step === 1 ? (
            <span className="text-[13px] text-slate-700">
              {selectedColors.length > 0 && sizeCount > 0 ? (
                <>
                  <b className="text-slate-900">{selectedColors.length} colour{selectedColors.length !== 1 ? 's' : ''}</b> × {sizeCount} size{sizeCount !== 1 ? 's' : ''} ={' '}
                  <b className="font-mono text-slate-900">{variantCount} variants</b>
                </>
              ) : (
                'No colours selected'
              )}
            </span>
          ) : (
            <span className="text-[13px] text-slate-700">
              <b className="text-slate-900">{readyCount} of {selectedColors.length}</b> images ready
            </span>
          )}
          <span className="ml-auto flex gap-2">
            {step === 1 ? (
              <>
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleNext} disabled={selectedColors.length === 0} className="bg-[#1e293b] text-white hover:bg-[#0f172a]">
                  Next: images
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setStep(1)} disabled={busyClose}>Back</Button>
                <Button onClick={handleOk} disabled={busyClose || !allImagesReady} className="bg-[#1e293b] text-white hover:bg-[#0f172a]">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</> : `Create ${variantCount} variant${variantCount !== 1 ? 's' : ''}`}
                </Button>
              </>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Inline weight input cell ──────────────────────────────────────────────────

const WeightCell: React.FC<{ variant: ApproverItem; synced: boolean; onSaved: () => void }> = ({ variant, synced, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(variant.variantWeight ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(variant.variantWeight ?? ''); }, [variant.variantWeight]);

  const save = async () => {
    const trimmed = String(value).trim();
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${variant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ variantWeight: trimmed || null }),
      });
      if (!r.ok) throw new Error('Failed to save weight');
      onSaved();
    } catch {
      message.error('Failed to save weight');
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const isEmpty = !value || String(value).trim() === '';

  // Synced variants: show weight as plain read-only text
  if (synced) {
    return (
      <span className="block pr-2 text-right font-mono text-[11.5px] text-slate-500">
        {isEmpty ? '—' : `${value} kg`}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        className="h-6 w-full rounded border border-slate-400 bg-white px-2 text-right font-mono text-[11.5px] focus:outline-none focus:ring-1 focus:ring-slate-700"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') setEditing(false);
        }}
        disabled={saving}
        placeholder="e.g. 0.25"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'h-6 w-full rounded border px-2 text-right font-mono text-[11.5px]',
        isEmpty
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400'
          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400',
      )}
    >
      {isEmpty ? '— kg' : `${value} kg`}
    </button>
  );
};

// ── Main VariantSubTable ──────────────────────────────────────────────────────

const VariantSubTable: React.FC<VariantSubTableProps> = ({
  genericId,
  genericRecord,
  onRefresh,
  pathType,
  refreshKey,
  rebuilding,
}) => {
  const [variants, setVariants] = useState<ApproverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [addColorOpen, setAddColorOpen] = useState(false);
  const [majCatSizeCount, setMajCatSizeCount] = useState<number | null>(null);
  const [deletingColor, setDeletingColor] = useState<string | null>(null);

  const fetchVariants = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/variants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch variants');
      const result = await response.json();
      setVariants(result.data || result);
    } catch {
      if (!silent) message.error('Failed to load variants');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [genericId]);

  // Refetch on mount/genericId change, AND when the generic is approved/synced
  // (Save & Submit flips approvalStatus → APPROVED and sets sapArticleId) so the
  // variant rows refresh to show their updated status / SAP article numbers.
  useEffect(() => {
    fetchVariants();
  }, [fetchVariants, genericRecord.approvalStatus, genericRecord.sapArticleId, refreshKey]);

  // Variants sync to SAP a bit AFTER the generic, so the first refetch above often
  // still shows them "Pending SAP". Quietly re-poll every 5s while the generic is
  // APPROVED and any variant is still un-synced, so their SAP numbers/status appear
  // without a hard refresh. Self-stops once all variants resolve (or after 3 min).
  const variantPollElapsedRef = useRef(0);
  useEffect(() => { variantPollElapsedRef.current = 0; }, [genericId]);
  useEffect(() => {
    if (genericRecord.approvalStatus !== 'APPROVED') return;
    const anyPending = variants.some(
      (v) => v.sapSyncStatus === 'PENDING' || v.sapSyncStatus === 'NOT_SYNCED',
    );
    if (!anyPending || variantPollElapsedRef.current >= 180) return;
    const t = window.setTimeout(() => {
      variantPollElapsedRef.current += 5;
      void fetchVariants(true);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [variants, genericRecord.approvalStatus, fetchVariants]);

  useEffect(() => {
    const majCat = genericRecord.majorCategory;
    if (!majCat) return;
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/approver/sizes-for-majcat/${encodeURIComponent(majCat)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setMajCatSizeCount(d.count ?? null))
      .catch(() => setMajCatSizeCount(null));
  }, [genericRecord.majorCategory]);

  const existingColors = Array.from(
    new Set(variants.map((v) => v.variantColor).filter((c): c is string => Boolean(c))),
  );

  // Existing (size, color) combinations, so the Add-Color modal can tell apart
  // "this color exists for some sizes" from "this exact size × color exists".
  const existingPairs = new Set(
    variants
      .filter((v) => v.variantSize && v.variantColor)
      .map((v) => `${String(v.variantSize).trim().toUpperCase()}||${String(v.variantColor).trim().toUpperCase()}`),
  );

  const sizeCount =
    majCatSizeCount ?? Array.from(new Set(variants.map((v) => v.variantSize).filter(Boolean))).length;

  const handleVariantSaved = useCallback(() => {
    fetchVariants();
  }, [fetchVariants]);

  const handleDeleteColorVariants = useCallback(
    async (color: string) => {
      const toDelete = variants.filter(
        (v) => (v.variantColor || '').toUpperCase() === color.toUpperCase(),
      );
      setDeletingColor(color.toUpperCase());
      try {
        const token = localStorage.getItem('authToken');
        await Promise.all(
          toDelete.map((v) =>
            fetch(`${APP_CONFIG.api.baseURL}/approver/items/${v.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }),
          ),
        );
        message.success(`Deleted ${toDelete.length} variant${toDelete.length !== 1 ? 's' : ''} for color ${color}`);
        fetchVariants();
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to delete color variants');
      } finally {
        setDeletingColor(null);
      }
    },
    [variants, fetchVariants],
  );

  // Colors where at least one variant has a SAP article ID — hide delete button for these.
  const syncedColors = useMemo(() => {
    const s = new Set<string>();
    for (const v of variants) {
      if (v.sapArticleId) {
        const c = (v.variantColor || '').toUpperCase();
        if (c) s.add(c);
      }
    }
    return s;
  }, [variants]);

  const handleRetryVariants = useCallback(async () => {
    setRetrying(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/retry-variants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Retry failed');
      message.success(data.message || `${data.synced} synced, ${data.failed} failed`);
      fetchVariants();
      onRefresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }, [genericId, variants, fetchVariants, onRefresh]);

  // ── Grid wiring (shared VariantGrid, design "Option E") ───────────────────
  const hasWeight = (v: ApproverItem) => String(v.variantWeight ?? '').trim() !== '';

  const handleBulkWeight = async (ids: string[], w: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`${APP_CONFIG.api.baseURL}/approver/items/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ variantWeight: w }),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed) message.error(`Weight not saved for ${failed} variant${failed !== 1 ? 's' : ''}`);
      else message.success(`Weight set for ${ids.length} variant${ids.length !== 1 ? 's' : ''}`);
      fetchVariants(true);
    } catch {
      message.error('Failed to save weight');
    }
  };

  const handleBulkDelete = async (ids: string[]) => {
    const token = localStorage.getItem('authToken');
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`${APP_CONFIG.api.baseURL}/approver/items/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed) message.error(`${failed} variant${failed !== 1 ? 's' : ''} could not be deleted`);
    else message.success(`Deleted ${ids.length} variant${ids.length !== 1 ? 's' : ''}`);
    fetchVariants();
  };

  const renderStatus = (v: ApproverItem) => {
    if (v.sapArticleId) return <StatusPill tone="green">Synced</StatusPill>;
    // SYNCED with no article number = effectively failed — treat as FAILED
    if (v.sapSyncStatus === 'FAILED' || v.sapSyncStatus === 'SYNCED') {
      return <StatusPill tone="red" tooltip={v.sapSyncMessage || 'SAP returned an error'}>Failed</StatusPill>;
    }
    if (!hasWeight(v)) return <StatusPill tone="amber">Needs weight</StatusPill>;
    return <StatusPill tone="slate">Pending SAP</StatusPill>;
  };

  if (loading || rebuilding) {
    return (
      <div className="flex items-center justify-center gap-2 py-4" role="status">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">
          {rebuilding
            ? `Re-creating colour variants with ${genericRecord.majorCategory || 'the new major category'} sizes…`
            : 'Loading variants…'}
        </span>
      </div>
    );
  }

  const retryNeededCount = variants.filter(
    (v) =>
      !v.sapArticleId && (
        v.sapSyncStatus === 'FAILED' ||
        v.sapSyncStatus === 'SYNCED' ||
        (v.approvalStatus === 'APPROVED' && (v.sapSyncStatus === 'NOT_SYNCED' || v.sapSyncStatus === 'PENDING')) ||
        v.approvalStatus === 'PENDING'
      ),
  ).length;

  return (
    <div>
      <VariantGrid<ApproverItem>
        variants={variants}
        fallbackColor={genericRecord.colour}
        // Synced variants can't be edited or deleted.
        isSelectable={(v) => !v.sapArticleId}
        // Same rule as before: no variant of a colour that already has a SAP-synced variant.
        isDeletable={(v) => !syncedColors.has((v.variantColor || '').toUpperCase())}
        onBulkDelete={handleBulkDelete}
        canDeleteColor={(color, rows) => rows.length > 0 && !!rows[0].variantColor && !syncedColors.has(color)}
        onDeleteColor={handleDeleteColorVariants}
        deletingColor={deletingColor}
        renderStatus={renderStatus}
        weight={{
          renderCell: (v) => <WeightCell variant={v} synced={!!v.sapArticleId} onSaved={() => fetchVariants(true)} />,
          isMissing: (v) => !v.sapArticleId && !hasWeight(v),
          onBulkSet: handleBulkWeight,
        }}
        toolbarActions={
          <>
            {pathType === 'created' && retryNeededCount > 0 && (
              <Button size="sm" variant="destructive" className="h-7 text-[12px]" disabled={retrying} onClick={handleRetryVariants}>
                {retrying ? 'Retrying…' : `Retry Variants to SAP (${retryNeededCount})`}
              </Button>
            )}
            <Button size="sm" className="h-7 bg-slate-800 text-[12px] text-white hover:bg-slate-900" onClick={() => setAddColorOpen(true)}>
              <Plus />
              Add Color
            </Button>
          </>
        }
      />

      <AddColorModal
        open={addColorOpen}
        genericId={genericId}
        majorCategory={genericRecord.majorCategory || ''}
        existingColors={existingColors}
        existingPairs={existingPairs}
        sizeCount={sizeCount}
        articleLabel={genericRecord.articleNumber || genericRecord.designNumber || undefined}
        onClose={() => setAddColorOpen(false)}
        onAdded={handleVariantSaved}
      />
    </div>
  );
};

export default VariantSubTable;
