import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, Lock, LogOut, RotateCw, User, X } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, Spinner } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';
import { BackendApiService } from '../../../services/api/backendApi';
import { clearAuthSession, redirectToLoginOnce } from '../../../shared/utils/auth/navigation';

const api = new BackendApiService();

interface ProfileUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  division?: string | null;
  subDivision?: string | null;
  businessDivision?: string | null;
  articleTypes?: string[];
  isActive?: boolean;
  createdAt: string;
  lastLogin?: string;
}

const initialsOf = (name?: string, email?: string) => {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
};
const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    : '—';
const splitList = (v?: string | null) => String(v ?? '').split(/[;,|]+/).map((s) => s.trim()).filter(Boolean);

const Chip = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => (
  <span
    className={cn(
      'rounded-full px-2.5 py-0.5 text-xs font-bold',
      dark ? 'bg-white/10 text-slate-200' : 'border border-slate-200 bg-slate-100 text-slate-700',
    )}
  >
    {children}
  </span>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className="text-[11px] font-bold tracking-[0.06em] text-slate-500">{label}</span>
    <span className="break-words text-sm font-medium text-slate-900">{children}</span>
  </div>
);

const SectionCard = ({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) => (
  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex items-center gap-2 border-b border-slate-200 px-[18px] py-3 text-slate-800">
      {icon}
      <h2 className="m-0 text-sm font-bold">{title}</h2>
    </div>
    <div className="p-[18px]">{children}</div>
  </section>
);

function PasswordInput({
  id, label, value, onChange, error, autoFocus,
}: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-slate-700">{label}</label>
      <div
        className={cn(
          'flex h-10 items-center rounded-lg border-[1.5px] bg-white pl-3 focus-within:border-[#1e293b] focus-within:ring-2 focus-within:ring-slate-200',
          error ? 'border-red-600' : 'border-slate-300',
        )}
      >
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="flex h-full w-10 items-center justify-center text-slate-400 hover:text-slate-700"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setCurrent(''); setNext(''); setConfirm(''); setServerError(null); }
  }, [open]);

  const rules = [
    { label: 'At least 8 characters', ok: next.length >= 8 },
    { label: 'A number', ok: /\d/.test(next) },
    { label: 'Different from current password', ok: next !== '' && next !== current },
  ];
  const mismatch = confirm !== '' && confirm !== next;
  const canSubmit = !!current && rules.every((r) => r.ok) && confirm === next && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setServerError(null);
    try {
      await api.changePassword(current, next);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to change password');
      setSaving(false);
      return;
    }
    // The server now refuses every token issued before the change, this device's too.
    message.success('Password changed. Please log in again with the new password.');
    setTimeout(() => {
      clearAuthSession();
      redirectToLoginOnce();
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent showClose={false} className="max-w-[420px] gap-0 p-0 outline-none">
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="flex items-center gap-2.5 px-5 pb-1.5 pt-[18px]">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-slate-100">
              <KeyRound className="h-[18px] w-[18px] text-[#1e293b]" />
            </span>
            <DialogTitle className="text-[19px]">Change password</DialogTitle>
            <button
              type="button"
              aria-label="Close"
              disabled={saving}
              onClick={() => onOpenChange(false)}
              className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3.5 px-5 py-3.5">
            <p className="m-0 text-[12.5px] text-slate-500">You will be logged out on every device, this one included.</p>
            <PasswordInput
              id="pw-current"
              label="Current password"
              value={current}
              autoFocus
              onChange={(v) => { setCurrent(v); setServerError(null); }}
              error={serverError ?? undefined}
            />
            <PasswordInput id="pw-new" label="New password" value={next} onChange={setNext} />
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {rules.map((r) => (
                <li key={r.label} className={cn('flex items-center gap-1.5 text-[12.5px]', r.ok ? 'text-slate-900' : 'text-slate-500')}>
                  {r.ok
                    ? <Check className="h-3.5 w-3.5 text-[#1e293b]" strokeWidth={3} />
                    : <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-slate-300" />}
                  {r.label}
                </li>
              ))}
            </ul>
            <PasswordInput
              id="pw-confirm"
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              error={mismatch ? 'Passwords don’t match' : undefined}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit} className="bg-[#1e293b] text-white hover:bg-[#0f172a]">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</> : 'Update password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Profile() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const userData = await api.getMe();
      setUser(userData);
    } catch (error) {
      message.error('Failed to load profile');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuthSession();
    redirectToLoginOnce();
  };

  if (!user && !loading) {
    return (
      <div className="flex justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="m-0">Please log in to view your profile.</p>
          <Button asChild className="mt-4 bg-[#1e293b] text-white hover:bg-[#0f172a]">
            <a href="/login">Log in</a>
          </Button>
        </div>
      </div>
    );
  }

  const onInkBtn = 'border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white';
  const subDivs = splitList(user?.subDivision);

  return (
    <div className="flex justify-center p-6">
      <Spinner spinning={loading} className="w-full max-w-[860px]">
        {user && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-[18px] rounded-[14px] bg-[#1e293b] px-6 py-[22px] text-white">
              <span className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-white text-[26px] font-bold text-[#1e293b]">
                {initialsOf(user.name, user.email)}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="m-0 font-display text-2xl font-semibold text-white">{user.name || user.email}</h1>
                <span className="text-[13.5px] text-slate-300">{user.email}</span>
                <span className="flex flex-wrap gap-1.5">
                  <Chip dark>{user.role}</Chip>
                  {user.businessDivision && <Chip dark>{user.businessDivision}</Chip>}
                </span>
              </div>
              <span className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={loadProfile} disabled={loading} className={onInkBtn}>
                  <RotateCw className="h-3.5 w-3.5" /> Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={handleLogout} className={onInkBtn}>
                  <LogOut className="h-3.5 w-3.5" /> Log out
                </Button>
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SectionCard title="Account" icon={<User className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-x-6 gap-y-[18px]">
                  <Field label="USER ID"><span className="font-mono">{user.id}</span></Field>
                  <Field label="MEMBER SINCE">{fmtDate(user.createdAt)}</Field>
                  <Field label="EMAIL">{user.email}</Field>
                  <Field label="STATUS">{user.isActive === false ? 'Disabled' : 'Active'}</Field>
                </div>
              </SectionCard>
              <SectionCard title="Work scope">
                <div className="grid grid-cols-2 gap-x-6 gap-y-[18px]">
                  <Field label="BUSINESS DIVISION">{user.businessDivision || '—'}</Field>
                  <Field label="DIVISION">{splitList(user.division).join(', ') || '—'}</Field>
                  <Field label="SUB-DIVISIONS">{subDivs.length ? subDivs.join(', ') : '—'}</Field>
                  <Field label="ARTICLE TYPES">
                    {user.articleTypes?.length
                      ? <span className="flex flex-wrap gap-1.5">{user.articleTypes.map((t) => <Chip key={t}>{t}</Chip>)}</span>
                      : '—'}
                  </Field>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Security" icon={<Lock className="h-4 w-4" />}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-slate-900">Password</span>
                  <span className="text-[12.5px] text-slate-500">Last signed in {fmtDateTime(user.lastLogin)}</span>
                </div>
                <Button onClick={() => setPwOpen(true)} className="ml-auto bg-[#1e293b] text-white hover:bg-[#0f172a]">
                  <KeyRound className="h-4 w-4" /> Change password
                </Button>
              </div>
            </SectionCard>
          </div>
        )}
      </Spinner>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}
