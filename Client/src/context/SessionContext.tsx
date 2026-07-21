import React, { createContext, useContext, useEffect, useState } from 'react';
import type { SessionUser } from '../types';
import * as api from '../services/api';
import { resolveSessionScope, type SessionScope } from './sessionPolicy';

interface SessionContextType {
  currentUser: SessionUser | null;
  scope: SessionScope;
  loading: boolean;
  error: string | null;
  logoutUser: () => Promise<void>;
  switchWorkspace: (businessId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [scope, setScope] = useState<SessionScope>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.getCurrentUser();
        if (!response || response.status !== 'success') {
          setScope('redirecting');
          window.location.href = '/login';
          return;
        }

        const user = response.payload || response.user;
        if (!active || !user) return;

        const params = new URLSearchParams(window.location.search);
        const urlSlug = params.get('slug')?.trim() || null;
        const nextScope = resolveSessionScope(user, urlSlug);

        setCurrentUser(user);
        setScope(nextScope);

        if (nextScope === 'redirecting' && user.businessSlug) {
          params.set('slug', user.businessSlug);
          window.location.href = `${window.location.pathname}?${params.toString()}`;
        }
      } catch (err: unknown) {
        console.error('Error loading session:', err);
        if (api.isApiError(err) && err.status === 401) {
          setScope('redirecting');
          window.location.href = '/login';
          return;
        }
        if (active) {
          setError('Ocurrió un error al cargar la sesión del panel.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadSession();
    return () => {
      active = false;
    };
  }, []);

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
