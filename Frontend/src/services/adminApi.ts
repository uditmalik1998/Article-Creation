/**
 * Admin API Service
 * Handles all API calls to the backend admin endpoints
 */

import axios from 'axios';
import { clearAuthSession, redirectToLoginOnce } from '../shared/utils/auth/navigation';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');

/** Builds an axios instance under `${API_BASE_URL}${basePath}` with the same
 * auth-token injection and 401/403 handling every backend API client here needs. */
function createApiClient(basePath: string) {
  const client = axios.create({
    baseURL: `${API_BASE_URL}${basePath}`,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  client.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        console.warn('🔐 Authentication failed - redirecting to login');
        clearAuthSession();
        redirectToLoginOnce();
      } else if (error.response?.status === 403) {
        console.error('🚫 Access denied - insufficient permissions');
      }
      return Promise.reject(error);
    }
  );

  return client;
}

const adminApi = createApiClient('/admin');

// Expense Data change-request workflow lives outside the ADMIN-only /admin mount
// so Creator/Approver/Category-Head/PD can reach it too (each route still checks
// the caller's specific role server-side).
const expenseApi = createApiClient('/expense');

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export interface Department {
  id: number;
  code: string;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  subDepartments?: SubDepartment[];
}

export interface SubDepartment {
  id: number;
  departmentId: number;
  code: string;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  department?: Department;
  categories?: Category[];
}

export interface Category {
  id: number;
  subDepartmentId: number;
  code: string;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  garmentType?: string | null;
  createdAt: string;
  updatedAt: string;
  subDepartment?: SubDepartment & { department?: Department };
  attributes?: CategoryAttribute[];
}

export interface MasterAttribute {
  id: number;
  key: string;
  label: string;
  type: 'TEXT' | 'SELECT' | 'NUMBER';
  description?: string;
  displayOrder: number;
  isActive: boolean;
  group?: string | null;
  createdAt: string;
  updatedAt: string;
  allowedValues?: AllowedValue[];
}

export interface AllowedValue {
  id: number;
  attributeId: number;
  shortForm: string;
  fullForm: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAttribute {
  id: number;
  categoryId: number;
  attributeId: number;
  isEnabled: boolean;
  displayOrder: number;
  isRequired: boolean;
  attribute?: MasterAttribute;
}

export interface DashboardStats {
  departments: number;
  subDepartments: number;
  categories: number;
  masterAttributes: number;
  allowedValues: number;
}

/** Mens / Kids / Ladies / PD — a coarse business-unit tag independent of
 * `division`/`subDivision` below (those follow the Department/SubDepartment
 * hierarchy for extraction routing; `division` can hold several values at
 * once). Shown in the Users page as "Business Division". */
export type AdminUserBusinessDivision = 'MENS' | 'KIDS' | 'LADIES' | 'PD' | 'MDM';

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'CREATOR' | 'PO_COMMITTEE' | 'APPROVER' | 'CATEGORY_HEAD' | 'SUB_DIVISION_HEAD' | 'PD_DESIGNER' | 'PD' | 'BODY_APPROVER' | 'PLANNING';
  division?: string | null;
  subDivision?: string | null;
  businessDivision?: AdminUserBusinessDivision | null;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string | null;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// ═══════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const { data } = await adminApi.get<ApiResponse<DashboardStats>>('/stats');
  return data.data;
};

// ═══════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════

export const getDepartments = async (includeSubDepts = false): Promise<Department[]> => {
  const { data } = await adminApi.get<ApiResponse<Department[]>>('/departments', {
    params: { includeSubDepts },
  });
  return data.data;
};

export const getDepartmentById = async (id: number): Promise<Department> => {
  const { data } = await adminApi.get<ApiResponse<Department>>(`/departments/${id}`);
  return data.data;
};

export const createDepartment = async (department: Partial<Department>): Promise<Department> => {
  const { data } = await adminApi.post<ApiResponse<Department>>('/departments', department);
  return data.data;
};

