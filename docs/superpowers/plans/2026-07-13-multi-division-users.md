# Multi-Division User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to belong to multiple divisions (e.g. MENS + KIDS) instead of one, storing them as a comma-separated string in the existing `division` column.

**Architecture:** Backend adds `normalizeDivisionInput()` and updates schemas/handlers to accept `string | string[]` for division, mirroring the existing `subDivision` pattern. Frontend replaces the single-select Division `<Select>` with the existing `<MultiSelect>` component, computes available sub-departments as the union of all selected divisions, and prompts before auto-removing orphaned sub-divisions when a division is deselected.

**Tech Stack:** TypeScript, React, react-hook-form + zod, @tanstack/react-query, Prisma (Postgres), existing `<MultiSelect>` and `<Popconfirm>` components.

---

## Files Modified

| File | Change |
|------|--------|
| `Backend/src/controllers/adminController.ts` | Add `normalizeDivisionInput()`, update `AdminCreateUserSchema`, update `createUser()` and `updateUser()` |
| `Frontend/src/features/admin/pages/UsersManagement.tsx` | Replace `departmentId` → `divisionIds[]`, swap `<Select>` → `<MultiSelect>` for Division, union sub-dept filtering, removal confirmation dialog |

No DB migration. No new files.

---

## Task 1: Backend — add `normalizeDivisionInput` and update schema

**Files:**
- Modify: `Backend/src/controllers/adminController.ts:64-91`

- [ ] **Step 1: Add `normalizeDivisionInput` and update `AdminCreateUserSchema`**

In `adminController.ts`, directly after the closing `};` of `normalizeSubDivisionInput` (line 91), add the new helper. Also update the `division` field in `AdminCreateUserSchema` (line 69) from `z.string().optional().nullable()` to accept arrays.

Replace lines 64–91:
```ts
const AdminCreateUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  name: z.string().min(1).max(100),
  role: z.enum(['ADMIN', 'USER', 'CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'PD_DESIGNER', 'PD']).optional().default('USER'),
  division: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  subDivision: z.union([z.string(), z.array(z.string())]).optional().nullable(),
});

const AdminUpdateUserSchema = AdminCreateUserSchema.partial().extend({
  password: z.string().min(6).max(128).optional(),
});

const normalizeSubDivisionInput = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;

  const tokens = Array.isArray(value)
    ? value.map((item) => String(item || '').trim())
    : String(value)
        .split(/[;,|]+/)
        .map((item) => String(item || '').trim());

  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) return null;
  return unique.join(',');
};

const normalizeDivisionInput = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;

  const tokens = Array.isArray(value)
    ? value.map((item) => String(item || '').trim())
    : String(value)
        .split(/[;,|]+/)
        .map((item) => String(item || '').trim());

  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) return null;
  return unique.join(',');
};
```

- [ ] **Step 2: Update `createUser()` to normalize division**

In `createUser()` (around line 1147), add normalization of `division` right after parsing, and replace all direct uses of `validated.division` with `normalizedDivision`.

Replace the top of `createUser` (after `const validated = AdminCreateUserSchema.parse(req.body);`):
```ts
const validated = AdminCreateUserSchema.parse(req.body);
const normalizedDivision = normalizeDivisionInput(validated.division);
const normalizedSubDivision = normalizeSubDivisionInput(validated.subDivision);

if ((validated.role === 'CREATOR' || validated.role === 'APPROVER' || validated.role === 'SUB_DIVISION_HEAD') && (!normalizedDivision || !normalizedSubDivision)) {
  res.status(400).json({ success: false, error: 'Division and Sub-Division are required for this role' });
  return;
}

if (validated.role === 'CATEGORY_HEAD' && !normalizedDivision) {
  res.status(400).json({ success: false, error: 'Division is required for Category Head' });
  return;
}
```

Then replace both `division: validated.role === 'PO_COMMITTEE' ? null : validated.division` occurrences (reactivation update + create) with:
```ts
division: validated.role === 'PO_COMMITTEE' ? null : normalizedDivision,
```

- [ ] **Step 3: Update `updateUser()` to normalize division**

In `updateUser()` (around line 1235), add normalization and use it throughout.

