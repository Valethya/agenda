import type { SaasBusiness } from '../../types';

export type BusinessSortOption = 'nombre' | 'fecha' | 'estado';
export type BusinessStatus = 'activo' | 'trial' | 'inactivo';

export interface BusinessMetrics {
  total: number;
  active: number;
  trial: number;
  inactive: number;
}

const TRIAL_SLUGS = new Set([
  'calavera',
  'calavera-studio',
  'calaveras',
  'ink-studio'
]);

export function getBusinessStatus(business: SaasBusiness): BusinessStatus {
  if (!business.isActive) return 'inactivo';
  return TRIAL_SLUGS.has(business.slug) ? 'trial' : 'activo';
}

export function getBusinessMetrics(businesses: SaasBusiness[]): BusinessMetrics {
  return businesses.reduce<BusinessMetrics>((metrics, business) => {
    metrics.total += 1;
    const status = getBusinessStatus(business);
    if (status === 'activo') metrics.active += 1;
    if (status === 'trial') metrics.trial += 1;
    if (status === 'inactivo') metrics.inactive += 1;
    return metrics;
  }, { total: 0, active: 0, trial: 0, inactive: 0 });
}

export function filterAndSortBusinesses(
  businesses: SaasBusiness[],
  searchTerm: string,
  sortBy: BusinessSortOption
): SaasBusiness[] {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('es');

  return businesses
    .filter(business => {
      if (!normalizedSearch) return true;
      const ownerName = business.owner
        ? `${business.owner.firstName} ${business.owner.lastName}`.toLocaleLowerCase('es')
        : '';
      return business.name.toLocaleLowerCase('es').includes(normalizedSearch)
        || business.slug.toLocaleLowerCase('es').includes(normalizedSearch)
        || ownerName.includes(normalizedSearch);
    })
    .sort((a, b) => {
      if (sortBy === 'nombre') return a.name.localeCompare(b.name, 'es');
      if (sortBy === 'fecha') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      }
      return getBusinessStatus(a).localeCompare(getBusinessStatus(b), 'es');
    });
}

export function slugifyBusinessName(name: string): string {
  return name
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function getBusinessPanelPath(business: SaasBusiness): string | null {
  if (!business.isActive) return null;
  return `/admin?slug=${encodeURIComponent(business.slug)}`;
}

export function getPrimaryContact(value?: string | string[]): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function formatBusinessDate(dateString?: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}