export const updateDepartment = async (id: number, department: Partial<Department>): Promise<Department> => {
  const { data } = await adminApi.put<ApiResponse<Department>>(`/departments/${id}`, department);
  return data.data;
};

export const deleteDepartment = async (id: number): Promise<void> => {
  await adminApi.delete(`/departments/${id}`);
};

// ═══════════════════════════════════════════════════════
// SUB-DEPARTMENTS
// ═══════════════════════════════════════════════════════

export const getSubDepartments = async (departmentId?: number): Promise<SubDepartment[]> => {
  const { data } = await adminApi.get<ApiResponse<SubDepartment[]>>('/sub-departments', {
    params: departmentId ? { departmentId } : undefined,
  });
  return data.data;
};

export const getSubDepartmentById = async (id: number): Promise<SubDepartment> => {
  const { data } = await adminApi.get<ApiResponse<SubDepartment>>(`/sub-departments/${id}`);
  return data.data;
};

export const createSubDepartment = async (subDepartment: Partial<SubDepartment>): Promise<SubDepartment> => {
  const { data } = await adminApi.post<ApiResponse<SubDepartment>>('/sub-departments', subDepartment);
  return data.data;
};

export const updateSubDepartment = async (id: number, subDepartment: Partial<SubDepartment>): Promise<SubDepartment> => {
  const { data } = await adminApi.put<ApiResponse<SubDepartment>>(`/sub-departments/${id}`, subDepartment);
  return data.data;
};

export const deleteSubDepartment = async (id: number): Promise<void> => {
  await adminApi.delete(`/sub-departments/${id}`);
};

// ═══════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════

export interface GetCategoriesParams {
  page?: number;
  limit?: number;
  departmentId?: number;
  subDepartmentId?: number;
  search?: string;
}

export const getCategories = async (params: GetCategoriesParams = {}): Promise<PaginatedResponse<Category>> => {
  const { data } = await adminApi.get<PaginatedResponse<Category>>('/categories', { params });
  return data;
};

export const getCategoryById = async (id: number): Promise<Category> => {
  const { data } = await adminApi.get<ApiResponse<Category>>(`/categories/${id}`);
  return data.data;
};

export const createCategory = async (category: Partial<Category>): Promise<Category> => {
  const { data } = await adminApi.post<ApiResponse<Category>>('/categories', category);
  return data.data;
};

export const updateCategory = async (id: number, category: Partial<Category>): Promise<Category> => {
  const { data } = await adminApi.put<ApiResponse<Category>>(`/categories/${id}`, category);
  return data.data;
};

export const deleteCategory = async (id: number): Promise<void> => {
  await adminApi.delete(`/categories/${id}`);
};

export const updateCategoryAttributes = async (id: number, attributeIds: number[]): Promise<void> => {
  await adminApi.put(`/categories/${id}/attributes`, { attributeIds });
};

export const updateCategoryAttributeMapping = async (
  categoryId: number,
  attributeId: number,
  data: {
    isEnabled?: boolean;
    isRequired?: boolean;
    displayOrder?: number;
    defaultValue?: string | null;
  }
): Promise<void> => {
  await adminApi.put(`/categories/${categoryId}/attributes/${attributeId}`, data);
};

export const addAttributeToCategory = async (
  categoryId: number,
  data: {
    attributeId: number;
    isEnabled?: boolean;
    isRequired?: boolean;
    displayOrder?: number;
    defaultValue?: string | null;
  }
): Promise<CategoryAttribute> => {
  const { data: response } = await adminApi.post<ApiResponse<CategoryAttribute>>(
    `/categories/${categoryId}/attributes`,
    data
  );
  return response.data;
};

export const removeAttributeFromCategory = async (
  categoryId: number,
  attributeId: number
): Promise<void> => {
  await adminApi.delete(`/categories/${categoryId}/attributes/${attributeId}`);
};

