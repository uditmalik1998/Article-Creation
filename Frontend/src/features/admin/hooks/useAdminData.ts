/**
 * Admin Data Hooks
 * Custom hooks for admin hierarchy data management
 */

import { useQuery } from '@tanstack/react-query';
import {
  getDepartments,
  getSubDepartments,
  getCategories,
  getMasterAttributes,
  getHierarchyTree,
} from '../../../services/adminApi';

interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  departmentId?: number;
  subDepartmentId?: number;
}

/**
 * Hook to fetch hierarchy tree
 */
export function useHierarchyTree() {
  return useQuery({
    queryKey: ['hierarchy-tree'],
    queryFn: getHierarchyTree,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch departments
 */
export function useDepartments(includeSubDepts = false) {
  return useQuery({
    queryKey: ['departments', includeSubDepts],
    queryFn: () => getDepartments(includeSubDepts),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch sub-departments
 */
export function useSubDepartments(departmentId?: number) {
  return useQuery({
    queryKey: ['sub-departments', departmentId],
    queryFn: () => getSubDepartments(departmentId),
    enabled: !!departmentId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch categories with pagination
 */
export function useCategories(params?: PaginationParams) {
  return useQuery({
    queryKey: ['categories', params],
    queryFn: () => getCategories(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch master attributes
 */
export function useMasterAttributes(includeValues = false) {
  return useQuery({
    queryKey: ['master-attributes', includeValues],
    queryFn: () => getMasterAttributes(includeValues),
    staleTime: 5 * 60 * 1000,
  });
}
