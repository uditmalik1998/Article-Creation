/**
 * HierarchyTreeEditor
 * Admin › Hierarchy tab, backed by major_category_details:
 *   • one tab per division (div)
 *   • the division's sub-divisions (sub_div) as cards (active / total major categories)
 *   • clicking a card opens a side panel listing its major categories (maj_cat) with
 *     MC code, MC description, HSN and segment — edit, activate / deactivate
 *     (mc_status ACT / IN) and add. Divisions and sub-divisions can be renamed.
 * No deletes: a major category is deactivated instead.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Empty, Popconfirm, Spinner, Tooltip } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import {
  getMcdRows,
  createMcdRow,
  updateMcdRow,
  renameMcdGroup,
  type McdRow,
  type McdRowInput,
} from '../../../services/adminApi';

const isActive = (r: McdRow) => (r.mcStatus ?? '').toUpperCase() !== 'IN';

// ─── InlineName — click the pencil to rename in place ─────────────────────────
const InlineName: React.FC<{
  label: string;
  onSave: (name: string) => Promise<void>;
  className?: string;
}> = ({ label, onSave, className }) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(label);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!editing) setVal(label); }, [label, editing]);

  const save = async () => {
    const next = val.trim().toUpperCase();
    if (!next || next === label) { setEditing(false); return; }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          aria-label="New name"
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[13px] uppercase outline-none focus:border-slate-800"
        />
        <button type="button" aria-label="Save name" onClick={save} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-white hover:bg-slate-900">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Cancel rename" onClick={() => setEditing(false)} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:border-slate-800">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }
  return (
    <span className={cn('group flex min-w-0 items-center gap-1', className)}>
      <span className="truncate">{label}</span>
      <Tooltip title="Rename">
        <button
          type="button"
          aria-label={`Rename ${label}`}
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 opacity-60 hover:bg-slate-100 hover:text-slate-900 group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </span>
  );
};

// ─── McdForm — fields of one major_category_details row ───────────────────────
type FieldKey = 'div' | 'subDiv' | 'majCat' | 'mcCode' | 'mcDes' | 'hsnCode' | 'seg';
const FIELD_LABEL: Record<FieldKey, string> = {
  div: 'Division',
  subDiv: 'Sub-division',
  majCat: 'Major category',
  mcCode: 'MC code',
  mcDes: 'MC description',
  hsnCode: 'HSN code',
  seg: 'Segment',
};

const McdForm: React.FC<{
  fields: FieldKey[];
  /** Fields that must be filled before saving. */
  required: FieldKey[];
  initial?: McdRowInput;
  submitLabel: string;
  onSubmit: (values: McdRowInput) => Promise<void>;
  onCancel: () => void;
}> = ({ fields, required, initial, submitLabel, onSubmit, onCancel }) => {
  const [vals, setVals] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f, String(initial?.[f] ?? '')])),
  );
  const [busy, setBusy] = useState(false);
  const ready = required.every((f) => vals[f]?.trim());

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await onSubmit(Object.fromEntries(fields.map((f) => [f, vals[f].trim() || null])) as McdRowInput);
    } catch {
      /* error already shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-slate-800 bg-white p-2">
      {fields.map((f, i) => (
        <input
          key={f}
          autoFocus={i === 0}
          value={vals[f]}
          onChange={(e) => setVals((p) => ({ ...p, [f]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          placeholder={`${FIELD_LABEL[f]}${required.includes(f) ? '' : ' (optional)'}`}
          aria-label={FIELD_LABEL[f]}
          className={cn(
            'h-8 rounded-md border border-slate-300 px-2 text-[12.5px] uppercase outline-none focus:border-slate-800',
            (f === 'mcCode' || f === 'hsnCode') && 'font-mono',
          )}
        />
      ))}
      <div className="flex justify-end gap-1.5">
        <Button variant="outline" size="sm" onClick={onCancel} className="h-8 border-slate-300">Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy || !ready} className="h-8 bg-slate-800 text-white hover:bg-slate-900">
          {submitLabel}
        </Button>
      </div>
    </div>
  );
};

// "+ label" button that opens an McdForm in place.
const AddButton: React.FC<{
  label: string;
  className?: string;
  form: (close: () => void) => React.ReactNode;
}> = ({ label, className, form }) => {
  const [open, setOpen] = useState(false);
  if (open) return <div className={className}>{form(() => setOpen(false))}</div>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        'flex h-9 items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-slate-400 bg-white px-3 text-[12.5px] font-semibold text-slate-800 hover:border-slate-800',
        className,
      )}
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
};

// ─── HierarchyTreeEditor ──────────────────────────────────────────────────────
export const HierarchyTreeEditor: React.FC = () => {
  const qc = useQueryClient();
  const [div, setDiv] = useState<string | null>(null);
  const [subDiv, setSubDiv] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['major-category-details-rows'],
    queryFn: getMcdRows,
    retry: 1,
  });
  const rows: McdRow[] = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // div → subDiv → rows
  const tree = useMemo(() => {
    const m = new Map<string, Map<string, McdRow[]>>();
    for (const r of rows) {
      const d = r.div || '—';
      const s = r.subDiv || '—';
      if (!m.has(d)) m.set(d, new Map());
      const subs = m.get(d)!;
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s)!.push(r);
    }
    return m;
  }, [rows]);
  const divs = [...tree.keys()].sort();

  // Keep a valid division selected.
  useEffect(() => {
    if (divs.length === 0) return;
    if (div == null || !tree.has(div)) setDiv(divs[0]);
  }, [divs, div, tree]);

  const subsMap = div ? tree.get(div) ?? new Map<string, McdRow[]>() : new Map<string, McdRow[]>();
  const subNames = [...subsMap.keys()].sort();
  const divRows = subNames.flatMap((s) => subsMap.get(s) ?? []);
  const subRows = subDiv ? subsMap.get(subDiv) ?? null : null;
  const maxCats = Math.max(1, ...subNames.map((s) => subsMap.get(s)!.length));

  const lower = search.trim().toLowerCase();
  const rowMatches = (r: McdRow) =>
    [r.majCat, r.mcCode, r.mcDes, r.hsnCode].some((v) => (v ?? '').toLowerCase().includes(lower));
  const visibleSubs = lower
    ? subNames.filter((s) => s.toLowerCase().includes(lower) || subsMap.get(s)!.some(rowMatches))
    : subNames;
  const subNameMatches = !!subDiv && subDiv.toLowerCase().includes(lower);
  const visibleRows = subRows ? (lower && !subNameMatches ? subRows.filter(rowMatches) : subRows) : [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['major-category-details-rows'] });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
      refresh();
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Action failed');
      throw e;
    }
  };

  const pickDiv = (d: string) => { setDiv(d); setSubDiv(null); setEditId(null); setSearch(''); };

  return (
    <div className="flex flex-col gap-3.5">
      {isError && (
        <Alert
          type="error"
          showIcon
          message="Failed to load major category details"
          description={(error as any)?.message || 'Check that the backend is running and you are logged in as Admin.'}
        >
          <Button size="sm" onClick={() => refetch()}>Retry</Button>
        </Alert>
      )}

      {/* Division tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Divisions" className="flex flex-wrap items-start gap-1.5">
          {divs.map((d) => {
            const on = d === div;
            const n = [...(tree.get(d)?.values() ?? [])].reduce((acc, list) => acc + list.length, 0);
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => pickDiv(d)}
                className={cn(
                  'h-10 rounded-[10px] border px-4 text-[13.5px] font-bold transition-colors',
                  on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-800',
                )}
              >
                {d} <span className="font-medium opacity-70">{n}</span>
              </button>
            );
          })}
          <AddButton
            label="Division"
            className="h-10 w-[260px]"
            form={(close) => (
              <McdForm
                fields={['div', 'subDiv', 'majCat', 'mcCode', 'hsnCode']}
                required={['div', 'subDiv', 'majCat']}
                submitLabel="Add division"
                onCancel={close}
                onSubmit={(v) => run(() => createMcdRow(v), 'Division added').then(() => { close(); setDiv(String(v.div).toUpperCase()); })}
              />
            )}
          />
        </div>
        {div && (
          <label className="flex h-[38px] w-[280px] items-center gap-2 rounded-[9px] border border-slate-300 bg-white px-2.5 text-slate-500 focus-within:border-slate-800">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search in ${div}`}
              aria-label={`Search in ${div}`}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-900 outline-none"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        )}
      </div>

      <Spinner spinning={isLoading}>
        {!div ? (
          !isLoading && !isError && <Empty description="No major categories yet — add a division above." className="my-10" />
        ) : (
          <>
            {/* Division summary + actions */}
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-[13px] text-slate-600">
                <InlineName
                  label={div}
                  className="text-[15px] font-bold text-slate-900"
                  onSave={(to) => run(() => renameMcdGroup({ level: 'div', from: div, to }), 'Division renamed').then(() => setDiv(to))}
                />
                <span>
                  · {subNames.length} sub-divisions · {divRows.length} major categories ({divRows.filter(isActive).length} active) — click a card to see and edit them.
                </span>
              </div>
              <AddButton
                label="Sub-division"
                className="w-[260px]"
                form={(close) => (
                  <McdForm
                    fields={['subDiv', 'majCat', 'mcCode', 'hsnCode']}
                    required={['subDiv', 'majCat']}
                    submitLabel="Add sub-division"
                    onCancel={close}
                    onSubmit={(v) => run(() => createMcdRow({ ...v, div }), 'Sub-division added').then(() => { close(); setSubDiv(String(v.subDiv).toUpperCase()); })}
                  />
                )}
              />
            </div>

            <div className={cn('grid items-start gap-3.5', subRows ? 'lg:grid-cols-[minmax(0,1fr)_400px]' : 'grid-cols-1')}>
              {/* Sub-division cards */}
              <div className="grid grid-cols-1 content-start gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {visibleSubs.map((s) => {
                  const list = subsMap.get(s)!;
                  const n = list.length;
                  const act = list.filter(isActive).length;
                  const on = s === subDiv;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setSubDiv(on ? null : s); setEditId(null); }}
                      aria-pressed={on}
                      className={cn(
                        'flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors',
                        on ? 'border-[1.5px] border-slate-800 bg-slate-100' : 'border-slate-200 bg-white hover:border-slate-400',
                      )}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <b className="text-[13px] text-slate-900">{s}</b>
                        {act < n && <span className="shrink-0 text-[10.5px] text-slate-500">{n - act} inactive</span>}
                      </span>
                      <span className="flex items-center gap-2 text-[11.5px] text-slate-700">
                        <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-slate-200">
                          <span className="block h-full bg-slate-800" style={{ width: `${Math.round((n / maxCats) * 100)}%` }} />
                        </span>
                        {n}
                      </span>
                    </button>
                  );
                })}
                {visibleSubs.length === 0 && (
                  <div className="col-span-full py-8 text-center text-xs text-slate-500">
                    {lower ? `Nothing in ${div} matches “${search.trim()}”.` : 'No sub-divisions yet — add one above.'}
                  </div>
                )}
              </div>

              {/* Side panel — the selected sub-division's major categories */}
              {subDiv && subRows && (
                <aside aria-label={subDiv} className="flex max-h-[75vh] flex-col overflow-hidden rounded-[14px] border border-slate-300 bg-white lg:sticky lg:top-4">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3.5">
                    <div className="min-w-0">
                      <InlineName
                        label={subDiv}
                        className="text-[15px] font-bold text-slate-900"
                        onSave={(to) => run(() => renameMcdGroup({ level: 'subDiv', div, from: subDiv, to }), 'Sub-division renamed').then(() => setSubDiv(to))}
                      />
                      <div className="text-[11.5px] text-slate-600">
                        {div} · {subRows.length} major categories
                      </div>
                    </div>
                    <button type="button" aria-label="Close" onClick={() => { setSubDiv(null); setEditId(null); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5">
                    {visibleRows.map((r) => {
                      const active = isActive(r);
                      if (editId === r.id) {
                        return (
                          <div key={r.id} className="py-1.5">
                            <McdForm
                              fields={['majCat', 'mcCode', 'mcDes', 'hsnCode', 'seg']}
                              required={['majCat']}
                              initial={r}
                              submitLabel="Save"
                              onCancel={() => setEditId(null)}
                              onSubmit={(v) => run(() => updateMcdRow(r.id, v), 'Major category updated').then(() => setEditId(null))}
                            />
                          </div>
                        );
                      }
                      return (
                        <div key={r.id} className="flex min-h-[44px] items-center gap-1 border-b border-slate-100 px-1.5 py-1 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <div className={cn('truncate text-[12.5px] font-medium', active ? 'text-slate-900' : 'text-slate-400')}>{r.majCat}</div>
                            <div className="truncate font-mono text-[10.5px] text-slate-500">
                              {[r.mcCode && `MC ${r.mcCode}`, r.hsnCode && `HSN ${r.hsnCode}`, r.seg].filter(Boolean).join(' · ') || '—'}
                            </div>
                            {r.mcDes && r.mcDes !== r.majCat && <div className="truncate text-[10.5px] text-slate-500">{r.mcDes}</div>}
                          </div>
                          {!active && <span className="shrink-0 rounded-full bg-slate-100 px-2 text-[10px] font-semibold text-slate-600">inactive</span>}
                          <Tooltip title="Edit">
                            <button
                              type="button"
                              aria-label={`Edit ${r.majCat}`}
                              onClick={() => setEditId(r.id)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Popconfirm
                            title={active ? `Deactivate ${r.majCat}?` : `Activate ${r.majCat}?`}
                            description={active ? "Sets MC status to 'IN'. You can activate it again." : "Sets MC status to 'ACT'."}
                            onConfirm={() => run(() => updateMcdRow(r.id, { mcStatus: active ? 'IN' : 'ACT' }), active ? 'Major category deactivated' : 'Major category activated').catch(() => {})}
                            okText={active ? 'Deactivate' : 'Activate'}
                          >
                            <button type="button" className="h-7 shrink-0 rounded-md px-2 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                              {active ? 'Deactivate' : 'Activate'}
                            </button>
                          </Popconfirm>
                        </div>
                      );
                    })}
                    {visibleRows.length === 0 && (
                      <div className="px-2 py-6 text-center text-xs text-slate-500">
                        {lower ? `No major categories match “${search.trim()}”.` : 'No major categories yet.'}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 p-3">
                    <AddButton
                      label="Add major category"
                      className="w-full"
                      form={(close) => (
                        <McdForm
                          fields={['majCat', 'mcCode', 'mcDes', 'hsnCode', 'seg']}
                          required={['majCat']}
                          submitLabel="Add"
                          onCancel={close}
                          onSubmit={(v) => run(() => createMcdRow({ ...v, div, subDiv }), 'Major category added').then(close)}
                        />
                      )}
                    />
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
      </Spinner>
    </div>
  );
};