// ═══════════════════════════════════════════════════════
// MASTER ATTRIBUTES
// ═══════════════════════════════════════════════════════

export const getMasterAttributes = async (includeValues = false): Promise<MasterAttribute[]> => {
  const { data } = await adminApi.get<ApiResponse<MasterAttribute[]>>('/attributes', {
    params: { includeValues },
  });
  return data.data;
};

export const getMasterAttributeById = async (id: number): Promise<MasterAttribute> => {
  const { data } = await adminApi.get<ApiResponse<MasterAttribute>>(`/attributes/${id}`);
  return data.data;
};

export const createMasterAttribute = async (attribute: Partial<MasterAttribute>): Promise<MasterAttribute> => {
  const { data } = await adminApi.post<ApiResponse<MasterAttribute>>('/attributes', attribute);
  return data.data;
};

export const updateMasterAttribute = async (id: number, attribute: Partial<MasterAttribute>): Promise<MasterAttribute> => {
  const { data } = await adminApi.put<ApiResponse<MasterAttribute>>(`/attributes/${id}`, attribute);
  return data.data;
};

export const deleteMasterAttribute = async (id: number): Promise<void> => {
  await adminApi.delete(`/attributes/${id}`);
};

export const addAllowedValue = async (attributeId: number, value: Partial<AllowedValue>): Promise<AllowedValue> => {
  const { data } = await adminApi.post<ApiResponse<AllowedValue>>(`/attributes/${attributeId}/values`, value);
  return data.data;
};

export const deleteAllowedValue = async (attributeId: number, valueId: number): Promise<void> => {
  await adminApi.delete(`/attributes/${attributeId}/values/${valueId}`);
};

// ═══════════════════════════════════════════════════════
// HIERARCHY
// ═══════════════════════════════════════════════════════

export interface HierarchyTreeResponse {
  departments: Department[];
  totalCategories: number;
  totalAttributes: number;
}

export const getHierarchyTree = async (): Promise<Department[]> => {
  const { data } = await adminApi.get<ApiResponse<HierarchyTreeResponse>>('/hierarchy/tree');
  // Extract just the departments array for backward compatibility
  return data.data.departments;
};

export interface LightweightCategory {
  id: number;
  name: string;
  code: string;
  garmentType?: string | null;
  displayOrder: number;
  enabledCount: number;
  totalCount: number;
}

export interface LightweightSubDepartment {
  id: number;
  name: string;
  code: string;
  displayOrder: number;
  categories: LightweightCategory[];
}

export interface LightweightDepartment {
  id: number;
  name: string;
  code: string;
  displayOrder: number;
  subDepartments: LightweightSubDepartment[];
}

export const getHierarchyTreeLightweight = async (): Promise<LightweightDepartment[]> => {
  const { data } = await adminApi.get<ApiResponse<{ departments: LightweightDepartment[] }>>('/hierarchy/tree/lightweight');
  return data.data.departments;
};

/**
 * Get category with ALL master attributes (showing enabled/disabled status)
 * Used by admin matrix to show all 44 attributes with toggles
 */
export const getCategoryWithAllAttributes = async (categoryId: number) => {
  const { data } = await adminApi.get(`/categories/${categoryId}/all-attributes`);
  return data.data;
};

export const exportHierarchy = async (): Promise<Blob> => {
  const { data } = await adminApi.get('/hierarchy/export', {
    responseType: 'blob',
  });
  return data;
};

// ═══════════════════════════════════════════════════════
// GRID VALUES EDITOR (maj_cat_grid_values)
// ═══════════════════════════════════════════════════════
export interface GridValueAttribute { gridKey: string; label: string }
export interface GridValueGroup { group: string; label: string; attributes: GridValueAttribute[] }
export interface GridValueCategory { majorCategory: string; count: number }
export interface GridValueItem { id: number; value: string }
export interface GridValueAuditEntry {
  id: number;
  value: string;
  action: 'ADD' | 'DELETE';
  remarks: string | null;
  by: string;
  at: string;
}

