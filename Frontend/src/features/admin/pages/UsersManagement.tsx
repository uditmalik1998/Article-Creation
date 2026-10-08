import { useState, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, User, Pencil, Download, Upload as UploadIcon, Search, UserX, Lock, KeyRound } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  InputPassword,
  Popconfirm,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import { ACTIVE_SEGMENT_CLASS } from '@/shared/components/articles/ArticleFilters';
import {
  createUser,
  updateUser,
  deactivateUser,
  getUsers,
  getDepartments,
  getGMSubDivisions,
  type AdminUser,
} from '../../../services/adminApi';
// xlsx + exceljs are lazy-loaded inside the bulk-upload handlers below —
// keeps ~600 KB off the initial bundle for admins who never touch bulk upload.
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';

const parseSubDivisionList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

/** Mens / Kids / Ladies / PD / MDM — a coarse business-unit tag independent
 * of Division/Sub-Division above (those follow the Department hierarchy for
 * extraction routing). Every user is meant to end up with one of these. */
const BUSINESS_DIVISIONS = ['MENS', 'KIDS', 'LADIES', 'PD', 'MDM'] as const;
const BUSINESS_DIVISION_LABELS: Record<(typeof BUSINESS_DIVISIONS)[number], string> = {
  MENS: 'Mens Division',
  KIDS: 'Kids Division',
  LADIES: 'Ladies Division',
  PD: 'PD Division',
  MDM: 'MDM',
};

// ─── Table display helpers ─────────────────────────────────────────────────────

/** Role badge colour by family; the label is always written out, so colour is never the only cue. */
const ROLE_TONE_CLASSES = {
  admin: 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900',
  approver: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  creator: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  committee: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  planning: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  pd: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
} as const;

const ROLE_TONE: Record<AdminUser['role'], keyof typeof ROLE_TONE_CLASSES> = {
  ADMIN: 'admin',
  APPROVER: 'approver', CATEGORY_HEAD: 'approver', SUB_DIVISION_HEAD: 'approver',
  FABRIC_APPROVER: 'approver', BODY_APPROVER: 'approver', GM_APPROVER: 'approver',
  CREATOR: 'creator', GM_CREATOR: 'creator',
  PO_COMMITTEE: 'committee',
  PLANNING: 'planning',
  PD: 'pd', PD_DESIGNER: 'pd',
};

const ROLE_LABEL_OVERRIDES: Partial<Record<AdminUser['role'], string>> = {
  PO_COMMITTEE: 'PO committee', PD: 'PD', PD_DESIGNER: 'PD designer', GM_APPROVER: 'GM approver', GM_CREATOR: 'GM creator',
};

