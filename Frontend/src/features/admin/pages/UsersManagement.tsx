import { useState, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, User, LayoutGrid, Pencil, Download, Upload as UploadIcon, Search } from 'lucide-react';
import {
  Badge,
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
  MultiSelect,
  Popconfirm,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  createUser,
  updateUser,
  deactivateUser,
  getUsers,
  getDepartments,
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

const userSchema = z.object({
  name: z.string().min(1, 'Please enter name'),
  email: z.string().email('Enter a valid email').min(1, 'Please enter email'),
  password: z.string().optional(),
  role: z.enum(['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD']),
  divisionIds: z.array(z.string()).optional(),
  subDivision: z.array(z.string()).optional(),
});
type UserValues = z.infer<typeof userSchema>;

export default function UsersManagement() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [pendingRemoveDivision, setPendingRemoveDivision] = useState<string | null>(null);
  const [pendingOrphans, setPendingOrphans] = useState<string[]>([]);
  const pendingDivisionChangeRef = useRef<{ newIds: string[]; orphans: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: '', email: '', password: '', role: 'CREATOR', divisionIds: [], subDivision: [] },
  });
  const selectedRole = form.watch('role');
  const selectedDivisionIds = form.watch('divisionIds') ?? [];

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

  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) {
      return users.filter((u) => u.isActive);
    }
    const lower = searchTerm.toLowerCase();
    return users.filter(
      (u) =>
        u.isActive &&
        (u.name.toLowerCase().includes(lower) ||
          u.email.toLowerCase().includes(lower) ||
          (u.division && u.division.toLowerCase().includes(lower)) ||
          (u.subDivision && u.subDivision.toLowerCase().includes(lower)) ||
          u.role.toLowerCase().includes(lower)),
    );
  }, [users, searchTerm]);

  const divisionNames = useMemo(() => {
    const base = ['MENS', 'LADIES', 'KIDS'];
    const fromDepartments = departments.map((d) => formatDivisionLabel(String(d.name || '').trim())).filter(Boolean);
    return Array.from(new Set([...base, ...fromDepartments]));
  }, [departments]);

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
    form.reset({ name: '', email: '', password: '', role: 'CREATOR', divisionIds: [], subDivision: [] });
    pendingDivisionChangeRef.current = null;
    setPendingRemoveDivision(null);
    setPendingOrphans([]);
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
    const payload: any = {
      email: values.email,
      name: values.name,
      role: values.role,
      division: values.divisionIds?.length ? values.divisionIds : undefined,
      subDivision: values.subDivision,
    };
    if (values.password) payload.password = values.password;

    if (selectedUser) updateUserMutation.mutate(payload);
    else createUserMutation.mutate(payload);
  };

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

      const headers = ['name', 'email', 'password', 'role', 'division', 'subDivision'];
      usersSheet.columns = headers.map((h) => ({ header: h, key: h, width: 24 }));
      usersSheet.getRow(1).font = { bold: true };
      usersSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      usersSheet.addRow(['John Creator', 'john.creator@company.com', 'Temp@123', 'CREATOR', 'MENS', 'ML']);
      usersSheet.addRow(['Rita CategoryHead', 'rita.head@company.com', 'Temp@123', 'CATEGORY_HEAD', 'LADIES', '']);

      const roleOptions = ['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD'];
      const divisionOptions = divisionNames;
      const subDivisionOptions = Array.from(
        new Set(departments.flatMap((d) => (d.subDepartments || []).map((s) => s.code).filter(Boolean))),
      );

      listSheet.getColumn(1).values = [undefined, ...roleOptions];
      listSheet.getColumn(2).values = [undefined, ...divisionOptions];
      listSheet.getColumn(3).values = [undefined, ...subDivisionOptions];

      const roleRange = `Lists!$A$2:$A$${Math.max(roleOptions.length + 1, 2)}`;
      const divisionRange = `Lists!$B$2:$B$${Math.max(divisionOptions.length + 1, 2)}`;
      const subDivisionRange = `Lists!$C$2:$C$${Math.max(subDivisionOptions.length + 1, 2)}`;

      for (let row = 2; row <= 500; row += 1) {
        usersSheet.getCell(`D${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [roleRange], showErrorMessage: true, errorStyle: 'warning' };
        usersSheet.getCell(`E${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [divisionRange], showErrorMessage: true, errorStyle: 'warning' };
        usersSheet.getCell(`F${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [subDivisionRange], showErrorMessage: true, errorStyle: 'warning' };
      }

      usersSheet.getCell('H1').value = 'Notes';
      usersSheet.getCell('H2').value = 'CREATOR/APPROVER: division + subDivision required';
      usersSheet.getCell('H3').value = 'CATEGORY_HEAD: division required, subDivision optional';
      usersSheet.getCell('H4').value = 'ADMIN: division/subDivision optional';
      usersSheet.getCell('H5').value = 'PO_COMMITTEE: division/subDivision not required (free selection at extraction)';

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
        if (['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD'].includes(role))
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
            division: role === 'PO_COMMITTEE' || role === 'PD' ? undefined : division,
            subDivision:
              role === 'CATEGORY_HEAD' || role === 'PO_COMMITTEE' || role === 'ADMIN' || role === 'PD'
                ? undefined
                : subDivision,
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
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <strong>{v}</strong> },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: AdminUser['role']) => (
        <Badge variant={role === 'ADMIN' ? 'info' : 'secondary'}>{role}</Badge>
      ),
    },
    {
      title: 'Scope',
      key: 'scope',
      render: (_v, record) => {
        if (record.role === 'ADMIN') return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">
              {record.division ? formatDivisionLabel(record.division) : 'No Division'}
            </span>
            <strong className="text-xs">{record.subDivision || 'No Sub-Division'}</strong>
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (active: boolean) => (
        <Badge variant={active ? 'success' : 'destructive'}>{active ? 'ACTIVE' : 'INACTIVE'}</Badge>
      ),
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLogin',
      key: 'lastLogin',
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_v, record) => {
        const isSelf = userData?.id === record.id;
        return (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => handleEditUser(record)}>
              <Pencil />
              Edit
            </Button>
            <Popconfirm
              title="Deactivate user"
              description="This will prevent the user from logging in. Continue?"
              onConfirm={() => deactivateUserMutation.mutate(record.id)}
              disabled={!record.isActive || isSelf}
            >
              <Button size="sm" variant="destructive" disabled={!record.isActive || isSelf}>
                Deactivate
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
            <Button onClick={() => setIsModalOpen(true)} className="bg-[#FF6F61] text-white hover:bg-[#ff5b4d] shadow-md">
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
          <div className="mb-4 flex items-center gap-3">
            <Input
              placeholder="Search by name, email, division, or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-[400px]"
              allowClear
              onClear={() => setSearchTerm('')}
              prefix={<Search className="h-4 w-4" />}
            />
            {searchTerm && (
              <span className="text-sm text-muted-foreground">
                Found {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <DataTable
            rowKey="id"
            columns={columns}
            dataSource={filteredUsers}
            loading={isLoading}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: 'No users found' }}
          />
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{selectedUser ? 'Edit User' : 'Create User'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Full name" prefix={<User className="h-4 w-4" />} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="name@company.com" disabled={!!selectedUser} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{selectedUser ? 'Password (leave blank to keep current)' : 'Password'}</FormLabel>
                    <FormControl>
                      <InputPassword placeholder={selectedUser ? 'New password (optional)' : 'Temporary password'} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['CREATOR', 'PO_COMMITTEE', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'ADMIN', 'PD_DESIGNER', 'PD'].map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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

              {needsSubDivision && (
                <FormField
                  control={form.control}
                  name="subDivision"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sub-Division</FormLabel>
                      <FormControl>
                        <MultiSelect
                          options={availableSubDepts.map((s) => ({
                            value: s.code,
                            label: `${s.name} (${s.code})`,
                          }))}
                          value={field.value ?? []}
                          onChange={field.onChange}
                          disabled={!selectedDivisionIds.length}
                          placeholder="Select Sub-Division"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createUserMutation.isPending || updateUserMutation.isPending}>
                  {selectedUser ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
          {/* Keep imports referenced */}
          {false && <LayoutGrid />}
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