export const getGridValueAttributes = async (): Promise<GridValueGroup[]> => {
  const { data } = await adminApi.get('/grid-values/attributes');
  return data.data ?? [];
};

export const getGridValueCategories = async (attribute: string): Promise<GridValueCategory[]> => {
  const { data } = await adminApi.get('/grid-values/categories', { params: { attribute } });
  return data.data ?? [];
};

export const getGridValues = async (attribute: string, majorCategory: string): Promise<GridValueItem[]> => {
  const { data } = await adminApi.get('/grid-values/values', { params: { attribute, majorCategory } });
  return data.data ?? [];
};

export const addGridValue = async (attribute: string, majorCategory: string, value: string, remarks: string): Promise<void> => {
  await adminApi.post('/grid-values/add', { attribute, majorCategory, value, remarks });
};

export const deleteGridValue = async (id: number, remarks: string): Promise<void> => {
  await adminApi.post('/grid-values/delete', { id, remarks });
};

export const getGridValueAudit = async (attribute: string, majorCategory: string): Promise<GridValueAuditEntry[]> => {
  const { data } = await adminApi.get('/grid-values/audit', { params: { attribute, majorCategory } });
  return data.data ?? [];
};

// ═══════════════════════════════════════════════════════
// SIZE MASTER EDITOR (maj_cat_sizes)
// ═══════════════════════════════════════════════════════
export interface SizeMasterCategory { majorCategory: string; count: number }
export interface SizeMasterItem { id: number; size: string }
export interface SizeMasterAuditEntry {
  id: number;
  size: string;
  action: 'ADD' | 'DELETE';
  remarks: string | null;
  by: string;
  at: string;
}

export const getSizeMasterCategories = async (): Promise<SizeMasterCategory[]> => {
  const { data } = await adminApi.get('/size-master/categories');
  return data.data ?? [];
};

export const getSizeMasterSizes = async (majorCategory: string): Promise<SizeMasterItem[]> => {
  const { data } = await adminApi.get('/size-master/sizes', { params: { majorCategory } });
  return data.data ?? [];
};

export const addSizeMasterSize = async (majorCategory: string, size: string, remarks: string): Promise<void> => {
  await adminApi.post('/size-master/add', { majorCategory, size, remarks });
};

export const deleteSizeMasterSize = async (id: number, remarks: string): Promise<void> => {
  await adminApi.post('/size-master/delete', { id, remarks });
};

export const getSizeMasterAudit = async (majorCategory: string): Promise<SizeMasterAuditEntry[]> => {
  const { data } = await adminApi.get('/size-master/audit', { params: { majorCategory } });
  return data.data ?? [];
};

// ═══════════════════════════════════════════════════════
// STATUS DASHBOARD (extraction_results_flat — generic articles)
// ═══════════════════════════════════════════════════════
export interface StatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}
export interface StatusSubDivision extends StatusCounts {
  subDivision: string;
}
export interface StatusDivision extends StatusCounts {
  division: string;
  subDivisions: StatusSubDivision[];
}
export interface StatusDashboard {
  data: StatusDivision[];
  totals: StatusCounts;
}

export const getStatusDashboard = async (): Promise<StatusDashboard> => {
  const { data } = await adminApi.get('/status-dashboard');
  return { data: data.data ?? [], totals: data.totals ?? { pending: 0, approved: 0, rejected: 0, total: 0 } };
};

// ═══════════════════════════════════════════════════════
// USERS (ADMIN ONLY)
// ═══════════════════════════════════════════════════════

export const getUsers = async (): Promise<AdminUser[]> => {
  const { data } = await adminApi.get<ApiResponse<AdminUser[]>>('/users');
  return data.data;
};

