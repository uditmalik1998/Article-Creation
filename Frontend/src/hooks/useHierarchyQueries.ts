/**
 * Hierarchy Query Hooks
 * 
 * React Query hooks for accessing category hierarchy data from the database.
 * These hooks provide caching, loading states, and error handling.
 * 
 * Usage:
 * ```tsx
 * const { data: tree, isLoading } = useHierarchyTree();
 * const { data: categoryConfig } = useCategoryConfig('T_SHIRT');
 * ```
 */

import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import type { CategoryConfig } from '../types/category/CategoryTypes';
import {
  getHierarchyTree,
  getDepartments,
  getSubDepartments,
  getCategories,
  getCategoryWithAttributes,
  getMasterAttributes,
  getAllCategoriesAsConfigs,
  getCategoryConfigByCode,
  searchCategoriesInTree,
  getDepartmentCodes,
  getSubDepartmentCodes,
  getCategoriesByDeptAndSubDept,
  hierarchyQueryKeys,
  type HierarchyTreeResponse,
  type Department,
  type SubDepartment,
  type Category,
  type HierarchyNode,
  type MasterAttribute,
} from '../services/hierarchyService';

// ===========================
// QUERY OPTIONS
// ===========================

const DEFAULT_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const TREE_STALE_TIME = 10 * 60 * 1000; // 10 minutes (tree is large and changes less frequently)

// ===========================
// MAIN HOOKS
// ===========================

/**
 * Fetch the complete hierarchy tree
 * Use this for admin panels or when you need the full structure
 */
export const useHierarchyTree = (
  options?: Omit<UseQueryOptions<HierarchyTreeResponse>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: hierarchyQueryKeys.tree(),
    queryFn: getHierarchyTree,
    staleTime: TREE_STALE_TIME,
    ...options,
  });
};

/**
 * Fetch all departments
 */
export const useDepartments = (
  includeInactive = false,
  options?: Omit<UseQueryOptions<Department[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.departments(), includeInactive],
    queryFn: () => getDepartments(includeInactive),
    staleTime: DEFAULT_STALE_TIME,
    ...options,
  });
};

/**
 * Fetch sub-departments (optionally filtered by department)
 */
export const useSubDepartments = (
  departmentId?: number,
  includeInactive = false,
  options?: Omit<UseQueryOptions<SubDepartment[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.subDepartments(departmentId), includeInactive],
    queryFn: () => getSubDepartments(departmentId, includeInactive),
    staleTime: DEFAULT_STALE_TIME,
    enabled: departmentId !== undefined || options?.enabled !== false,
    ...options,
  });
};

/**
 * Fetch categories (optionally filtered)
 */
export const useCategories = (
  filters?: {
    departmentId?: number;
    subDepartmentId?: number;
    includeInactive?: boolean;
  },
  options?: Omit<UseQueryOptions<Category[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: hierarchyQueryKeys.categories(filters),
    queryFn: () => getCategories(filters),
    staleTime: DEFAULT_STALE_TIME,
    ...options,
  });
};

/**
 * Fetch a specific category with its attributes
 */
export const useCategoryWithAttributes = (
  categoryCode: string,
  options?: Omit<UseQueryOptions<HierarchyNode | null>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: hierarchyQueryKeys.categoryByCode(categoryCode),
    queryFn: () => getCategoryWithAttributes(categoryCode),
    staleTime: DEFAULT_STALE_TIME,
    enabled: !!categoryCode && (options?.enabled !== false),
    ...options,
  });
};

/**
 * Fetch all master attributes
 */
export const useMasterAttributes = (
  options?: Omit<UseQueryOptions<MasterAttribute[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: hierarchyQueryKeys.attributes(),
    queryFn: () => getMasterAttributes(),
    staleTime: DEFAULT_STALE_TIME,
    ...options,
  });
};

// ===========================
// LEGACY FORMAT HOOKS
// ===========================

/**
 * Get all categories in legacy CategoryConfig format
 * Use this when migrating from hardcoded CATEGORY_DEFINITIONS
 */
export const useAllCategoriesAsConfigs = (
  options?: Omit<UseQueryOptions<CategoryConfig[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.all, 'configs', 'all'],
    queryFn: getAllCategoriesAsConfigs,
    staleTime: TREE_STALE_TIME,
    ...options,
  });
};

/**
 * Get a single category config by code (legacy format)
 * Use this to replace CategoryHelper.getCategoryConfig()
 */
export const useCategoryConfig = (
  categoryCode: string,
  options?: Omit<UseQueryOptions<CategoryConfig | null>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.categoryByCode(categoryCode), 'config'],
    queryFn: () => getCategoryConfigByCode(categoryCode),
    staleTime: DEFAULT_STALE_TIME,
    enabled: !!categoryCode && (options?.enabled !== false),
    ...options,
  });
};

/**
 * Search categories by query string (legacy format)
 */
export const useSearchCategories = (
  query: string,
  options?: Omit<UseQueryOptions<CategoryConfig[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.all, 'search', query],
    queryFn: () => searchCategoriesInTree(query),
    staleTime: DEFAULT_STALE_TIME,
    enabled: query.length > 0 && (options?.enabled !== false),
    ...options,
  });
};

/**
 * Get department codes (legacy format)
 */
export const useDepartmentCodes = (
  options?: Omit<UseQueryOptions<string[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.all, 'department-codes'],
    queryFn: getDepartmentCodes,
    staleTime: TREE_STALE_TIME,
    ...options,
  });
};

/**
 * Get sub-department codes for a department (legacy format)
 */
export const useSubDepartmentCodes = (
  departmentCode: string,
  options?: Omit<UseQueryOptions<string[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.all, 'sub-department-codes', departmentCode],
    queryFn: () => getSubDepartmentCodes(departmentCode),
    staleTime: TREE_STALE_TIME,
    enabled: !!departmentCode && (options?.enabled !== false),
    ...options,
  });
};

/**
 * Get categories for department and sub-department (legacy format)
 */
export const useCategoriesByDeptAndSubDept = (
  departmentCode: string,
  subDepartmentCode: string,
  options?: Omit<UseQueryOptions<CategoryConfig[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: [...hierarchyQueryKeys.all, 'by-dept-subdept', departmentCode, subDepartmentCode],
    queryFn: () => getCategoriesByDeptAndSubDept(departmentCode, subDepartmentCode),
    staleTime: TREE_STALE_TIME,
    enabled: !!departmentCode && !!subDepartmentCode && (options?.enabled !== false),
    ...options,
  });
};

// ===========================
// UTILITY HOOKS
// ===========================

/**
 * Check if hierarchy data is loaded and available
 */
export const useIsHierarchyReady = () => {
  const { isSuccess, data } = useHierarchyTree();
  return isSuccess && !!data && data.totalCategories > 0;
};

/**
 * Get loading state across multiple hierarchy queries
 */
export const useHierarchyLoadingState = () => {
  const treeQuery = useHierarchyTree();
  const attributesQuery = useMasterAttributes();
  
  return {
    isLoading: treeQuery.isLoading || attributesQuery.isLoading,
    isError: treeQuery.isError || attributesQuery.isError,
    error: treeQuery.error || attributesQuery.error,
    isReady: treeQuery.isSuccess && attributesQuery.isSuccess,
  };
};
