import type { SessionUser } from '../types';

export type ViewType = 'semana' | 'dia' | 'mes' | 'horarios' | 'saas-negocios' | 'saas-metricas';
export type SessionScope = 'loading' | 'global' | 'tenant' | 'redirecting';

interface CalendarSelection {
  viewType: ViewType;
  selectedProfessionalId: string | null;
}

const TENANT_VIEWS: ViewType[] = ['semana', 'dia', 'mes', 'horarios'];
const SAAS_VIEWS: ViewType[] = ['saas-negocios', 'saas-metricas'];

export function resolveSessionScope(user: SessionUser, urlSlug: string | null): SessionScope {
  if (user.role === 'superadmin' && !urlSlug) return 'global';
  if (user.businessSlug && !urlSlug) return 'redirecting';
  return 'tenant';
}

export function shouldShowWorkspaceSwitcher(user: SessionUser | null): boolean {
  return Boolean(
    user &&
    user.role !== 'superadmin' &&
    user.memberships.length > 1
  );
}

export function resolveCalendarSelection(
  user: SessionUser,
  scope: SessionScope,
  urlView: string | null
): CalendarSelection {
  if (scope === 'global') {
    return {
      viewType: urlView === 'saas-metricas' ? 'saas-metricas' : 'saas-negocios',
      selectedProfessionalId: null
    };
  }

  const allowedViews = user.role === 'superadmin'
    ? [...TENANT_VIEWS, ...SAAS_VIEWS]
    : TENANT_VIEWS;

  if (urlView && allowedViews.includes(urlView as ViewType)) {
    return { viewType: urlView as ViewType, selectedProfessionalId: null };
  }

  if (user.role === 'worker') {
    return {
      viewType: 'semana',
      selectedProfessionalId: user._id || user.id || null
    };
  }

  return {
    viewType: user.role === 'superadmin' ? 'mes' : 'dia',
    selectedProfessionalId: null
  };
}