export const createUser = async (payload: {
  email: string;
  password: string;
  name: string;
  role?: 'ADMIN' | 'CREATOR' | 'PO_COMMITTEE' | 'APPROVER' | 'CATEGORY_HEAD' | 'SUB_DIVISION_HEAD' | 'PD_DESIGNER' | 'PD' | 'BODY_APPROVER' | 'PLANNING';
  division?: string;
  subDivision?: string | string[];
  businessDivision?: AdminUserBusinessDivision | null;
}): Promise<AdminUser> => {
  const { data } = await adminApi.post<ApiResponse<AdminUser>>('/users', payload);
  return data.data;
};



export const updateUser = async (
  id: number,
  payload: Omit<Partial<AdminUser>, 'subDivision'> & { subDivision?: string | string[] | null; password?: string }
): Promise<AdminUser> => {
  const { data } = await adminApi.put<ApiResponse<AdminUser>>(`/users/${id}`, payload);
  return data.data;
};

export const deactivateUser = async (id: number): Promise<void> => {
  await adminApi.delete(`/users/${id}`);
};

// ═══════════════════════════════════════════════════════
// MODIFY LOGS
// ═══════════════════════════════════════════════════════

export interface ModifyLog {
  id: number;
  modificationGroupId: string;
  articleNumber: string;
  labelName: string;
  oldValue: string | null;
  newValue: string | null;
  modifiedByName: string;
  modifiedByEmail: string;
  modifiedAt: string;
  sapStatus: string;
}

export interface ModifyLogsParams {
  page?: number;
  limit?: number;
  articleNumber?: string;
  labelName?: string;
  modifiedByName?: string;
  modifiedByEmail?: string;
  sapStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface ModifyLogsResponse {
  data: ModifyLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getModifyLogs(params: ModifyLogsParams = {}): Promise<ModifyLogsResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const res = await adminApi.get<ModifyLogsResponse>(`/modify-logs?${query.toString()}`);
  return res.data;
}

export async function getModifyLogsByGroup(groupId: string): Promise<{ data: ModifyLog[] }> {
  const res = await adminApi.get<{ data: ModifyLog[] }>(`/modify-logs/group/${encodeURIComponent(groupId)}`);
  return res.data;
}

// ═══════════════════════════════════════════════════════
// EXPENSE TABLE DETAIL VIEWS (Phase 1 — generic read-only browse)
// ═══════════════════════════════════════════════════════

export interface ExpenseTableParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Excel-style column filters: column key -> the exact values to include.
   * Additive to `search` (both apply, ANDed), and independent per column. An
   * absent or empty-array column is simply not filtered. */
  filters?: Record<string, string[]>;
}

export interface ExpenseTableResponse<T = Record<string, any>> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getExpenseTableData(
  tableKey: string,
  params: ExpenseTableParams = {},
): Promise<ExpenseTableResponse> {
  const { filters, ...rest } = params;
  const query = new URLSearchParams();
  Object.entries(rest).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const activeFilters = filters ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length > 0)) : {};
  if (Object.keys(activeFilters).length > 0) query.set('filters', JSON.stringify(activeFilters));
  const res = await expenseApi.get<ExpenseTableResponse>(
    `/table/${encodeURIComponent(tableKey)}?${query.toString()}`,
  );
  return res.data;
}

/** Distinct existing values for one column — powers a dropdown on the
 * add/edit form (e.g. Attribute Name, Sub Division / Major Category /
 * Segment Type) instead of free-typing something that has to match an
 * existing taxonomy exactly. */
export async function getExpenseColumnOptions(tableKey: string, column: string): Promise<string[]> {
  const res = await expenseApi.get<{ success: boolean; data: string[] }>(
    `/table/${encodeURIComponent(tableKey)}/column/${encodeURIComponent(column)}/options`,
  );
  return res.data.data;
}

