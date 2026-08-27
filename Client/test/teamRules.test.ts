import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TeamMembership } from '../src/types/index.ts';
import {
  TEAM_ROLE_LABELS,
  bookabilityPatch,
  canChangeBookability,
  canChangeTeamRole,
  canDeactivateMembership,
  deactivatePatch,
  getTeamMutationErrorMessage,
  replaceCanonicalMembership,
  rolePatch,
  shouldRefetchTeamAfterMutationError
} from '../src/features/team/teamRules.ts';

const membership = (overrides: Partial<TeamMembership> = {}): TeamMembership => ({
  membershipId: '64f000000000000000000001',
  userId: '64f000000000000000000101',
  name: 'Persona Demo',
  role: 'admin',
  isBookable: false,
  isActive: true,
  isOwner: false,
  ...overrides
});

test('role and bookability are independent across all canonical combinations', () => {
  const combinations: Array<[TeamMembership['role'], boolean]> = [
    ['admin', true],
    ['admin', false],
    ['worker', true],
    ['worker', false]
  ];

  for (const [role, isBookable] of combinations) {
    const member = membership({ role, isBookable });
    assert.equal(TEAM_ROLE_LABELS[member.role], role === 'admin' ? 'Administrador' : 'Profesional');
    assert.equal(member.isBookable, isBookable);
  }
});

test('owner cannot change role or deactivate, but can change bookability', () => {
  const owner = membership({ isOwner: true, role: 'admin', isBookable: false });
  assert.equal(canChangeTeamRole(owner), false);
  assert.equal(canDeactivateMembership(owner), false);
  assert.equal(canChangeBookability(owner), true);
  assert.deepEqual(bookabilityPatch(true), { isBookable: true });
});

test('inactive membership exposes no reactivation or mutable controls in D1 rules', () => {
  const inactive = membership({ isActive: false, role: 'worker', isBookable: true });
  assert.equal(canChangeTeamRole(inactive), false);
  assert.equal(canChangeBookability(inactive), false);
  assert.equal(canDeactivateMembership(inactive), false);
  assert.deepEqual(deactivatePatch(), { isActive: false });
});

test('each PATCH builder sends only the field being changed', () => {
  assert.deepEqual(rolePatch('worker'), { role: 'worker' });
  assert.deepEqual(rolePatch('admin'), { role: 'admin' });
  assert.deepEqual(bookabilityPatch(false), { isBookable: false });
  assert.deepEqual(deactivatePatch(), { isActive: false });
});

test('canonical PATCH response replaces the row without implicit local coupling', () => {
  const original = membership({ role: 'admin', isBookable: true });
  const serverResponse = membership({ role: 'worker', isBookable: true });
  const result = replaceCanonicalMembership([original], serverResponse);

  assert.equal(result[0].role, 'worker');
  assert.equal(result[0].isBookable, true);
});

test('409 is surfaced and requests a canonical refetch without claiming it already completed', () => {
  const error = { status: 409, message: 'El negocio debe conservar al menos una Membership admin activa' };
  const message = getTeamMutationErrorMessage(error);

  assert.equal(shouldRefetchTeamAfterMutationError(error), true);
  assert.match(message, /conflicto con el estado actual/i);
  assert.match(message, /volverá a consultar/i);
  assert.match(message, /al menos una Membership admin activa/i);
  assert.doesNotMatch(message, /se actualizó con el estado más reciente/i);
});

test('non-conflict mutation errors do not claim success or force conflict refetch', () => {
  assert.equal(shouldRefetchTeamAfterMutationError({ status: 500 }), false);
  assert.match(getTeamMutationErrorMessage({ status: 500 }), /estado anterior se mantiene/i);
});

test('Team UI consumes canonical Team endpoints and preserves the D1 surface boundary', () => {
  const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const teamViewSource = readFileSync(new URL('../src/components/TeamView.tsx', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');
  const teamStylesSource = readFileSync(new URL('../src/components/TeamView.module.scss', import.meta.url), 'utf8');

  const getTeamSection = apiSource.slice(
    apiSource.indexOf('export async function getTeam'),
    apiSource.indexOf('export async function getMyAppointments')
  );

  assert.match(getTeamSection, /apiFetch<[^\n]+>\("\/team"\)/);
  assert.match(getTeamSection, /\/team\/memberships\/\$\{encodeURIComponent\(membershipId\)\}/);
  assert.match(getTeamSection, /method: 'PATCH'/);
  assert.doesNotMatch(getTeamSection, /method: 'POST'|users\/workers/);

  assert.doesNotMatch(teamViewSource, /getWorkers|users\/workers|\.email\b|currentUser\?\.role|currentUser\.role/);
  assert.match(teamViewSource, /Propietario/);
  assert.match(teamViewSource, /Presta servicios/);
  assert.match(teamViewSource, /Acceso desactivado/);
  assert.match(teamViewSource, /Desactivar acceso/);
  assert.match(teamViewSource, /Confirmar desactivación/);
  assert.match(teamViewSource, /Su historial no se elimina/);
  assert.match(teamViewSource, /No pudimos cargar Equipo/);
  assert.match(teamViewSource, /Reintentar/);
  assert.match(teamViewSource, /pendingRef\.current\.has\(membershipId\)/);
  assert.match(teamViewSource, /loadCanonicalTeam\(true\)/);
  assert.doesNotMatch(teamViewSource, /Añadir persona|Crear persona|Eliminar persona|Reactivar/);

  assert.match(sidebarSource, /id: 'equipo', label: 'Equipo'/);
  assert.match(dashboardSource, /viewType === 'equipo' && <TeamView \/>/);
  assert.match(teamStylesSource, /@media \(max-width: 760px\)/);
  assert.match(teamStylesSource, /@media \(max-width: 420px\)/);
});
