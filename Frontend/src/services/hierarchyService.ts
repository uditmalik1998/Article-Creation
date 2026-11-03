/**
 * Hierarchy Service
 * 
 * This service provides access to the category hierarchy from the database.
 * It replaces the hardcoded CATEGORY_DEFINITIONS and MASTER_ATTRIBUTES constants.
 * 
 * Key Features:
 * - Fetches hierarchy data from backend API
 * - Caches data using React Query
 * - Provides helper methods for category lookups
 * - Transforms DB format to match legacy interface
 */

import axios from 'axios';
import type { CategoryConfig } from '../types/category/CategoryTypes';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api')) + '/user';

// Create axios instance with auth interceptor
const apiClient = axios.create({
  baseURL: API_BASE_URL
});

// Add auth token to all requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ===========================
// TYPE DEFINITIONS
// ===========================

export interface Department {
  id: number;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface SubDepartment {
  id: number;
  departmentId: number;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface Category {
  id: number;
  code: string;
  name: string;
  description?: string;
  departmentId: number;
  subDepartmentId: number;
  displayOrder: number;
  isActive: boolean;
}

export interface MasterAttribute {
  id: number;
  key: string;
  label: string;
  type: 'TEXT' | 'SELECT' | 'NUMBER';
  description?: string;
  displayOrder: number;
  isActive: boolean;
  allowedValues?: AllowedValue[];
}

export interface AllowedValue {
  id: number;
  attributeId: number;
  shortForm: string;
  fullForm: string;
  displayOrder: number;
  isActive: boolean;
}

export interface CategoryAttribute {
  categoryId: number;
  attributeId: number;
  isEnabled: boolean;
  isRequired: boolean;
  displayOrder: number;
  defaultValue?: string;
  attribute?: MasterAttribute;
}

export interface HierarchyNode {
  id: number;
  code: string;
  name: string;
  description?: string;
  department: {
    id: number;
    code: string;
    name: string;
  };
  subDepartment: {
    id: number;
    code: string;
    name: string;
  };
  attributes: CategoryAttribute[];
  isActive: boolean;
  displayOrder: number;
}

export interface HierarchyTreeResponse {
  departments: (Department & {
    subDepartments: (SubDepartment & {
      categories: HierarchyNode[];
    })[];
  })[];
  totalCategories: number;
  totalAttributes: number;
}

// ===========================
// API METHODS
// ===========================

/**
 * Fetch the complete hierarchy tree from the database
 * Includes departments, sub-departments, categories, and attributes
 */
export const getHierarchyTree = async (): Promise<HierarchyTreeResponse> => {
  const response = await apiClient.get<{ success: boolean; data: HierarchyTreeResponse }>(`/hierarchy/tree`);
  return response.data.data;
};

/**
 * Fetch all departments
 */
export const getDepartments = async (includeInactive = false): Promise<Department[]> => {
  const params = includeInactive ? { includeInactive: 'true' } : {};
  const response = await apiClient.get<{ success: boolean; data: Department[] }>(`/departments`, { params });
  return response.data.data;
};

/**
 * Fetch all sub-departments (optionally filtered by department)
 */
export const getSubDepartments = async (departmentId?: number, includeInactive = false): Promise<SubDepartment[]> => {
  const params: Record<string, string> = {};
  if (departmentId) params.departmentId = String(departmentId);
  if (includeInactive) params.includeInactive = 'true';
  
  const response = await apiClient.get<{ success: boolean; data: SubDepartment[] }>(`/sub-departments`, { params });
  return response.data.data;
};

/**
 * Fetch all categories (optionally filtered)
 */
export const getCategories = async (filters?: {
  departmentId?: number;
  subDepartmentId?: number;
  includeInactive?: boolean;
}): Promise<Category[]> => {
  const params: Record<string, string> = {};
  if (filters?.departmentId) params.departmentId = String(filters.departmentId);
  if (filters?.subDepartmentId) params.subDepartmentId = String(filters.subDepartmentId);
  if (filters?.includeInactive) params.includeInactive = 'true';
  
  const response = await apiClient.get<{ success: boolean; data: Category[] }>(`/categories`, { params });
  return response.data.data;
};

/**
 * Fetch all master attributes
 */
export const getMasterAttributes = async (): Promise<MasterAttribute[]> => {
  const response = await apiClient.get<{ success: boolean; data: MasterAttribute[] }>(`/attributes`);
  return response.data.data;
};

// ===========================
// HELPER METHODS
// ===========================

/**
 * Enhanced CategoryConfig with full attribute details from database
 * Use this instead of legacy CategoryConfig for better type safety
 */
export interface EnhancedCategoryConfig {
  department: string;
  subDepartment: string;
  category: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  // Legacy format (for backward compatibility)
  attributeDefinitions: Record<string, boolean>;
  requiredAttributes: Record<string, boolean>;
  // Enhanced format (full attribute details from database)
  attributes: CategoryAttribute[];
}

/**
 * Transform HierarchyNode to CategoryConfig (legacy format)
 * This allows gradual migration from hardcoded constants
 */
export const transformToCategoryConfig = (node: HierarchyNode): CategoryConfig => {
  // Build attribute flags in legacy format
  const attributes: Record<string, boolean> = {};
  
  node.attributes
    .filter(attr => attr.isEnabled && attr.attribute)
    .forEach(attr => {
      if (attr.attribute) {
        attributes[attr.attribute.key] = true;
      }
    });

  return {
    id: String(node.id),
    createdAt: new Date(),
    department: node.department.code as 'MENS' | 'LADIES' | 'KIDS',
    subDepartment: node.subDepartment.code,
    category: node.code,
    displayName: node.name,
    description: node.description,
    isActive: node.isActive,
    attributes,
  };
};

/**
 * Transform HierarchyNode to EnhancedCategoryConfig (with full attribute details)
 * Use this for schema generation to avoid MASTER_ATTRIBUTES lookups
 */
export const transformToEnhancedCategoryConfig = (node: HierarchyNode): EnhancedCategoryConfig => {
  // Build attribute flags in legacy format (for backward compatibility)
  const attributeDefinitions: Record<string, boolean> = {};
  const requiredAttributes: Record<string, boolean> = {};
  
  node.attributes
    .filter(attr => attr.isEnabled && attr.attribute)
    .forEach(attr => {
      if (attr.attribute) {
        attributeDefinitions[attr.attribute.key] = true;
        if (attr.isRequired) {
          requiredAttributes[attr.attribute.key] = true;
        }
      }
    });

  return {
    department: node.department.code,
    subDepartment: node.subDepartment.code,
    category: node.code,
    displayName: node.name,
    description: node.description,
    isActive: node.isActive,
    attributeDefinitions,
    requiredAttributes,
    // Include full attribute details
    attributes: node.attributes,
  };
};

/**
 * Get all categories in legacy CategoryConfig format
 */
export const getAllCategoriesAsConfigs = async (): Promise<CategoryConfig[]> => {
  const tree = await getHierarchyTree();
  const configs: CategoryConfig[] = [];
  
  tree.departments.forEach(dept => {
    dept.subDepartments.forEach(subDept => {
      subDept.categories.forEach(cat => {
        // Enrich category with parent info
        const enrichedCat: HierarchyNode = {
          ...cat,
          department: {
            id: dept.id,
            code: dept.code,
            name: dept.name,
          },
          subDepartment: {
            id: subDept.id,
            code: subDept.code,
            name: subDept.name,
          },
        };
        configs.push(transformToCategoryConfig(enrichedCat));
      });
    });
  });
  
  return configs;
};

/**
 * Search categories by query string
 */
export const searchCategoriesInTree = async (query: string): Promise<CategoryConfig[]> => {
  const tree = await getHierarchyTree();
  const lowercaseQuery = query.toLowerCase();
  const results: CategoryConfig[] = [];
  
  tree.departments.forEach(dept => {
    dept.subDepartments.forEach(subDept => {
      subDept.categories
        .filter(cat => 
          cat.isActive && (
            cat.name.toLowerCase().includes(lowercaseQuery) ||
            cat.code.toLowerCase().includes(lowercaseQuery) ||
            dept.code.toLowerCase().includes(lowercaseQuery)
          )
        )
        .forEach(cat => {
          // Enrich category with parent info
          const enrichedCat: HierarchyNode = {
            ...cat,
            department: {
              id: dept.id,
              code: dept.code,
              name: dept.name,
            },
            subDepartment: {
              id: subDept.id,
              code: subDept.code,
              name: subDept.name,
            },
          };
          results.push(transformToCategoryConfig(enrichedCat));
        });
    });
  });
  
  return results;
};

/**
 * Get unique department codes
 */
export const getDepartmentCodes = async (): Promise<string[]> => {
  const departments = await getDepartments();
  return departments.filter(d => d.isActive).map(d => d.code);
};

/**
 * Get sub-department codes for a department
 */
export const getSubDepartmentCodes = async (departmentCode: string): Promise<string[]> => {
  const tree = await getHierarchyTree();
  const dept = tree.departments.find(d => d.code === departmentCode && d.isActive);
  if (!dept) return [];
  
  return dept.subDepartments
    .filter(sd => sd.isActive)
    .map(sd => sd.code);
};

/**
 * Get categories for department and sub-department
 */
export const getCategoriesByDeptAndSubDept = async (
  departmentCode: string,
  subDepartmentCode: string
): Promise<CategoryConfig[]> => {
  const tree = await getHierarchyTree();
  const dept = tree.departments.find(d => d.code === departmentCode);
  if (!dept) return [];
  
  const subDept = dept.subDepartments.find(sd => sd.code === subDepartmentCode);
  if (!subDept) return [];
  
  // Map categories and add department/subDepartment info
  return subDept.categories
    .filter(cat => cat.isActive)
    .map(cat => {
      // Enrich category with parent info for transformation
      const enrichedCat: HierarchyNode = {
        ...cat,
        department: {
          id: dept.id,
          code: dept.code,
          name: dept.name,
        },
        subDepartment: {
          id: subDept.id,
          code: subDept.code,
          name: subDept.name,
        },
      };
      return transformToCategoryConfig(enrichedCat);
    });
};

// ===========================
// REACT QUERY KEYS
// ===========================

export const hierarchyQueryKeys = {
  all: ['hierarchy'] as const,
  tree: () => [...hierarchyQueryKeys.all, 'tree'] as const,
  departments: () => [...hierarchyQueryKeys.all, 'departments'] as const,
  subDepartments: (deptId?: number) => 
    [...hierarchyQueryKeys.all, 'sub-departments', deptId] as const,
  categories: (filters?: { departmentId?: number; subDepartmentId?: number }) =>
    [...hierarchyQueryKeys.all, 'categories', filters] as const,
  categoryByCode: (code: string) => 
    [...hierarchyQueryKeys.all, 'category', code] as const,
  attributes: () => [...hierarchyQueryKeys.all, 'attributes'] as const,
};