/** A fromColumn -> toColumn value lookup, for auto-filling one field from
 * another on the add/edit form (e.g. Size Master: pick a Major Category,
 * Sub Division fills itself in). */
export async function getExpenseColumnMapping(
  tableKey: string,
  fromColumn: string,
  toColumn: string,
): Promise<Record<string, string>> {
  const res = await expenseApi.get<{ success: boolean; data: Record<string, string> }>(
    `/table/${encodeURIComponent(tableKey)}/column/${encodeURIComponent(fromColumn)}/mapped-to/${encodeURIComponent(toColumn)}`,
  );
  return res.data.data;
}

// ═══════════════════════════════════════════════════════
// EXPENSE CHANGE REQUESTS (N-stage approval chain — see EXPENSE ACCESS
// CONTROL below for the chain definition itself)
// ═══════════════════════════════════════════════════════

/** PENDING covers every mid-chain state — which stage exactly is
 * `currentStageKey`, since the chain's length is admin-configurable. */
export type ExpenseChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ExpenseChangeFieldDiff {
  old: any;
  new: any;
}

export type ExpenseChangeOperation = 'UPDATE' | 'CREATE' | 'DELETE';

/** One entry of a request's `approvalTrail` — one per stage action taken.
 * `stageKey` is `"SYSTEM"` for the one case a human didn't act: an
 * automatic rejection when the row drifted between submission and the
 * chain's last approval. */
export interface ExpenseApprovalTrailEntry {
  stageKey: string;
  stageLabel: string;
  action: 'APPROVE' | 'REJECT';
  byId: number;
  byName: string;
  byEmail: string;
  at: string;
  comment: string | null;
  /** Field(s) this stage's approver adjusted before passing the request on —
   * present only when they actually changed something. */
  editedFields?: string[];
}

export interface ExpenseChangeRequest {
  id: string;
  tableKey: string;
  operation: ExpenseChangeOperation;
  /** Null on CREATE requests — there is no row until the chain finishes. */
  rowId: string | null;
  /** The id the insert was given, once an approved CREATE has been applied. */
  appliedRowId: string | null;
  rowLabel: string | null;
  changes: Record<string, ExpenseChangeFieldDiff>;
  reason: string;
  /** The date the requester needs this done by. */
  dueDate: string | null;
  status: ExpenseChangeStatus;
  /** The approval-stage key this request is currently waiting on; null once
   * status is APPROVED or REJECTED. */
  currentStageKey: string | null;
  /** Every stage action taken so far, in order. */
  approvalTrail: ExpenseApprovalTrailEntry[];

  requestedById: number;
  requestedByName: string;
  requestedByEmail: string;
  requestedAt: string;
  /** The requester's own Business Division at the moment they raised this,
   * captured once and never changed afterward — what routes the
   * CATEGORY_HEAD stage to the matching Category Head. */
  requesterBusinessDivision: AdminUserBusinessDivision | null;

  createdAt: string;
  updatedAt: string;
}

export interface ExpenseChangeRequestsParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  tableKey?: string;
  status?: ExpenseChangeStatus;
  operation?: ExpenseChangeOperation;
  /** Only requests currently waiting on this exact stage key. */
  stageKey?: string;
  /** Only requests raised by someone tagged this Business Division — an
   * admin's (or MDM's) "show me just this division" filter. Purely
   * additive: it can only narrow whichever visibility tier already applies,
   * never widen it. */
  requesterBusinessDivision?: AdminUserBusinessDivision;
  mine?: boolean;
  /** Requests currently sitting at any stage the caller may act on — the
   * dynamic replacement for a fixed "pending my review" filter per stage. */
  mineToApprove?: boolean;
  /** Only still-open requests whose "needed by" date has already passed. */
  overdue?: boolean;
}

