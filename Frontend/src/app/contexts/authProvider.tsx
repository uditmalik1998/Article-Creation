/**
 * Authentication Provider
 * Provides authentication state and methods throughout the app
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../../types/auth';
import { AuthContext } from './auth.context';
import { clearAuthSession, redirectToLoginOnce } from '../../shared/utils/auth/navigation';

// Global 401 interceptor — any fetch that returns 401 (e.g. TOKEN_EXPIRED)
// clears the session and sends the user back to /login. Installed at module
// load, not in a useEffect: child effects run before the provider's, so a
// page's on-mount fetches would otherwise slip past it.
const FETCH_PATCHED = '__auth401FetchPatched';
if (typeof window !== 'undefined' && !(window as any)[FETCH_PATCHED]) {
  (window as any)[FETCH_PATCHED] = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401) {
      clearAuthSession();
      redirectToLoginOnce();
    }
    return response;
  };
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: Readonly<AuthProviderProps>) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Load user and token from localStorage on mount
    const storedToken = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = useCallback((userData: User, authToken: string) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
  }, []);

  const isAuthenticated = !!token && !!user;

  const value = useMemo(
    () => ({ user, token, login, logout, isAuthenticated }),
    [user, token, login, logout, isAuthenticated]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
