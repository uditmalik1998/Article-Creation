/**
 * Authentication Types
 * All type definitions related to user authentication and authorization
 */

export type UserRole = 'ADMIN' | 'CREATOR' | 'PO_COMMITTEE' | 'APPROVER' | 'CATEGORY_HEAD' | 'SUB_DIVISION_HEAD' | 'PD_DESIGNER' | 'PD' | 'BODY_APPROVER' | 'PLANNING';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (userData: User, token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

export interface AuthProviderProps {
  children: React.ReactNode;
}