export interface ExpenseChangeRequestsResponse {
  data: ExpenseChangeRequest[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Every request carries the reason AND the date the requester needs it done by. */
export interface ExpenseRequestMeta {
  reason: string;
  /** YYYY-MM-DD. */
  dueDate: string;
}

/** Propose edits to an existing row. */
export async function createExpenseChangeRequest(
  tableKey: string,
  rowId: string,
  payload: ExpenseRequestMeta & { changes: Record<string, any> },
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/table/${encodeURIComponent(tableKey)}/${encodeURIComponent(rowId)}/change-requests`,
    payload,
  );
  return res.data.data;
}

/** Propose a brand-new row. */
export async function createExpenseAddRequest(
  tableKey: string,
  payload: ExpenseRequestMeta & { values: Record<string, any> },
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/table/${encodeURIComponent(tableKey)}/add-requests`,
    payload,
  );
  return res.data.data;
}

/** Propose deleting an existing row. */
export async function createExpenseDeleteRequest(
  tableKey: string,
  rowId: string,
  payload: ExpenseRequestMeta,
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/table/${encodeURIComponent(tableKey)}/${encodeURIComponent(rowId)}/delete-requests`,
    payload,
  );
  return res.data.data;
}

export async function getExpenseChangeRequests(
  params: ExpenseChangeRequestsParams = {},
): Promise<ExpenseChangeRequestsResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const res = await expenseApi.get<ExpenseChangeRequestsResponse>(`/change-requests?${query.toString()}`);
  return res.data;
}

export async function getExpenseChangeRequestById(id: string): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.get<{ success: boolean; data: ExpenseChangeRequest }>(
    `/change-requests/${encodeURIComponent(id)}`,
  );
  return res.data.data;
}

/** Acts at whichever stage the request currently sits at (`currentStageKey`).
 * One endpoint for the whole chain — with an admin-editable number of
 * stages there's no fixed "stage 2 is final" to hang a separate call off;
 * the server resolves what stage this is and whether it's the last one.
 *
 * `changes` lets the approver adjust the proposed values before passing the
 * request on — field -> new value, a subset of the request's own proposed
 * fields. Only meaningful with action APPROVE on an UPDATE/CREATE request;
 * ignored on REJECT, and rejected by the server on a DELETE request (there
 * is nothing to edit — only a row to remove). */
export async function actOnExpenseChangeRequest(
  id: string,
  action: 'APPROVE' | 'REJECT',
  comment?: string,
  changes?: Record<string, any>,
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/change-requests/${encodeURIComponent(id)}/act`,
    { action, comment, changes },
  );
  return res.data.data;
}

// ═══════════════════════════════════════════════════════
// EXPENSE ACCESS — the caller's own rights, and the approval CHAIN's labels
// (routing itself is by Business Division, see UsersManagement; there is no
// more email-grant or stage-management UI)
// ═══════════════════════════════════════════════════════

/** One rung of the Expense Data approval chain, e.g. "Category Head" then
 * "MDM". `sortOrder` is the walk order; a request starts at the
 * lowest-sortOrder active stage and approving the highest-sortOrder active
 * one applies the change. Read-only from the frontend — only used to
 * label a request's current stage in the Change Requests / Audit Log views. */
