/**
 * Admin API Types
 * Type definitions for admin hierarchy management
 */

export interface Department {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    subDepartments: number;
  };
}

export interface SubDepartment {
  id: number;
  name: string;
  description: string | null;
  departmentId: number;
  createdAt: string;
  updatedAt: string;
  department?: Department;
  _count?: {
    categories: number;
  };
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  subDepartmentId: number;
  createdAt: string;
  updatedAt: string;
  subDepartment?: SubDepartment;
}

export interface AllowedValue {
  id: number;
  value: string;
  attributeId: number;
  createdAt: string;
  updatedAt: string;
}

export interface MasterAttribute {
  id: number;
  name: string;
  description: string | null;
  type: 'TEXT' | 'SELECT' | 'NUMBER';
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
  allowedValues?: AllowedValue[];
}

export interface HierarchyNode {
  id: number;
  name: string;
  description: string | null;
  subDepartments?: SubDepartmentNode[];
}

export interface SubDepartmentNode {
  id: number;
  name: string;
  description: string | null;
  categories?: CategoryNode[];
}

export interface CategoryNode {
  id: number;
  name: string;
  description: string | null;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  departmentId?: number;
  subDepartmentId?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateDepartmentDto {
  name: string;
  description?: string;
}

export interface UpdateDepartmentDto {
  name?: string;
  description?: string;
}

export interface CreateSubDepartmentDto {
  name: string;
  description?: string;
  departmentId: number;
}

export interface UpdateSubDepartmentDto {
  name?: string;
  description?: string;
  departmentId?: number;
}

export interface CreateCategoryDto {
  name: string;
  description?: string;
  subDepartmentId: number;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string;
  subDepartmentId?: number;
}

export interface CreateAttributeDto {
  name: string;
  description?: string;
  type: 'TEXT' | 'SELECT' | 'NUMBER';
  isRequired?: boolean;
}

export interface UpdateAttributeDto {
  name?: string;
  description?: string;
  type?: 'TEXT' | 'SELECT' | 'NUMBER';
  isRequired?: boolean;
}

export interface CreateAllowedValueDto {
  value: string;
  attributeId: number;
}

export interface ApiError {
  message: string;
  statusCode?: number;
  errors?: Record<string, string[]>;
}
