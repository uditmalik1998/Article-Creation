/**
 * HierarchyTreeEditor
 * Admin › Hierarchy tab (design "Option C · department tabs + sub-department cards"):
 *   • one tab per department (+ add department)
 *   • the department's sub-departments as cards (code, category count, size bar)
 *   • clicking a card opens a side panel listing its categories, with rename,
 *     deactivate / activate and add.
 *
 * Deletes are deliberately limited: the backend's category delete also wipes
 * that category's extraction jobs, so categories are deactivated instead, and
 * departments / sub-departments can only be deleted once they are empty.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Empty, Popconfirm, Spinner, Tooltip } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import {
  getHierarchyTree,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createSubDepartment,
  updateSubDepartment,
  deleteSubDepartment,
  createCategory,
  updateCategory,
} from '../../../services/adminApi';

export interface SelectedCategory {
  id: number;
  name: string;
  code: string;
  garmentType: string;
  departmentName: string;
}

const toCode = (name: string) => name.trim().toUpperCase().replace(/\s+/g, '_');

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
    const next = val.trim();
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
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[13px] outline-none focus:border-slate-800"
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

// ─── InlineAdd — "+ label" button that turns into name (+ code) inputs ────────
const InlineAdd: React.FC<{
  label: string;
  withCode?: boolean;
  onAdd: (name: string, code: string) => Promise<void>;
  className?: string;
}> = ({ label, withCode, onAdd, className }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => { setOpen(false); setName(''); setCode(''); };
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onAdd(name.trim(), code.trim() ? code.trim().toUpperCase() : toCode(name));
      close();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
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
  }
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-[10px] border border-slate-800 bg-white p-2', className)}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); }}
        placeholder="Name"
        aria-label="Name"
        className="h-8 rounded-md border border-slate-300 px-2 text-[13px] outline-none focus:border-slate-800"
      />
      {withCode && (
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); }}
          placeholder={name.trim() ? `Code (default ${toCode(name)})` : 'Code (optional)'}
          aria-label="Code"
          className="h-8 rounded-md border border-slate-300 px-2 font-mono text-[12px] outline-none focus:border-slate-800"
        />
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="outline" size="sm" onClick={close} className="h-8 border-slate-300">Cancel</Button>
        <Button size="sm" onClick={save} disabled={busy || !name.trim()} className="h-8 bg-slate-800 text-white hover:bg-slate-900">
          Add
        </Button>
      </div>
    </div>
  );
};

// ─── HierarchyTreeEditor ──────────────────────────────────────────────────────
export const HierarchyTreeEditor: React.FC = () => {
  const qc = useQueryClient();
  const [deptId, setDeptId] = useState<number | null>(null);
  const [subId, setSubId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const { data: hierarchyData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hierarchy-tree'],
    queryFn: getHierarchyTree,
    retry: 1,
  });

  const depts: any[] = useMemo(() => (Array.isArray(hierarchyData) ? hierarchyData : []), [hierarchyData]);
  const catCount = (d: any) => (d.subDepartments ?? []).reduce((n: number, s: any) => n + (s.categories ?? []).length, 0);

  // Keep a valid department selected.
  useEffect(() => {
    if (depts.length === 0) return;
    if (deptId == null || !depts.some((d) => d.id === deptId)) setDeptId(depts[0].id);
  }, [depts, deptId]);

  const dept = depts.find((d) => d.id === deptId) ?? null;
  const subs: any[] = dept?.subDepartments ?? [];
  const sub = subs.find((s) => s.id === subId) ?? null;
  const maxCats = Math.max(1, ...subs.map((s) => (s.categories ?? []).length));

  const lower = search.trim().toLowerCase();
  const catMatches = (c: any) => c.name.toLowerCase().includes(lower) || String(c.code).toLowerCase().includes(lower);
  const visibleSubs = lower
    ? subs.filter((s) => s.name.toLowerCase().includes(lower) || String(s.code ?? '').toLowerCase().includes(lower) || (s.categories ?? []).some(catMatches))
    : subs;
  const subNameMatches = !!sub && (sub.name.toLowerCase().includes(lower) || String(sub.code ?? '').toLowerCase().includes(lower));
  const visibleCats: any[] = sub ? (lower && !subNameMatches ? (sub.categories ?? []).filter(catMatches) : sub.categories ?? []) : [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
    qc.invalidateQueries({ queryKey: ['hierarchy-stats'] });
  };
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

  const pickDept = (id: number) => { setDeptId(id); setSubId(null); setSearch(''); };

  return (
    <div className="flex flex-col gap-3.5">
      {isError && (
        <Alert
          type="error"
          showIcon
          message="Failed to load hierarchy"
          description={(error as any)?.message || 'Check that the backend is running and you are logged in as Admin.'}
        >
          <Button size="sm" onClick={() => refetch()}>Retry</Button>
        </Alert>
      )}

      {/* Department tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Departments" className="flex flex-wrap items-center gap-1.5">
          {depts.map((d) => {
            const on = d.id === deptId;
            return (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => pickDept(d.id)}
                className={cn(
                  'h-10 rounded-[10px] border px-4 text-[13.5px] font-bold transition-colors',
                  on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-800',
                )}
              >
                {d.name} <span className="font-medium opacity-70">{catCount(d)}</span>
              </button>
            );
          })}
          <InlineAdd
            label="Department"
            onAdd={(name, code) => run(() => createDepartment({ code, name, displayOrder: 99 }), 'Department added')}
            className="h-10"
          />
        </div>
        {dept && (
          <label className="flex h-[38px] w-[280px] items-center gap-2 rounded-[9px] border border-slate-300 bg-white px-2.5 text-slate-500 focus-within:border-slate-800">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search in ${dept.name}`}
              aria-label={`Search in ${dept.name}`}
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
        {!dept ? (
          !isLoading && !isError && <Empty description="No departments yet — add one above." className="my-10" />
        ) : (
          <>
            {/* Department summary + actions */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-[13px] text-slate-600">
                <InlineName
                  label={dept.name}
                  className="text-[15px] font-bold text-slate-900"
                  onSave={(name) => run(() => updateDepartment(dept.id, { name }), 'Department renamed')}
                />
                <span>· {subs.length} sub-departments · {catCount(dept)} categories — click a card to see and edit its categories.</span>
              </div>
              <div className="flex items-center gap-2">
                {subs.length === 0 ? (
                  <Popconfirm
                    title={`Delete ${dept.name}?`}
                    description="This department is empty. This cannot be undone."
                    onConfirm={() => run(() => deleteDepartment(dept.id), 'Department deleted').then(() => setDeptId(null)).catch(() => {})}
                    okText="Delete"
                  >
                    <Button variant="outline" size="sm" className="h-9 border-red-200 text-red-700 hover:bg-red-50">Delete department</Button>
                  </Popconfirm>
                ) : null}
                <InlineAdd
                  label="Sub-department"
                  withCode
                  onAdd={(name, code) => run(() => createSubDepartment({ departmentId: dept.id, code, name, displayOrder: 99 }), 'Sub-department added')}
                />
              </div>
            </div>

            <div className={cn('grid items-start gap-3.5', sub ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : 'grid-cols-1')}>
              {/* Sub-department cards */}
              <div className="grid grid-cols-1 content-start gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {visibleSubs.map((s) => {
                  const n = (s.categories ?? []).length;
                  const on = s.id === subId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSubId(on ? null : s.id)}
                      aria-pressed={on}
                      className={cn(
                        'flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors',
                        on ? 'border-[1.5px] border-slate-800 bg-slate-100' : 'border-slate-200 bg-white hover:border-slate-400',
                      )}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <b className="text-[13px] text-slate-900">{s.name}</b>
                        <span className="shrink-0 font-mono text-[10.5px] text-slate-600">{s.code}</span>
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
                    {lower ? `Nothing in ${dept.name} matches “${search.trim()}”.` : 'No sub-departments yet — add one above.'}
                  </div>
                )}
              </div>

              {/* Side panel — the selected sub-department's categories */}
              {sub && (
                <aside aria-label={sub.name} className="flex max-h-[70vh] flex-col overflow-hidden rounded-[14px] border border-slate-300 bg-white lg:sticky lg:top-4">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3.5">
                    <div className="min-w-0">
                      <InlineName
                        label={sub.name}
                        className="text-[15px] font-bold text-slate-900"
                        onSave={(name) => run(() => updateSubDepartment(sub.id, { name }), 'Sub-department renamed')}
                      />
                      <div className="font-mono text-[11.5px] text-slate-600">
                        {sub.code} · {(sub.categories ?? []).length} categories
                      </div>
                    </div>
                    <button type="button" aria-label="Close" onClick={() => setSubId(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5">
                    {visibleCats.map((c) => {
                      const active = c.isActive !== false;
                      return (
                        <div key={c.id} className="flex min-h-[38px] items-center gap-1 border-b border-slate-100 px-1.5 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <InlineName
                              label={c.name}
                              className={cn('text-[12.5px]', active ? 'text-slate-900' : 'text-slate-400')}
                              onSave={(name) => run(() => updateCategory(c.id, { name }), 'Category renamed')}
                            />
                            {c.code !== c.name && <div className="truncate font-mono text-[10.5px] text-slate-500">{c.code}</div>}
                          </div>
                          {!active && <span className="shrink-0 rounded-full bg-slate-100 px-2 text-[10px] font-semibold text-slate-600">inactive</span>}
                          <Popconfirm
                            title={active ? `Deactivate ${c.name}?` : `Activate ${c.name}?`}
                            description={active ? 'It stays in the hierarchy but is hidden from pickers. You can activate it again.' : 'It becomes available again.'}
                            onConfirm={() => run(() => updateCategory(c.id, { isActive: !active } as any), active ? 'Category deactivated' : 'Category activated').catch(() => {})}
                            okText={active ? 'Deactivate' : 'Activate'}
                          >
                            <button type="button" className="h-7 shrink-0 rounded-md px-2 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                              {active ? 'Deactivate' : 'Activate'}
                            </button>
                          </Popconfirm>
                        </div>
                      );
                    })}
                    {visibleCats.length === 0 && (
                      <div className="px-2 py-6 text-center text-xs text-slate-500">
                        {lower ? `No categories match “${search.trim()}”.` : 'No categories yet.'}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-100 p-3">
                    <InlineAdd
                      label="Add category"
                      withCode
                      onAdd={(name, code) => run(() => createCategory({ subDepartmentId: sub.id, code, name, displayOrder: 99 }), 'Category added')}
                      className="w-full"
                    />
                    {(sub.categories ?? []).length === 0 && (
                      <Popconfirm
                        title={`Delete ${sub.name}?`}
                        description="This sub-department is empty. This cannot be undone."
                        onConfirm={() => run(() => deleteSubDepartment(sub.id), 'Sub-department deleted').then(() => setSubId(null)).catch(() => {})}
                        okText="Delete"
                      >
                        <Button variant="outline" size="sm" className="h-9 w-full border-red-200 text-red-700 hover:bg-red-50">Delete sub-department</Button>
                      </Popconfirm>
                    )}
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