export interface ExpenseApprovalStage {
  id: number;
  /** Which table's chain this stage belongs to, or '*' for the shared
   * default chain every table walks unless it has rows of its own — see
   * ExpenseApprovalStage.tableKey in schema.prisma. A same-named key (e.g.
   * 'CATEGORY_HEAD') can appear once per chain, so this — not `key` alone —
   * is what disambiguates which chain a stage row belongs to. */
  tableKey: string;
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  /** A retired stage can no longer be reached by a new request, but is kept
   * (not deleted) so past requests' trails still resolve its label. */
  isActive: boolean;
  createdById: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the CALLER may do — drives which buttons the Expense pages render.
 * The server re-checks every action, so this is presentation only. */
export interface MyExpenseAccess {
  isAdmin: boolean;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Stage keys the caller holds AT ALL, for the table asked about — coarse,
   * not request-specific. A Category Head shows 'CATEGORY_HEAD' here
   * regardless of division; whether they can act on one particular request
   * also depends on `businessDivision` matching that request's
   * `requesterBusinessDivision` — the server is the real gate either way. */
  approvableStageKeys: string[];
  levels: string[];
  subDivisions: string[];
  /** This user's own Business Division (MENS/KIDS/LADIES/PD/MDM), or null. */
  businessDivision: AdminUserBusinessDivision | null;
  /** Which expense tables this role may even browse, or null for no
   * restriction. PLANNING is confined to `['segment-master', 'size-master']`
   * — used to filter the masters list and the Change Requests view down to
   * just those; the server enforces the same thing per-table regardless. */
  allowedTableKeys: string[] | null;
}

export async function getMyExpenseAccess(tableKey?: string): Promise<MyExpenseAccess> {
  const query = tableKey ? `?tableKey=${encodeURIComponent(tableKey)}` : '';
  const res = await expenseApi.get<{ success: boolean; data: MyExpenseAccess }>(`/my-access${query}`);
  return res.data.data;
}

/** The full chain, active and retired, in walk order. Read-only from the
 * frontend — used only to label a request's current stage. */
export async function getExpenseApprovalStages(): Promise<ExpenseApprovalStage[]> {
  const res = await adminApi.get<{ success: boolean; data: ExpenseApprovalStage[] }>('/expense-approval-stages');
  return res.data.data;
}

// ═══════════════════════════════════════════════════════
// EXPENSE AUDIT LOG (admin-only) — the durable record of every step: raised,
// each stage's action, and every real write to a master table (or failed
// attempt). See Backend/src/services/expenseAuditLogService.ts.
// ═══════════════════════════════════════════════════════

export type ExpenseAuditEventType = 'REQUESTED' | 'STAGE_APPROVED' | 'STAGE_REJECTED' | 'APPLIED' | 'APPLY_FAILED' | 'AUTO_REJECTED';

export interface ExpenseAuditLogEntry {
  id: number;
  requestId: string;
  tableKey: string;
  rowId: string | null;
  operation: ExpenseChangeOperation;
  eventType: ExpenseAuditEventType;
  stageKey: string | null;
  stageLabel: string | null;
  actorId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  comment: string | null;
  details: Record<string, any> | null;
  occurredAt: string;
}

export interface ExpenseAuditLogParams {
  requestId?: string;
  tableKey?: string;
  rowId?: string;
  eventType?: ExpenseAuditEventType;
  operation?: ExpenseChangeOperation;
  actorEmail?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ExpenseAuditLogResponse {
  data: ExpenseAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getExpenseAuditLog(params: ExpenseAuditLogParams = {}): Promise<ExpenseAuditLogResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const res = await adminApi.get<ExpenseAuditLogResponse>(`/expense-audit-log?${query.toString()}`);
  return res.data;
}

/** Every audit-log entry for one request, oldest first. */
export async function getExpenseAuditLogForRequest(requestId: string): Promise<ExpenseAuditLogEntry[]> {
  const res = await adminApi.get<{ success: boolean; data: ExpenseAuditLogEntry[] }>(
    `/expense-audit-log/${encodeURIComponent(requestId)}`,
  );
  return res.data.data;
}

// ═══════════════════════════════════════════════════════
// NATIONAL GRID MASTER
// ═══════════════════════════════════════════════════════

export interface NationalGridRow {
  id: number;
  attributeName: string;
  code: string;
  fullForm: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface NationalGridImportRow {
  attributeName: string;
  code: string;
  fullForm?: string | null;
}

export async function importNationalGridRows(
  rows: NationalGridImportRow[],
): Promise<{ success: boolean; upserted: number }> {
  const res = await adminApi.post<{ success: boolean; upserted: number }>('/national-grid/import', { rows });
  return res.data;
}

export default adminApi;
