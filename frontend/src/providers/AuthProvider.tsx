import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from '../lib/api';
import type { Company, User } from '../types';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' }
  | { status: 'offline'; error: ApiError } // token present but backend unreachable
  | { status: 'authenticated'; token: string; user: User; company: Company };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(() => (getToken() ? { status: 'loading' } : { status: 'anonymous' }));

  const restore = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setState({ status: 'anonymous' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const { user, company } = await api.me();
      setState({ status: 'authenticated', token, user, company });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) setState({ status: 'offline', error: e });
      else {
        setToken(null);
        setState({ status: 'anonymous' });
      }
    }
  }, []);

  useEffect(() => {
    if (getToken()) void restore();
  }, [restore]);

  // Any 401 from any request: drop the session; <RequireAuth> then routes to /login (keeping "from").
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      queryClient.clear();
      setState({ status: 'anonymous', reason: 'expired' });
    });
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user, company } = await api.login({ email, password });
      setToken(token);
      queryClient.clear();
      setState({ status: 'authenticated', token, user, company });
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    setToken(null);
    queryClient.clear();
    setState({ status: 'anonymous' });
  }, [queryClient]);

  const value = useMemo(() => ({ state, login, logout, retry: () => void restore() }), [state, login, logout, restore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For components rendered behind <RequireAuth>: the session is guaranteed. */
export function useSession() {
  const { state, logout } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useSession used outside an authenticated route');
  const { user, company, token } = state;
  return { user, company, token, isAdmin: user.role === 'ADMIN', logout };
}
