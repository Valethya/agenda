import assert from 'node:assert/strict';
import test from 'node:test';
import type { SaasBusiness } from '../src/types/index.ts';
import {
  filterAndSortBusinesses,
  getBusinessMetrics,
  getBusinessPanelPath,
  getBusinessStatus,
  slugifyBusinessName
} from '../src/features/saas-businesses/businessRules.ts';

const business = (overrides: Partial<SaasBusiness> = {}): SaasBusiness => ({
  _id: 'business-1',
  name: 'Atmósfera Studio',
  slug: 'atmosfera',
  isActive: true,
  createdAt: '2026-07-01T12:00:00.000Z',
  owner: {
    firstName: 'Valentina',
    lastName: 'Rojas',
    email: 'valentina@example.com'
  },
  ...overrides
});

test('classifies active, trial and inactive businesses consistently', () => {
  assert.equal(getBusinessStatus(business()), 'activo');
  assert.equal(getBusinessStatus(business({ subscriptionStatus: 'trial' })), 'trial');
  assert.equal(getBusinessStatus(business({ isActive: false })), 'inactivo');
});

test('computes SaaS metrics from the shared status rule', () => {
  assert.deepEqual(getBusinessMetrics([
    business(),
    business({ _id: 'business-2', subscriptionStatus: 'trial' }),
    business({ _id: 'business-3', isActive: false })
  ]), { total: 3, active: 1, trial: 1, inactive: 1 });
});

test('filters by business name, slug and owner', () => {
  const businesses = [
    business(),
    business({ _id: 'business-2', name: 'DAM Production', slug: 'dam', owner: undefined })
  ];
  assert.equal(filterAndSortBusinesses(businesses, 'valentina', 'nombre').length, 1);
  assert.equal(filterAndSortBusinesses(businesses, 'dam', 'nombre')[0]._id, 'business-2');
});

test('sorts newest businesses first when sorting by registration date', () => {
  const result = filterAndSortBusinesses([
    business(),
    business({ _id: 'business-2', createdAt: '2026-07-20T12:00:00.000Z' })
  ], '', 'fecha');
  assert.equal(result[0]._id, 'business-2');
});

test('normalizes accents and repeated separators when generating slugs', () => {
  assert.equal(slugifyBusinessName('  Órbita  Diseño & Café  '), 'orbita-diseno-cafe');
});

test('opening a business never impersonates and requires an active tenant', () => {
  assert.equal(getBusinessPanelPath(business({ slug: 'atmosfera studio' })), '/admin?slug=atmosfera%20studio');
  assert.equal(getBusinessPanelPath(business({ isActive: false })), null);
});
