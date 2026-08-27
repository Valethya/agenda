import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionUser } from '../src/types/index.ts';
import {
  buildAdminViewUrl,
  resolveCalendarSelection,
  resolveSessionScope,
  shouldShowWorkspaceSwitcher
} from '../src/context/sessionPolicy.ts';

const membership = (businessId: string) => ({
  id: `membership-${businessId}`,
  businessId,
  businessName: `Negocio ${businessId}`,
  businessSlug: businessId,
  role: 'admin' as const
});

const user = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'user-1',
  firstName: 'Valentina',
  lastName: 'Rojas',
  role: 'admin',
  businessSlug: 'atmosfera',
  memberships: [membership('atmosfera')],
  ...overrides
});

test('superadmin without slug remains in the global SaaS scope', () => {
  const superadmin = user({ role: 'superadmin', businessSlug: undefined, memberships: [] });
  assert.equal(resolveSessionScope(superadmin, null), 'global');
  assert.deepEqual(resolveCalendarSelection(superadmin, 'global', null), {
    viewType: 'saas-negocios',
    selectedProfessionalId: null
  });
});

test('superadmin with an explicit slug enters tenant scope', () => {
  const superadmin = user({ role: 'superadmin', businessSlug: undefined, memberships: [] });
  assert.equal(resolveSessionScope(superadmin, 'atmosfera'), 'tenant');
});

test('regular session without slug redirects to its active business', () => {
  assert.equal(resolveSessionScope(user(), null), 'redirecting');
});

test('workspace switcher is visible for admin and worker with multiple memberships', () => {
  const memberships = [membership('atmosfera'), membership('dam')];
  assert.equal(shouldShowWorkspaceSwitcher(user({ role: 'admin', memberships })), true);
  assert.equal(shouldShowWorkspaceSwitcher(user({ role: 'worker', memberships })), true);
});

test('workspace switcher is hidden for one membership and for superadmin', () => {
  assert.equal(shouldShowWorkspaceSwitcher(user()), false);
  assert.equal(shouldShowWorkspaceSwitcher(user({
    role: 'superadmin',
    businessSlug: undefined,
    memberships: [membership('atmosfera'), membership('dam')]
  })), false);
});

test('worker defaults to week view and its own professional filter', () => {
  assert.deepEqual(resolveCalendarSelection(user({ role: 'worker', id: 'worker-1' }), 'tenant', null), {
    viewType: 'semana',
    selectedProfessionalId: 'worker-1'
  });
});

test('worker keeps its own professional filter on explicit routed calendar views', () => {
  const worker = user({ role: 'worker', id: 'worker-1' });
  for (const view of ['semana', 'dia', 'mes'] as const) {
    assert.deepEqual(resolveCalendarSelection(worker, 'tenant', view), {
      viewType: view,
      selectedProfessionalId: 'worker-1'
    });
  }
});

test('Team view is routable in tenant scope without using User.role as Team authority', () => {
  assert.deepEqual(resolveCalendarSelection(user({ role: 'admin' }), 'tenant', 'equipo'), {
    viewType: 'equipo',
    selectedProfessionalId: null
  });
  assert.deepEqual(resolveCalendarSelection(user({ role: 'worker', id: 'worker-1' }), 'tenant', 'equipo'), {
    viewType: 'equipo',
    selectedProfessionalId: null
  });
});

test('leaving Team for Calendar synchronizes view while preserving tenant and unrelated query params', () => {
  const url = buildAdminViewUrl('?slug=atmosfera&view=equipo&foo=bar', 'semana');
  const params = new URL(url, 'https://agenda.test').searchParams;

  assert.equal(params.get('slug'), 'atmosfera');
  assert.equal(params.get('foo'), 'bar');
  assert.equal(params.get('view'), 'semana');
  assert.deepEqual(resolveCalendarSelection(user(), 'tenant', params.get('view')), {
    viewType: 'semana',
    selectedProfessionalId: null
  });
});

test('leaving Team for Horarios synchronizes view and refresh keeps Horarios', () => {
  const url = buildAdminViewUrl('?slug=atmosfera&view=equipo', 'horarios');
  const params = new URL(url, 'https://agenda.test').searchParams;

  assert.equal(params.get('slug'), 'atmosfera');
  assert.equal(params.get('view'), 'horarios');
  assert.deepEqual(resolveCalendarSelection(user(), 'tenant', params.get('view')), {
    viewType: 'horarios',
    selectedProfessionalId: null
  });
});

test('regular tenant cannot select a SaaS-only view through the URL', () => {
  assert.deepEqual(resolveCalendarSelection(user(), 'tenant', 'saas-negocios'), {
    viewType: 'dia',
    selectedProfessionalId: null
  });
});
