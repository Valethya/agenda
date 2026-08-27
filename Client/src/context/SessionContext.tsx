import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SessionUser } from '../types';
import * as api from '../services/api';
import { resolveSessionScope, type SessionScope } from './sessionPolicy';

interface SessionContextType {
  currentUser: SessionUser | null;
  scope: SessionScope;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<SessionUser | null>;
  logoutUser: () => Promise<void>;
  switchWorkspace: (businessId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [scope, setScope] = useState<SessionScope>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async (): Promise<SessionUser | null> => {
    try {
      setError(null);
      const response = await api.getCurrentUser();
      if (!response || response.status !== 'success') {
        setCurrentUser(null);
        setScope('redirecting');
        window.location.href = '/login';
        return null;
      }

      const user = response.payload || response.user;
      if (!user) {
        setCurrentUser(null);
        setScope('redirecting');
        window.location.href = '/login';
        return null;
      }

      const params = new URLSearchParams(window.location.search);
      const urlSlug = params.get('slug')?.trim() || null;
      const nextScope = resolveSessionScope(user, urlSlug);

      setCurrentUser(user);
      setScope(nextScope);

      if (nextScope === 'redirecting' && user.businessSlug) {
        params.set('slug', user.businessSlug);
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      }

      return user;
    } catch (err: unknown) {
      console.error('Error refreshing session:', err);
      if (api.isApiError(err) && err.status === 401) {
        setCurrentUser(null);
        setScope('redirecting');
        window.location.href = '/login';
        return null;
      }
      setError('Ocurrió un error al actualizar la sesión del panel.');
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      setLoading(true);
      await refreshSession();
      if (active) setLoading(false);
    };

    void loadSession();
    return () => {
      active = false;
    };
  }, [refreshSession]);

  const logoutUser = async () => {
    try {
      const response = await api.logout();
      if (response?.status === 'success') window.location.href = '/login';
    } catch (err) {
      console.error('Error logging out:', err);
      alert('Error al cerrar sesión');
    }
  };

  const switchWorkspace = async (businessId: string) => {
    try {
      setLoading(true);
      const response = await api.switchBusiness(businessId);
      if (response?.status === 'success') {
        const user = response.payload || response.user;
        window.location.href = user.businessSlug
          ? `/admin?slug=${user.businessSlug}`
          : '/admin';
        return;
      }
      alert('Error al cambiar de negocio');
    } catch (err) {
      console.error('Error switching workspace:', err);
      alert('Error al intentar cambiar de negocio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SessionContext.Provider value={{
      currentUser,
      scope,
      loading,
      error,
      refreshSession,
      logoutUser,
      switchWorkspace
    }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