Replace the lines that compute `finalDivision` and build `updateData`:
```ts
const finalDivision = validated.division !== undefined
  ? normalizeDivisionInput(validated.division)
  : existingUser.division;
const finalSubDivision = validated.subDivision !== undefined
  ? normalizeSubDivisionInput(validated.subDivision)
  : existingUser.subDivision;

if ((finalRole === 'CREATOR' || finalRole === 'APPROVER' || finalRole === 'SUB_DIVISION_HEAD') && (!finalDivision || !finalSubDivision)) {
  res.status(400).json({ success: false, error: 'Division and Sub-Division are required for this role' });
  return;
}

if (finalRole === 'CATEGORY_HEAD' && !finalDivision) {
  res.status(400).json({ success: false, error: 'Division is required for Category Head' });
  return;
}

const updateData: any = {
  name: validated.name,
  role: validated.role as any,
  division: finalRole === 'PO_COMMITTEE' ? null : (validated.division !== undefined ? normalizeDivisionInput(validated.division) : undefined),
  subDivision: (finalRole === 'CATEGORY_HEAD' || finalRole === 'PO_COMMITTEE' || finalRole === 'ADMIN') ? null : (validated.subDivision !== undefined ? normalizeSubDivisionInput(validated.subDivision) : undefined),
  email: validated.email ? validated.email.toLowerCase() : undefined,
};
```

- [ ] **Step 4: Commit backend changes**
```bash
git add Backend/src/controllers/adminController.ts
git commit -m "feat: support multiple divisions per user in admin API"
```

---

## Task 2: Frontend — schema, state, and sub-dept filtering

**Files:**
- Modify: `Frontend/src/features/admin/pages/UsersManagement.tsx:58-105`

- [ ] **Step 1: Update zod schema and form default values**

Replace the `userSchema` definition (lines 58–78) with:
```ts
const userSchema = z.object({
  name: z.string().min(1, 'Please enter name'),
  email: z.string().email('Enter a valid email').min(1, 'Please enter email'),
  password: z.string().optional(),
  role: z.enum(['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD']),
  divisionIds: z.array(z.string()).optional(),
  subDivision: z.array(z.string()).optional(),
});
type UserValues = z.infer<typeof userSchema>;
```

Update the `useForm` default values (line 77):
```ts
defaultValues: { name: '', email: '', password: '', role: 'CREATOR', divisionIds: [], subDivision: [] },
```

- [ ] **Step 2: Update watched field and sub-dept filtering**

Replace lines 79–80:
```ts
const selectedRole = form.watch('role');
const selectedDivisionIds = form.watch('divisionIds') ?? [];
```

Replace the `availableSubDepts` useMemo (lines 95–105):
```ts
const availableSubDepts = useMemo(() => {
  if (!selectedDivisionIds.length) return [];
  const normalise = (s: string) => s.trim().toUpperCase().replace(/S$/, '');
  const matchedDepts = departments.filter((d) =>
    selectedDivisionIds.some((id) => normalise(String(d.name || '')) === normalise(id))
  );
  const fromDepts: { id: number; code: string; name: string }[] = matchedDepts.flatMap((d) => d.subDepartments || []);
  const existingCodes = form.getValues('subDivision') ?? [];
  const extra = existingCodes
    .filter((code) => !fromDepts.some((s) => s.code === code))
    .map((code) => ({ id: -1, code, name: code }));
  return [...fromDepts, ...extra];
}, [selectedDivisionIds, departments, form]);
```

- [ ] **Step 3: Update `closeModal` reset**

Replace the `form.reset` inside `closeModal` (line 132):
```ts
form.reset({ name: '', email: '', password: '', role: 'CREATOR', divisionIds: [], subDivision: [] });
```

- [ ] **Step 4: Update `handleEditUser` to parse division as array**

Replace the `handleEditUser` function (lines 191–203):
```ts
const handleEditUser = (u: AdminUser) => {
  setSelectedUser(u);
  const divisionIds = parseSubDivisionList(u.division).map((d) =>
    formatDivisionLabel(d.trim()).toUpperCase()
  );
  form.reset({
    name: u.name,
    email: u.email,
    role: u.role as UserValues['role'],
    divisionIds,
    subDivision: parseSubDivisionList(u.subDivision),
    password: '',
  });
  setIsModalOpen(true);
};
```

- [ ] **Step 5: Update `onSubmit` payload**

Replace the `payload` construction inside `onSubmit` (lines 178–184):
```ts
const payload: any = {
  email: values.email,
  name: values.name,
  role: values.role,
  division: values.divisionIds?.length ? values.divisionIds : undefined,
  subDivision: values.subDivision,
};
```

---

## Task 3: Frontend — Division MultiSelect UI with removal confirmation

**Files:**
- Modify: `Frontend/src/features/admin/pages/UsersManagement.tsx` (modal section + state)

- [ ] **Step 1: Add removal-confirmation state**

After the `const [searchTerm, setSearchTerm] = useState<string>('');` line (line 72), add:
```ts
const [pendingRemoveDivision, setPendingRemoveDivision] = useState<string | null>(null);
```

- [ ] **Step 2: Add division removal handler**

