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

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'CREATOR' | 'PO_COMMITTEE' | 'APPROVER' | 'CATEGORY_HEAD' | 'SUB_DIVISION_HEAD' | 'PD_DESIGNER' | 'PD';
  division?: string | null;
  subDivision?: string | null;
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
  role?: 'ADMIN' | 'CREATOR' | 'PO_COMMITTEE' | 'APPROVER' | 'CATEGORY_HEAD' | 'SUB_DIVISION_HEAD' | 'PD_DESIGNER' | 'PD';
  division?: string;
  subDivision?: string | string[];
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
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const res = await expenseApi.get<ExpenseTableResponse>(
    `/table/${encodeURIComponent(tableKey)}?${query.toString()}`,
  );
  return res.data;
}

// ═══════════════════════════════════════════════════════
// EXPENSE CHANGE REQUESTS (3-stage approval workflow)
// ═══════════════════════════════════════════════════════

export type ExpenseChangeStatus = 'PENDING_APPROVER' | 'PENDING_FINAL' | 'APPROVED' | 'REJECTED';

export interface ExpenseChangeFieldDiff {
  old: any;
  new: any;
}

export interface ExpenseChangeRequest {
  id: string;
  tableKey: string;
  rowId: string;
  rowLabel: string | null;
  changes: Record<string, ExpenseChangeFieldDiff>;
  reason: string;
  status: ExpenseChangeStatus;

  requestedById: number;
  requestedByName: string;
  requestedByEmail: string;
  requestedAt: string;

  approverId: number | null;
  approverName: string | null;
  approverEmail: string | null;
  approverAt: string | null;
  approverComment: string | null;
  approverAction: string | null;

  finalById: number | null;
  finalByName: string | null;
  finalByEmail: string | null;
  finalAt: string | null;
  finalComment: string | null;
  finalAction: string | null;

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
  mine?: boolean;
}

export interface ExpenseChangeRequestsResponse {
  data: ExpenseChangeRequest[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function createExpenseChangeRequest(
  tableKey: string,
  rowId: string,
  payload: { changes: Record<string, any>; reason: string },
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/table/${encodeURIComponent(tableKey)}/${encodeURIComponent(rowId)}/change-requests`,
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

export async function reviewExpenseChangeRequest(
  id: string,
  action: 'APPROVE' | 'REJECT',
  comment?: string,
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/change-requests/${encodeURIComponent(id)}/review`,
    { action, comment },
  );
  return res.data.data;
}

export async function finalizeExpenseChangeRequest(
  id: string,
  action: 'APPROVE' | 'REJECT',
  comment?: string,
): Promise<ExpenseChangeRequest> {
  const res = await expenseApi.post<{ success: boolean; data: ExpenseChangeRequest }>(
    `/change-requests/${encodeURIComponent(id)}/finalize`,
    { action, comment },
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