const roleLabel = (role: AdminUser['role']): string =>
  ROLE_LABEL_OVERRIDES[role] ?? role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ');

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/** "Yesterday" / "3 weeks ago" for scanning, plus the exact time for the second line. */
function lastLoginParts(value: string | null | undefined): { relative: string; exact: string | null } {
  if (!value) return { relative: 'Never signed in', exact: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { relative: '—', exact: null };
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  const relative =
    days <= 0 ? 'Today'
    : days === 1 ? 'Yesterday'
    : days < 7 ? plural(days, 'day')
    : days < 30 ? plural(Math.floor(days / 7), 'week')
    : days < 365 ? plural(Math.floor(days / 30), 'month')
    : plural(Math.floor(days / 365), 'year');
  const exact = date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return { relative, exact };
}

const SCOPE_PREVIEW_COUNT = 6;

/** Division names, then sub-division codes as chips — first few only, "+N more" expands in place. */
function ScopeCell({ user, expanded, onToggle }: { user: AdminUser; expanded: boolean; onToggle: () => void }) {
  if (user.role === 'ADMIN') {
    return <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">All access</span>;
  }
  const divisions = parseSubDivisionList(user.division).map((d) => {
    const label = formatDivisionLabel(d);
    return label.charAt(0) + label.slice(1).toLowerCase();
  });
  const subs = parseSubDivisionList(user.subDivision);
  if (!divisions.length && !subs.length) {
    return <span className="text-[13px] text-muted-foreground">No division</span>;
  }
  const shown = expanded ? subs : subs.slice(0, SCOPE_PREVIEW_COUNT);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {divisions.length > 0 && (
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{divisions.join(' · ')}</span>
      )}
      {subs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {shown.map((code) => (
            <span key={code} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-foreground/80">{code}</span>
          ))}
          {subs.length > SCOPE_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded px-1 text-[11.5px] font-bold text-slate-800 underline underline-offset-2 dark:text-slate-200"
            >
              {expanded ? 'Show less' : `+${subs.length - SCOPE_PREVIEW_COUNT} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type StatusFilter = 'all' | 'active' | 'inactive';

// ─── Edit dialog helpers ───────────────────────────────────────────────────────

/** Neutral slate hover/focus/open states — the theme's coral ring reads as an error here. */
const SLATE_FIELD_CLASS =
  'hover:border-slate-400 focus-visible:border-slate-500 focus-visible:ring-slate-400/25 ' +
  'focus-within:border-slate-500 focus-within:ring-slate-400/25 ' +
  'data-[state=open]:border-slate-500 data-[state=open]:ring-[3px] data-[state=open]:ring-slate-400/25';

const SLATE_SELECTED_CLASS = 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900';

/** MENS / MEN / Mens all match the same department. */
const normaliseDivision = (s: string) => s.trim().toUpperCase().replace(/S$/, '');

const titleCaseDivision = (value: string) => {
  const label = formatDivisionLabel(value);
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{children}</h3>;
}

interface ScopeDepartment {
  name?: string | null;
  subDepartments?: { code: string; name: string }[];
}

/**
 * Division toggle buttons, then — per selected division — its sub-division codes as
 * toggle chips with Select all / Clear all. Codes the user holds that no selected
 * division lists are shown under "Other codes" so they are never dropped silently.
 */
function AccessScopeEditor({
  divisionNames, departments, divisionIds, subDivisions, showSubDivisions, onDivisionsChange, onSubDivisionsChange,
}: {
  divisionNames: string[];
  departments: ScopeDepartment[];
  divisionIds: string[];
  subDivisions: string[];
  showSubDivisions: boolean;
  onDivisionsChange: (ids: string[]) => void;
  onSubDivisionsChange: (codes: string[]) => void;
}) {
  const selected = new Set(subDivisions);
  const isOn = (name: string) => divisionIds.some((d) => normaliseDivision(d) === normaliseDivision(name));
  const subsFor = (division: string) => {
    const seen = new Set<string>();
    return departments
      .filter((d) => normaliseDivision(String(d.name || '')) === normaliseDivision(division))
      .flatMap((d) => d.subDepartments || [])
      .filter((s) => s.code && !seen.has(s.code) && (seen.add(s.code), true));
  };
  const toggleCode = (code: string) =>
    onSubDivisionsChange(selected.has(code) ? subDivisions.filter((c) => c !== code) : [...subDivisions, code]);

  const blocks = divisionIds.map((id) => ({ id, subs: subsFor(id) }));
  const known = new Set(blocks.flatMap((b) => b.subs.map((s) => s.code)));
  const otherCodes = subDivisions.filter((c) => !known.has(c));

  const chipClass = (on: boolean) => cn(
    'h-8 rounded-md border px-2.5 font-mono text-[12px] transition-colors',
    on ? cn(SLATE_SELECTED_CLASS, 'font-semibold') : 'border-input bg-background text-muted-foreground hover:border-slate-400 hover:text-foreground',
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Divisions" className="grid grid-cols-3 gap-2">
        {divisionNames.map((name) => {
          const on = isOn(name);
          const subs = subsFor(name);
          const count = subs.filter((s) => selected.has(s.code)).length;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onDivisionsChange(on ? divisionIds.filter((d) => normaliseDivision(d) !== normaliseDivision(name)) : [...divisionIds, name])
              }
              className={cn(
                'flex h-11 items-center justify-between gap-2 rounded-lg border px-3.5 text-[14px] font-semibold transition-colors',
                on ? SLATE_SELECTED_CLASS : 'border-dashed border-input bg-background text-foreground hover:border-slate-400',
              )}
            >
              <span className="truncate">{titleCaseDivision(name)}</span>
              <span className="shrink-0 text-[12px] font-medium opacity-75">
                {!on ? 'Add' : showSubDivisions && subs.length ? `${count}/${subs.length}` : 'Selected'}
              </span>
            </button>
          );
        })}
      </div>

      {showSubDivisions && blocks.map(({ id, subs }) => {
        const count = subs.filter((s) => selected.has(s.code)).length;
        const full = subs.length > 0 && count === subs.length;
        return (
          <div key={id} className="flex flex-col gap-2.5 rounded-xl border border-border px-3.5 py-3">
            <div className="flex items-center gap-2">
              <strong className="text-[13.5px]">{titleCaseDivision(id)}</strong>
              <span className="text-[12.5px] text-muted-foreground">{count} of {subs.length}</span>
              <div className="flex-1" />
              {subs.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const codes = subs.map((s) => s.code);
                    onSubDivisionsChange(full
                      ? subDivisions.filter((c) => !codes.includes(c))
                      : [...subDivisions, ...codes.filter((c) => !selected.has(c))]);
                  }}
                  className="px-1 text-[12.5px] font-semibold text-slate-800 underline underline-offset-2 dark:text-slate-200"
                >
                  {full ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            {subs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {subs.map((s) => (
                  <button key={s.code} type="button" title={s.name} aria-pressed={selected.has(s.code)} onClick={() => toggleCode(s.code)} className={chipClass(selected.has(s.code))}>
                    {s.code}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-[12.5px] text-muted-foreground">No sub-divisions are set up for this division.</span>
            )}
          </div>
        );
      })}

      {showSubDivisions && otherCodes.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-dashed border-border px-3.5 py-3">
          <div className="flex items-center gap-2">
            <strong className="text-[13.5px]">Other codes</strong>
            <span className="text-[12.5px] text-muted-foreground">Not listed under the selected divisions — click to remove</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {otherCodes.map((code) => (
              <button key={code} type="button" aria-pressed onClick={() => toggleCode(code)} className={chipClass(true)}>
                {code}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const userSchema = z.object({
  name: z.string().min(1, 'Please enter name'),
  email: z.string().email('Enter a valid email').min(1, 'Please enter email'),
  password: z.string().optional(),
  role: z.enum(['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD', 'BODY_APPROVER', 'FABRIC_APPROVER', 'PLANNING', 'GM_APPROVER', 'GM_CREATOR']),
  divisionIds: z.array(z.string()).optional(),
  subDivision: z.array(z.string()).optional(),
  businessDivision: z.enum(BUSINESS_DIVISIONS).optional().nullable(),
});
type UserValues = z.infer<typeof userSchema>;

export default function UsersManagement() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<AdminUser['role'] | 'ALL'>('ALL');
  // Defaults to Active so the page opens as before (deactivated users were hidden).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [expandedScopes, setExpandedScopes] = useState<Set<number>>(new Set());
  const [pendingRemoveDivision, setPendingRemoveDivision] = useState<string | null>(null);
  const [pendingOrphans, setPendingOrphans] = useState<string[]>([]);
  const pendingDivisionChangeRef = useRef<{ newIds: string[]; orphans: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: '', email: '', password: '', role: 'CREATOR', divisionIds: [], subDivision: [], businessDivision: null },
  });
  const selectedRole = form.watch('role');
  const selectedDivisionIds = form.watch('divisionIds') ?? [];
  const selectedSubDivisions = form.watch('subDivision') ?? [];
  // Editing hides the password box behind "Set a new password" so it isn't typed into by accident.
  const [showPasswordField, setShowPasswordField] = useState(false);

  const user = localStorage.getItem('user');
  const userData = user ? JSON.parse(user) : null;

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: getUsers,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['admin-departments'],
    queryFn: () => getDepartments(true),
  });

  const { data: gmSubDivData } = useQuery({
    queryKey: ['admin-gm-sub-divisions'],
    queryFn: getGMSubDivisions,
    staleTime: 5 * 60 * 1000,
  });

  // Status + search first; the role chips count within this set, then the role filter narrows it.
  const searchedUsers = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== 'all' && u.isActive !== (statusFilter === 'active')) return false;
      if (!lower) return true;
      return (
        u.name.toLowerCase().includes(lower) ||
        u.email.toLowerCase().includes(lower) ||
        (u.division && u.division.toLowerCase().includes(lower)) ||
        (u.subDivision && u.subDivision.toLowerCase().includes(lower)) ||
        u.role.toLowerCase().includes(lower) ||
        roleLabel(u.role).toLowerCase().includes(lower)
      );
    });
  }, [users, searchTerm, statusFilter]);

  const roleChips = useMemo(() => {
    const counts = new Map<AdminUser['role'], number>();
    searchedUsers.forEach((u) => counts.set(u.role, (counts.get(u.role) ?? 0) + 1));
    // Keep the selected role visible even when the search leaves it with no matches.
    if (roleFilter !== 'ALL' && !counts.has(roleFilter)) counts.set(roleFilter, 0);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || roleLabel(a[0]).localeCompare(roleLabel(b[0])));
  }, [searchedUsers, roleFilter]);

  const filteredUsers = useMemo(
    () => (roleFilter === 'ALL' ? searchedUsers : searchedUsers.filter((u) => u.role === roleFilter)),
    [searchedUsers, roleFilter],
  );

  const statusCounts = useMemo(() => ({
    all: users.length,
    active: users.filter((u) => u.isActive).length,
    inactive: users.filter((u) => !u.isActive).length,
  }), [users]);

  const toggleScope = (id: number) => setExpandedScopes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const divisionNames = useMemo(() => {
    const base = ['MENS', 'LADIES', 'KIDS'];
    const fromDepartments = departments.map((d) => formatDivisionLabel(String(d.name || '').trim())).filter(Boolean);
    return Array.from(new Set([...base, ...fromDepartments]));
  }, [departments]);

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
    form.reset({ name: '', email: '', password: '', role: 'CREATOR', divisionIds: [], subDivision: [], businessDivision: null });
    pendingDivisionChangeRef.current = null;
    setPendingRemoveDivision(null);
    setPendingOrphans([]);
    setShowPasswordField(false);
  };

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      message.success('User created successfully');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      closeModal();
    },
    onError: (error: any) => handleMutationError(error, 'Failed to create user'),
  });

  const updateUserMutation = useMutation({
    mutationFn: (data: any) => updateUser(selectedUser!.id, data),
    onSuccess: () => {
      message.success('User updated successfully');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      closeModal();
    },
    onError: (error: any) => handleMutationError(error, 'Failed to update user'),
  });

  const handleMutationError = (error: any, defaultMsg: string) => {
    let errorMessage = defaultMsg;
    const apiError = error?.response?.data?.error;
    if (typeof apiError === 'string') errorMessage = apiError;
    else if (Array.isArray(apiError)) errorMessage = apiError.map((e: any) => e.message || JSON.stringify(e)).join(', ');
    else if (typeof apiError === 'object' && apiError !== null) errorMessage = apiError.message || JSON.stringify(apiError);
    message.error(errorMessage);
  };

  const deactivateUserMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => {
      message.success('User deactivated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: any) => message.error(error?.response?.data?.error || 'Failed to deactivate user'),
  });

  const onSubmit = (values: UserValues) => {
    if (!selectedUser && !values.password) {
      message.error('Password is required for new users');
      return;
    }
    const isGMRole = values.role === 'GM_APPROVER' || values.role === 'GM_CREATOR';
    const payload: any = {
      email: values.email,
      name: values.name,
      role: values.role,
      // GM roles carry no division — send null explicitly so the backend clears any old value
      division: isGMRole ? null : (values.divisionIds?.length ? values.divisionIds : undefined),
      subDivision: values.subDivision,
      businessDivision: values.businessDivision ?? null,
    };
    if (values.password) payload.password = values.password;

    if (selectedUser) updateUserMutation.mutate(payload);
    else createUserMutation.mutate(payload);
  };

  const handleEditUser = (u: AdminUser) => {
    setSelectedUser(u);
    const isGMRole = u.role === 'GM_APPROVER' || u.role === 'GM_CREATOR';
    // GM roles have no division — only sub-divisions from the GM hierarchy
    const divisionIds = isGMRole
      ? []
      : parseSubDivisionList(u.division).map((d) => formatDivisionLabel(d.trim()).toUpperCase());
    form.reset({
      name: u.name,
      email: u.email,
      role: u.role as UserValues['role'],
      divisionIds,
      subDivision: parseSubDivisionList(u.subDivision),
      businessDivision: u.businessDivision ?? null,
      password: '',
    });
    setIsModalOpen(true);
  };

  const handleDivisionChange = (newIds: string[]) => {
    const currentIds = form.getValues('divisionIds') ?? [];
    const removed = currentIds.find((id) => !newIds.includes(id));

    if (!removed) {
      form.setValue('divisionIds', newIds, { shouldValidate: true });
      return;
    }

    const normalise = (s: string) => s.trim().toUpperCase().replace(/S$/, '');
    const removedDept = departments.find((d) => normalise(String(d.name || '')) === normalise(removed));
    const removedCodes = new Set((removedDept?.subDepartments || []).map((s) => s.code));

    const remainingDepts = departments.filter((d) =>
      newIds.some((id) => normalise(String(d.name || '')) === normalise(id))
    );
    const remainingCodes = new Set(remainingDepts.flatMap((d) => (d.subDepartments || []).map((s) => s.code)));

    const currentSubDivisions = form.getValues('subDivision') ?? [];
    const orphans = currentSubDivisions.filter((code) => removedCodes.has(code) && !remainingCodes.has(code));

    if (orphans.length > 0) {
      pendingDivisionChangeRef.current = { newIds, orphans };
      setPendingOrphans(orphans);
      setPendingRemoveDivision(removed);
    } else {
      form.setValue('divisionIds', newIds, { shouldValidate: true });
    }
  };

  const confirmDivisionRemoval = () => {
    const pending = pendingDivisionChangeRef.current;
    if (!pending) return;
    form.setValue('divisionIds', pending.newIds, { shouldValidate: true });
    const currentSubDivisions = form.getValues('subDivision') ?? [];
    form.setValue('subDivision', currentSubDivisions.filter((c) => !pending.orphans.includes(c)));
    pendingDivisionChangeRef.current = null;
    setPendingRemoveDivision(null);
    setPendingOrphans([]);
  };

  const cancelDivisionRemoval = () => {
    pendingDivisionChangeRef.current = null;
    setPendingRemoveDivision(null);
    setPendingOrphans([]);
  };

  const downloadBulkTemplate = async () => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'AI Fashion Extractor';
      workbook.created = new Date();

      const usersSheet = workbook.addWorksheet('Users');
      const listSheet = workbook.addWorksheet('Lists');
      listSheet.state = 'hidden';

      const headers = ['name', 'email', 'password', 'role', 'division', 'subDivision', 'businessDivision'];
      usersSheet.columns = headers.map((h) => ({ header: h, key: h, width: 24 }));
      usersSheet.getRow(1).font = { bold: true };
      usersSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      usersSheet.addRow(['John Creator', 'john.creator@company.com', 'Temp@123', 'CREATOR', 'MENS', 'ML', 'MENS']);
      usersSheet.addRow(['Rita CategoryHead', 'rita.head@company.com', 'Temp@123', 'CATEGORY_HEAD', 'LADIES', '', 'LADIES']);

      const roleOptions = ['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD', 'BODY_APPROVER', 'FABRIC_APPROVER', 'PLANNING', 'GM_APPROVER', 'GM_CREATOR'];
      const divisionOptions = divisionNames;
      const subDivisionOptions = Array.from(
        new Set(departments.flatMap((d) => (d.subDepartments || []).map((s) => s.code).filter(Boolean))),
      );
      const businessDivisionOptions = [...BUSINESS_DIVISIONS];

      listSheet.getColumn(1).values = [undefined, ...roleOptions];
      listSheet.getColumn(2).values = [undefined, ...divisionOptions];
      listSheet.getColumn(3).values = [undefined, ...subDivisionOptions];
      listSheet.getColumn(4).values = [undefined, ...businessDivisionOptions];

      const roleRange = `Lists!$A$2:$A$${Math.max(roleOptions.length + 1, 2)}`;
      const divisionRange = `Lists!$B$2:$B$${Math.max(divisionOptions.length + 1, 2)}`;
      const subDivisionRange = `Lists!$C$2:$C$${Math.max(subDivisionOptions.length + 1, 2)}`;
      const businessDivisionRange = `Lists!$D$2:$D$${Math.max(businessDivisionOptions.length + 1, 2)}`;

      for (let row = 2; row <= 500; row += 1) {
        usersSheet.getCell(`D${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [roleRange], showErrorMessage: true, errorStyle: 'warning' };
        usersSheet.getCell(`E${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [divisionRange], showErrorMessage: true, errorStyle: 'warning' };
        usersSheet.getCell(`F${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [subDivisionRange], showErrorMessage: true, errorStyle: 'warning' };
        usersSheet.getCell(`G${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [businessDivisionRange], showErrorMessage: true, errorStyle: 'warning' };
      }

      usersSheet.getCell('I1').value = 'Notes';
      usersSheet.getCell('I2').value = 'CREATOR/APPROVER: division + subDivision required';
      usersSheet.getCell('I3').value = 'CATEGORY_HEAD: division required, subDivision optional';
      usersSheet.getCell('I4').value = 'ADMIN: division/subDivision optional';
      usersSheet.getCell('I5').value = 'PO_COMMITTEE: division/subDivision not required (free selection at extraction)';
      usersSheet.getCell('I6').value = 'businessDivision (MENS/KIDS/LADIES/PO/MDM) is optional and independent of division/subDivision — leave blank to set later from the Users page.';

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `user-bulk-template-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to generate template', error);
      message.error('Failed to download template');
    }
  };

  const parseCell = (value: unknown): string => String(value ?? '').trim();

  const handleBulkFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.Sheets['Users'] ? 'Users' : workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      if (!rows.length) {
        message.warning('No rows found in uploaded file');
        return;
      }

      const toRole = (roleRaw: string): AdminUser['role'] | null => {
        const role = roleRaw.toUpperCase();
        if (['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD', 'BODY_APPROVER', 'FABRIC_APPROVER', 'PLANNING', 'GM_APPROVER', 'GM_CREATOR'].includes(role))
          return role as AdminUser['role'];
        return null;
      };

      const divisionToSubDivision = new Map<string, Set<string>>();
      departments.forEach((dept) => {
        const key = formatDivisionLabel(String(dept.name || '')).toUpperCase();
        const set = new Set((dept.subDepartments || []).map((s) => String(s.code || '').trim().toUpperCase()).filter(Boolean));
        if (key) divisionToSubDivision.set(key, set);
      });

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const line = index + 2;
        const name = parseCell(row.name);
        const email = parseCell(row.email).toLowerCase();
        const password = parseCell(row.password);
        const role = toRole(parseCell(row.role));
        const division = parseCell(row.division) || undefined;
        const subDivisionValues = parseSubDivisionList(parseCell(row.subDivision));
        const subDivision = subDivisionValues.length ? subDivisionValues : undefined;
        const businessDivisionRaw = parseCell(row.businessDivision).toUpperCase();
        const businessDivision = (BUSINESS_DIVISIONS as readonly string[]).includes(businessDivisionRaw)
          ? (businessDivisionRaw as (typeof BUSINESS_DIVISIONS)[number])
          : undefined;
        if (businessDivisionRaw && !businessDivision) {
          failed += 1;
          errors.push(`Row ${line}: businessDivision "${businessDivisionRaw}" must be one of ${BUSINESS_DIVISIONS.join(', ')}`);
          continue;
        }

        if (!name || !email || !password || !role) {
          failed += 1;
          errors.push(`Row ${line}: name/email/password/role are required`);
          continue;
        }
        if ((role === 'CREATOR' || role === 'APPROVER' || role === 'SUB_DIVISION_HEAD') && (!division || !subDivision)) {
          failed += 1;
          errors.push(`Row ${line}: division + subDivision required for ${role}`);
          continue;
        }
        if (role === 'CATEGORY_HEAD' && !division) {
          failed += 1;
          errors.push(`Row ${line}: division required for ${role}`);
          continue;
        }
        if ((role === 'CREATOR' || role === 'APPROVER' || role === 'SUB_DIVISION_HEAD') && division && subDivisionValues.length > 0) {
          const allowed = divisionToSubDivision.get(formatDivisionLabel(division).toUpperCase());
          const invalid = subDivisionValues.filter((sd) => !allowed?.has(sd.toUpperCase()));
          if (allowed && allowed.size > 0 && invalid.length > 0) {
            failed += 1;
            errors.push(`Row ${line}: subDivision ${invalid.join(', ')} is not valid for division ${division}`);
            continue;
          }
        }

        try {
          await createUser({
            name,
            email,
            password,
            role,
            division: role === 'PO_COMMITTEE' || role === 'PD' || role === 'BODY_APPROVER' || role === 'FABRIC_APPROVER' || role === 'PLANNING' || role === 'GM_APPROVER' || role === 'GM_CREATOR' ? undefined : division,
            subDivision:
              role === 'CATEGORY_HEAD' || role === 'PO_COMMITTEE' || role === 'ADMIN' || role === 'PD' || role === 'BODY_APPROVER' || role === 'FABRIC_APPROVER' || role === 'PLANNING'
                ? undefined
                : subDivision,
            businessDivision,
          });
          success += 1;
        } catch (error: any) {
          failed += 1;
          errors.push(`Row ${line}: ${error?.response?.data?.error || error?.message || 'Unknown error'}`);
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });

      if (success > 0) message.success(`Bulk upload completed: ${success} created, ${failed} failed`);
      else message.error(`Bulk upload failed for all rows (${failed})`);

      if (errors.length > 0) {
        console.warn('Bulk upload errors:', errors);
        message.warning(`Some rows failed. Check console for details (${errors.length} errors).`);
      }
    } catch (error) {
      console.error('Bulk upload parse failed', error);
      message.error('Invalid file. Please upload the provided Excel template.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const columns: DataTableColumn<AdminUser>[] = [
    {
      title: 'User',
      key: 'user',
      render: (_v, record) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[12.5px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {initialsOf(record.name)}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-semibold text-foreground" title={record.name}>{record.name}</span>
            <span className="truncate text-[12.5px] text-muted-foreground" title={record.email}>{record.email}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: AdminUser['role']) => (
        <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold', ROLE_TONE_CLASSES[ROLE_TONE[role] ?? 'approver'])}>
          {roleLabel(role)}
        </span>
      ),
    },
    {
      title: 'Access scope',
      key: 'scope',
      render: (_v, record) => (
        <ScopeCell user={record} expanded={expandedScopes.has(record.id)} onToggle={() => toggleScope(record.id)} />
      ),
    },
    {
      title: 'Business division',
      key: 'businessDivision',
      width: 150,
      render: (_v, record) =>
        record.businessDivision ? (
          <span className="text-[13px] text-foreground">{BUSINESS_DIVISION_LABELS[record.businessDivision]}</span>
        ) : (
          <span className="text-[13px] text-muted-foreground">Not set</span>
        ),
    },
    {
      title: 'Last login',
      dataIndex: 'lastLogin',
      key: 'lastLogin',
      width: 170,
      render: (v: string | null) => {
        const { relative, exact } = lastLoginParts(v);
        return (
          <div className="flex flex-col">
            <span className={cn('text-[13px] font-semibold', !exact && 'font-normal text-muted-foreground')}>{relative}</span>
            {exact && <span className="text-[12px] text-muted-foreground">{exact}</span>}
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 110,
      render: (active: boolean) => (
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className={cn('h-2 w-2 rounded-full', active ? 'bg-green-600' : 'bg-slate-400')} />
          {active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      title: <span className="block text-right">Actions</span>,
      key: 'actions',
      width: 100,
      align: 'right',
      render: (_v, record) => {
        const isSelf = userData?.id === record.id;
        const cannotDeactivate = !record.isActive || isSelf;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button size="icon" variant="outline" className="h-9 w-9" aria-label={`Edit ${record.name}`} title="Edit" onClick={() => handleEditUser(record)}>
              <Pencil />
            </Button>
            <Popconfirm
              title="Deactivate user"
              description="This will prevent the user from logging in. Continue?"
              onConfirm={() => deactivateUserMutation.mutate(record.id)}
              disabled={cannotDeactivate}
            >
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-500/10"
                aria-label={`Deactivate ${record.name}`}
                title={isSelf ? 'You cannot deactivate yourself' : record.isActive ? 'Deactivate' : 'Already inactive'}
                disabled={cannotDeactivate}
              >
                <UserX />
              </Button>
            </Popconfirm>
          </div>
        );
      },
    },
  ];

  const needsDivision =
    selectedRole === 'CREATOR' ||
    selectedRole === 'APPROVER' ||
    selectedRole === 'CATEGORY_HEAD' ||
    selectedRole === 'SUB_DIVISION_HEAD';
  const needsSubDivision =
    selectedRole === 'CREATOR' || selectedRole === 'APPROVER' || selectedRole === 'SUB_DIVISION_HEAD';
  const needsGMSubDivision =
    selectedRole === 'GM_APPROVER' || selectedRole === 'GM_CREATOR';


  return (
    <div className="p-3">
      <Card className="glass card-3d rounded-2xl border border-white/60 overflow-hidden">
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ background: 'linear-gradient(135deg, #1f2937 0%, #334155 100%)' }}
        >
          <div>
            <h3 className="mb-0.5 text-lg font-bold text-white">User Management</h3>
            <p className="text-xs text-white/60">Add users and manage access roles.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={downloadBulkTemplate} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <Download />
              Download Bulk Template
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <UploadIcon />
              Upload Filled Excel
            </Button>
            <Button onClick={() => setIsModalOpen(true)} className="bg-white font-bold text-slate-800 shadow-md hover:bg-slate-100">
              <Plus />
              Add User
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleBulkFileSelected}
            />
          </div>
        </div>
      </Card>

      <Card className="mt-4 glass rounded-2xl border border-white/60">
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
            <Input
              placeholder="Search name, email, sub-division, role…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-[340px] hover:border-slate-400 focus-within:border-slate-500 focus-within:ring-slate-400/25"
              allowClear
              onClear={() => setSearchTerm('')}
              prefix={<Search className="h-4 w-4" />}
            />
            <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-1.5">
              {[['ALL', searchedUsers.length] as const, ...roleChips].map(([role, count]) => {
                const active = roleFilter === role;
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRoleFilter(role)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors',
                      active ? cn('border-transparent', ACTIVE_SEGMENT_CLASS) : 'border-input bg-background text-foreground hover:bg-accent',
                    )}
                  >
                    {role === 'ALL' ? 'All roles' : roleLabel(role)}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex-1" />
            <div role="group" aria-label="Filter by status" className="flex h-9 items-center gap-0.5 rounded-md border border-input bg-background p-0.5 text-[13px]">
              {(['all', 'active', 'inactive'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'flex h-full items-center gap-1.5 rounded-sm px-2.5 font-medium transition-colors',
                    statusFilter === s ? ACTIVE_SEGMENT_CLASS : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  <span className="tabular-nums opacity-70">{statusCounts[s]}</span>
                </button>
              ))}
            </div>
          </div>
          <DataTable
            rowKey="id"
            columns={columns}
            dataSource={filteredUsers}
            loading={isLoading}
            rowClassName={(record) => (record.isActive ? '' : 'opacity-60')}
            pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100'] }}
            locale={{ emptyText: 'No users match these filters' }}
          />
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent className="flex max-h-[92vh] max-w-[580px] flex-col gap-0 p-0">
          <DialogHeader className="flex-row items-center gap-3.5 space-y-0 border-b border-border px-6 py-4 pr-14">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[15px] font-bold text-white dark:bg-slate-200 dark:text-slate-900">
              {selectedUser ? initialsOf(selectedUser.name) : <Plus className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg">{selectedUser ? 'Edit user' : 'Add user'}</DialogTitle>
              <p className="truncate text-[13px] text-muted-foreground">
                {selectedUser
                  ? `${selectedUser.name} · Last login ${lastLoginParts(selectedUser.lastLogin).relative.toLowerCase()}`
                  : 'Create an account and choose what they can access.'}
              </p>
            </div>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
                <section className="flex flex-col gap-3">
                  <SectionTitle>Account</SectionTitle>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Full name" prefix={<User className="h-4 w-4" />} className={SLATE_FIELD_CLASS} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {selectedUser ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Email</span>
                      <span className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-muted/50 px-3 text-sm text-muted-foreground">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{selectedUser.email}</span>
                      </span>
                      <span className="text-[12px] text-muted-foreground">Email is the login ID and can’t be changed.</span>
                    </div>
                  ) : (
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input placeholder="name@company.com" className={SLATE_FIELD_CLASS} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {!selectedUser || showPasswordField ? (
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>{selectedUser ? 'New password' : 'Password'}</FormLabel>
                            {selectedUser && (
                              <button
                                type="button"
                                onClick={() => { form.setValue('password', ''); setShowPasswordField(false); }}
                                className="text-[12.5px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                              >
                                Keep current password
                              </button>
                            )}
                          </div>
                          <FormControl>
                            <InputPassword
                              placeholder={selectedUser ? 'New password' : 'Temporary password'}
                              autoFocus={!!selectedUser}
                              className={SLATE_FIELD_CLASS}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowPasswordField(true)}
                      className="flex h-8 items-center gap-1.5 self-start text-[13px] font-semibold text-slate-800 underline underline-offset-2 dark:text-slate-200"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Set a new password
                    </button>
                  )}
                </section>

                <section className="flex flex-col gap-3">
                  <SectionTitle>Role</SectionTitle>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <FormControl>
                            <Select
                              onValueChange={(newRole) => {
                                const wasGM = field.value === 'GM_APPROVER' || field.value === 'GM_CREATOR';
                                const isGM = newRole === 'GM_APPROVER' || newRole === 'GM_CREATOR';
                                if (wasGM !== isGM) {
                                  form.setValue('divisionIds', [], { shouldDirty: true });
                                  form.setValue('subDivision', [], { shouldDirty: true });
                                }
                                field.onChange(newRole);
                              }}
                              value={field.value}
                            >
                              <SelectTrigger className={SLATE_FIELD_CLASS}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD', 'BODY_APPROVER', 'FABRIC_APPROVER', 'PLANNING', 'GM_APPROVER', 'GM_CREATOR'] as const).map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {roleLabel(r)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="businessDivision"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business division</FormLabel>
                          <FormControl>
                            <Select
                              onValueChange={(v) => field.onChange(v === '__NONE__' ? null : v)}
                              value={field.value ?? '__NONE__'}
                            >
                              <SelectTrigger className={SLATE_FIELD_CLASS}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__NONE__">Not set</SelectItem>
                                {BUSINESS_DIVISIONS.map((d) => (
                                  <SelectItem key={d} value={d}>
                                    {BUSINESS_DIVISION_LABELS[d]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </section>

                {needsDivision && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <SectionTitle>Access scope</SectionTitle>
                      {needsSubDivision && (
                        <span className="text-[12.5px] text-muted-foreground">
                          {selectedSubDivisions.length} sub-division{selectedSubDivisions.length === 1 ? '' : 's'} selected
                        </span>
                      )}
                    </div>
                    <span className="text-[12.5px] text-muted-foreground">
                      {needsSubDivision
                        ? `${roleLabel(selectedRole)}s need a division and at least one sub-division.`
                        : `Pick the division(s) this ${roleLabel(selectedRole).toLowerCase()} covers.`}
                    </span>
                    <AccessScopeEditor
                      divisionNames={divisionNames}
                      departments={departments}
                      divisionIds={selectedDivisionIds}
                      subDivisions={selectedSubDivisions}
                      showSubDivisions={needsSubDivision}
                      onDivisionsChange={handleDivisionChange}
                      onSubDivisionsChange={(codes) => form.setValue('subDivision', codes, { shouldDirty: true })}
                    />
                  </section>
                )}

                {needsGMSubDivision && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <SectionTitle>GM Sub-Divisions</SectionTitle>
                      <span className="text-[12.5px] text-muted-foreground">
                        {selectedSubDivisions.length} selected
                      </span>
                    </div>
                    <span className="text-[12.5px] text-muted-foreground">
                      Pick which GM sub-divisions this user can see and work on.
                    </span>
                    {(() => {
                      const allGMSubDivs = gmSubDivData?.subDivisions ?? [];
                      const divBySubDiv = gmSubDivData?.divBySubDiv ?? {};
                      const selected = new Set(selectedSubDivisions);

                      // Group by division
                      const byDiv: Record<string, string[]> = {};
                      allGMSubDivs.forEach((sd) => {
                        const div = divBySubDiv[sd] ?? 'Other';
                        if (!byDiv[div]) byDiv[div] = [];
                        byDiv[div].push(sd);
                      });

                      const chipClass = (on: boolean) => cn(
                        'h-8 rounded-md border px-2.5 font-mono text-[12px] transition-colors',
                        on ? cn(SLATE_SELECTED_CLASS, 'font-semibold') : 'border-input bg-background text-muted-foreground hover:border-slate-400 hover:text-foreground',
                      );

                      const toggleSD = (sd: string) => {
                        const next = selected.has(sd)
                          ? selectedSubDivisions.filter((c) => c !== sd)
                          : [...selectedSubDivisions, sd];
                        form.setValue('subDivision', next, { shouldDirty: true });
                      };

                      return (
                        <div className="flex flex-col gap-3">
                          {Object.entries(byDiv).map(([div, subs]) => {
                            const count = subs.filter((s) => selected.has(s)).length;
                            const full = subs.length > 0 && count === subs.length;
                            return (
                              <div key={div} className="flex flex-col gap-2.5 rounded-xl border border-border px-3.5 py-3">
                                <div className="flex items-center gap-2">
                                  <strong className="text-[13.5px]">{div}</strong>
                                  <span className="text-[12.5px] text-muted-foreground">{count} of {subs.length}</span>
                                  <div className="flex-1" />
                                  {subs.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = full
                                          ? selectedSubDivisions.filter((c) => !subs.includes(c))
                                          : [...selectedSubDivisions, ...subs.filter((s) => !selected.has(s))];
                                        form.setValue('subDivision', next, { shouldDirty: true });
                                      }}
                                      className="px-1 text-[12.5px] font-semibold text-slate-800 underline underline-offset-2 dark:text-slate-200"
                                    >
                                      {full ? 'Clear all' : 'Select all'}
                                    </button>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {subs.map((sd) => (
                                    <button key={sd} type="button" aria-pressed={selected.has(sd)} onClick={() => toggleSD(sd)} className={chipClass(selected.has(sd))}>
                                      {sd}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          {allGMSubDivs.length === 0 && (
                            <span className="text-[12.5px] text-muted-foreground">No GM sub-divisions found.</span>
                          )}
                        </div>
                      );
                    })()}
                  </section>
                )}
              </div>

              <div className="flex items-center gap-2.5 border-t border-border bg-muted/40 px-6 py-3.5">
                {selectedUser && selectedUser.isActive && userData?.id !== selectedUser.id && (
                  <Popconfirm
                    title="Deactivate user"
                    description="This will prevent the user from logging in. Continue?"
                    onConfirm={() => deactivateUserMutation.mutate(selectedUser.id, { onSuccess: closeModal })}
                  >
                    <Button type="button" variant="ghost" className="px-1.5 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-500/10">
                      Deactivate user
                    </Button>
                  </Popconfirm>
                )}
                <div className="flex-1" />
                <Button type="button" variant="outline" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createUserMutation.isPending || updateUserMutation.isPending}
                  className="bg-slate-800 font-semibold text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  {selectedUser ? 'Save changes' : 'Create user'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingRemoveDivision} onOpenChange={(o) => !o && cancelDivisionRemoval()}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Remove Division</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Removing <strong>{pendingRemoveDivision}</strong> will also deselect{' '}
            {pendingOrphans.length} sub-division(s):{' '}
            <strong>{pendingOrphans.join(', ')}</strong>. Continue?
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelDivisionRemoval}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDivisionRemoval}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