Add this function after `handleEditUser` (after line 203):
```ts
const handleDivisionChange = (newIds: string[]) => {
  const currentIds = form.getValues('divisionIds') ?? [];
  const removed = currentIds.find((id) => !newIds.includes(id));

  if (!removed) {
    // Division added — just update
    form.setValue('divisionIds', newIds, { shouldValidate: true });
    return;
  }

  // Check for orphaned sub-divisions: sub-divs whose parent dept is only the removed division
  const normalise = (s: string) => s.trim().toUpperCase().replace(/S$/, '');
  const removedDept = departments.find((d) => normalise(String(d.name || '')) === normalise(removed));
  const removedCodes = new Set((removedDept?.subDepartments || []).map((s) => s.code));

  // Remaining divisions after removal
  const remainingIds = newIds;
  const remainingDepts = departments.filter((d) =>
    remainingIds.some((id) => normalise(String(d.name || '')) === normalise(id))
  );
  const remainingCodes = new Set(remainingDepts.flatMap((d) => (d.subDepartments || []).map((s) => s.code)));

  const currentSubDivisions = form.getValues('subDivision') ?? [];
  const orphans = currentSubDivisions.filter((code) => removedCodes.has(code) && !remainingCodes.has(code));

  if (orphans.length > 0) {
    setPendingRemoveDivision(removed);
    // Store newIds and orphans for use after confirmation
    (window as any).__pendingDivisionChange = { newIds, orphans };
  } else {
    form.setValue('divisionIds', newIds, { shouldValidate: true });
  }
};

const confirmDivisionRemoval = () => {
  const { newIds, orphans } = (window as any).__pendingDivisionChange ?? {};
  if (!newIds) return;
  form.setValue('divisionIds', newIds, { shouldValidate: true });
  const currentSubDivisions = form.getValues('subDivision') ?? [];
  form.setValue('subDivision', currentSubDivisions.filter((c) => !orphans.includes(c)));
  setPendingRemoveDivision(null);
  delete (window as any).__pendingDivisionChange;
};

const cancelDivisionRemoval = () => {
  setPendingRemoveDivision(null);
  delete (window as any).__pendingDivisionChange;
};
```

- [ ] **Step 3: Replace Division `<Select>` with `<MultiSelect>`**

Replace the entire `{needsDivision && (...)}` block (lines 583–617) with:
```tsx
{needsDivision && (
  <FormField
    control={form.control}
    name="divisionIds"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Division</FormLabel>
        <FormControl>
          <MultiSelect
            options={divisionNames.map((name) => ({ value: name, label: name }))}
            value={field.value ?? []}
            onChange={handleDivisionChange}
            placeholder="Select Division(s)"
            searchable
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
)}
```

- [ ] **Step 4: Update Sub-Division `disabled` prop**

In the Sub-Division `<MultiSelect>` (line 634), replace `disabled={!selectedDeptId}` with:
```tsx
disabled={!selectedDivisionIds.length}
```

- [ ] **Step 5: Add removal confirmation dialog**

Add this just before the closing `</Dialog>` tag (before line 657):
```tsx
<Dialog open={!!pendingRemoveDivision} onOpenChange={(o) => !o && cancelDivisionRemoval()}>
  <DialogContent className="max-w-[400px]">
    <DialogHeader>
      <DialogTitle>Remove Division</DialogTitle>
    </DialogHeader>
    <p className="text-sm text-muted-foreground">
      Removing <strong>{pendingRemoveDivision}</strong> will also deselect{' '}
      {((window as any).__pendingDivisionChange?.orphans ?? []).length} sub-division(s):{' '}
      <strong>{((window as any).__pendingDivisionChange?.orphans ?? []).join(', ')}</strong>.
      Continue?
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
```

- [ ] **Step 6: Commit frontend changes**
```bash
git add Frontend/src/features/admin/pages/UsersManagement.tsx
git commit -m "feat: multi-select division field with orphan sub-division confirmation"
```

---

## Task 4: Verify & smoke-test

- [ ] **Step 1: Build frontend to confirm no TypeScript errors**
```bash
cd Frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 2: Manual smoke test — Create User**
  1. Open Admin → Users → Add User
  2. Select role CREATOR
  3. Division field should now be a MultiSelect — select MENS + KIDS
  4. Sub-Division options should show sub-depts from both MENS and KIDS
  5. Select sub-divisions from each, then save
  6. User row in table shows both divisions (comma-separated) in Scope column

- [ ] **Step 3: Manual smoke test — Edit User**
  1. Edit the user just created
  2. Division MultiSelect should preload MENS and KIDS as chips
  3. Remove MENS — confirmation dialog should appear listing the MENS-only sub-divisions
  4. Confirm — MENS removed and its orphaned sub-divs deselected
  5. Save — user now has only KIDS + remaining sub-divs

- [ ] **Step 4: Manual smoke test — backward compatibility**
  1. Edit an existing user who has a single division stored (e.g. `"MENS"`)
  2. Division MultiSelect should show one chip: MENS
  3. Save without changes — data should persist correctly

- [ ] **Step 5: Final commit**
```bash
git add -A
git commit -m "feat: complete multi-division user management"
```
