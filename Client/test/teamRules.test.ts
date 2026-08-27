import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TeamMembership } from '../src/types/index.ts';
import {
  TEAM_ROLE_LABELS,
  TeamSyncCoordinator,
  bookabilityPatch,
  canChangeBookability,
  canChangeTeamRole,
  canDeactivateMembership,
  deactivatePatch,
  didCallerLoseTeamAdminAuthority,
  getTeamAccessFailure,
  getTeamMutationErrorMessage,
  hasActiveTeamAdminAuthority,
  isTeamAuthenticationError,
  isTeamAuthorityError,
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

const caller = { id: '64f000000000000000000101' };

test('role and bookability remain independent across all canonical combinations', () => {
  const combinations: Array<[TeamMembership['role'], boolean]> = [
    ['admin', true],
    ['admin', false],
    ['worker', true],
    ['worker', false]
  ];

  for (const [role, isBookable] of combinations) {
    const member = membership({ role, isBookable });
    assert.equal(TEAM_ROLE_LABELS[member.role], role === 'admin' ? 'Administrador' : 'Miembro');
    assert.equal(member.isBookable, isBookable);
  }
});

test('legacy worker role is presented as non-admin membership, never as professional bookability', () => {
  assert.equal(TEAM_ROLE_LABELS.worker, 'Miembro');
  assert.doesNotMatch(TEAM_ROLE_LABELS.worker, /Profesional|Especialista/i);
  assert.equal(membership({ role: 'worker', isBookable: false }).isBookable, false);
  assert.equal(membership({ role: 'worker', isBookable: true }).isBookable, true);
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

test('409 is surfaced and requests canonical reconciliation without claiming success', () => {
  const error = { status: 409, message: 'El negocio debe conservar al menos una Membership admin activa' };
  const message = getTeamMutationErrorMessage(error);

  assert.equal(shouldRefetchTeamAfterMutationError(error), true);
  assert.match(message, /conflicto con el estado actual/i);
  assert.match(message, /volverá a consultar/i);
  assert.match(message, /al menos una Membership admin activa/i);
  assert.doesNotMatch(message, /se actualizó con el estado más reciente/i);
});

test('409 reconciliation waits for concurrent PATCHes and rejects an older GET snapshot', async () => {
  const sync = new TeamSyncCoordinator();

  assert.equal(sync.beginMutation(), true); // PATCH A
  assert.equal(sync.beginMutation(), true); // PATCH B

  sync.finishMutation(false); // PATCH A -> 409
  sync.beginReconciliation();
  assert.equal(sync.beginMutation(), false, 'new PATCHes are blocked during global reconciliation');

  // This ticket models the unsafe old interleaving: GET starts before PATCH B commits.
  const staleRead = sync.beginRead();
  let drained = false;
  const drainPromise = sync.waitForMutationsToDrain().then(() => {
    drained = true;
  });

  await Promise.resolve();
  assert.equal(drained, false, 'reconciliation must wait while PATCH B is still in flight');

  sync.finishMutation(true); // PATCH B canonical response arrives after the stale GET started
  await drainPromise;
  assert.equal(drained, true);
  assert.equal(sync.canApplyRead(staleRead), false, 'the stale GET cannot overwrite PATCH B canonical state');

  const safeRead = sync.beginRead();
  assert.equal(sync.canApplyRead(safeRead), true, 'a read begun after all PATCHes drain can apply');

  sync.finishReconciliation(true);
  assert.equal(sync.beginMutation(), true, 'independent PATCHes resume after successful reconciliation');
  sync.finishMutation(false);
});

test('failed canonical recovery after 409 stays locked until a successful retry applies', async () => {
  const sync = new TeamSyncCoordinator();

  assert.equal(sync.beginMutation(), true); // PATCH A starts
  sync.finishMutation(false); // PATCH A -> 409
  sync.beginReconciliation();
  await sync.waitForMutationsToDrain();

  // GET /api/team fails: the active attempt ends, but canonical recovery is still required.
  sync.finishReconciliation(false);
  assert.equal(sync.isReconciliationActive(), false);
  assert.equal(sync.isReconciliationRequired(), true);
  assert.equal(sync.areMutationsBlocked(), true);
  assert.equal(sync.beginMutation(), false, 'a failed reconciliation must not reopen PATCH controls');

  // User presses "Actualizar lista": fresh GET succeeds and its snapshot is valid to apply.
  sync.beginReconciliation();
  const retryRead = sync.beginRead();
  assert.equal(sync.canApplyRead(retryRead), true);
  sync.finishReconciliation(true);

  assert.equal(sync.isReconciliationRequired(), false);
  assert.equal(sync.areMutationsBlocked(), false);
  assert.equal(sync.beginMutation(), true, 'only successful canonical recovery unlocks new PATCHes');
  sync.finishMutation(false);
});

test('self-demotion and self-deactivation revoke Team authority, while bookability alone does not', () => {
  assert.equal(hasActiveTeamAdminAuthority(membership()), true);
  assert.equal(didCallerLoseTeamAdminAuthority(membership({ role: 'worker' }), caller), true);
  assert.equal(didCallerLoseTeamAdminAuthority(membership({ isActive: false }), caller), true);
  assert.equal(didCallerLoseTeamAdminAuthority(membership({ isBookable: true }), caller), false);
  assert.equal(didCallerLoseTeamAdminAuthority(
    membership({ userId: 'different-user', role: 'worker' }),
    caller
  ), false);
});

test('401 and 403 are distinct Team access failures and both fail closed', () => {
  assert.equal(isTeamAuthenticationError({ status: 401 }), true);
  assert.equal(isTeamAuthenticationError({ status: 403 }), false);
  assert.equal(isTeamAuthorityError({ status: 403 }), true);
  assert.equal(isTeamAuthorityError({ status: 401 }), false);
  assert.equal(getTeamAccessFailure({ status: 401 }), 'authentication');
  assert.equal(getTeamAccessFailure({ status: 403 }), 'authorization');
  assert.equal(getTeamAccessFailure({ status: 409 }), null);
  assert.match(getTeamMutationErrorMessage({ status: 401 }), /sesión ya no está vigente/i);
  assert.match(getTeamMutationErrorMessage({ status: 403 }), /acceso administrativo.*ya no está vigente/i);
});

test('non-conflict mutation errors do not claim success or force conflict reconciliation', () => {
  assert.equal(shouldRefetchTeamAfterMutationError({ status: 500 }), false);
  assert.match(getTeamMutationErrorMessage({ status: 500 }), /estado anterior se mantiene/i);
});

test('Team UI consumes canonical endpoints and preserves the corrected D1 surface boundary', () => {
  const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const teamViewSource = readFileSync(new URL('../src/components/TeamView.tsx', import.meta.url), 'utf8');
  const sessionSource = readFileSync(new URL('../src/context/SessionContext.tsx', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');
  const teamStylesSource = readFileSync(new URL('../src/components/TeamView.module.scss', import.meta.url), 'utf8');

  const getTeamSection = apiSource.slice(
    apiSource.indexOf('export async function getTeam'),
    apiSource.indexOf('export async function getMyAppointments')
  );
  const loadTeamSection = teamViewSource.slice(
    teamViewSource.indexOf('const loadCanonicalTeam'),
    teamViewSource.indexOf('const reconcileCanonicalTeam')
  );
  const reconcileTeamSection = teamViewSource.slice(
    teamViewSource.indexOf('const reconcileCanonicalTeam'),
    teamViewSource.indexOf('React.useEffect')
  );
  const mutationSection = teamViewSource.slice(
    teamViewSource.indexOf('const mutateMembership'),
    teamViewSource.indexOf('const handleRoleChange')
  );

  assert.match(getTeamSection, /apiFetch<[^\n]+>\("\/team"\)/);
  assert.match(getTeamSection, /\/team\/memberships\/\$\{encodeURIComponent\(membershipId\)\}/);
  assert.match(getTeamSection, /method: 'PATCH'/);
  assert.doesNotMatch(getTeamSection, /method: 'POST'|users\/workers/);

  assert.doesNotMatch(teamViewSource, /getWorkers|users\/workers|\.email\b|currentUser\?\.role|currentUser\.role/);
  assert.match(teamViewSource, /didCallerLoseTeamAdminAuthority\(canonicalMembership, currentUser\)/);
  assert.match(teamViewSource, /refreshSession/);
  assert.match(teamViewSource, /getTeamAccessFailure/);
  assert.match(loadTeamSection, /handleTeamAccessError\(normalizedError\)/, 'GET Team 401/403 must fail closed before generic load retry');
  assert.match(reconcileTeamSection, /handleTeamAccessError\(normalizedError\)/, 'reconciliation GET 401/403 must fail closed');
  assert.match(mutationSection, /handleTeamAccessError\(normalizedError\)/, 'PATCH Team 401/403 must fail closed');
  assert.match(teamViewSource, /accessState !== 'active'/);
  assert.ok(
    teamViewSource.indexOf("if (accessState !== 'active')") < teamViewSource.indexOf("if (loadState === 'error')"),
    '401/403 access loss must render before the generic Team retry state'
  );
  assert.match(teamViewSource, /waitForMutationsToDrain/);
  assert.match(teamViewSource, /canApplyRead/);
  assert.match(teamViewSource, /reconciliationRequired/);
  assert.match(teamViewSource, /controlsLocked = isPending \|\| isReconciling \|\| reconciliationRequired/);
  assert.match(teamViewSource, /finishReconciliation\(canonicalApplied\)/);
  assert.match(teamViewSource, /Actualizar lista/);
  assert.match(teamViewSource, /<option value="worker">Miembro<\/option>/);
  assert.doesNotMatch(teamViewSource, /<option value="worker">Profesional<\/option>/);
  assert.match(teamViewSource, /Propietario/);
  assert.match(teamViewSource, /Presta servicios/);
  assert.match(teamViewSource, /Acceso desactivado/);
  assert.match(teamViewSource, /Desactivar acceso/);
  assert.match(teamViewSource, /Confirmar desactivación/);
  assert.match(teamViewSource, /Su historial no se elimina/);
  assert.match(teamViewSource, /No pudimos cargar Equipo/);
  assert.match(teamViewSource, /Reintentar/);
  assert.doesNotMatch(teamViewSource, /Añadir persona|Crear persona|Eliminar persona|Reactivar/);

  assert.match(sessionSource, /refreshSession: \(\) => Promise<SessionUser \| null>/);
  assert.match(sessionSource, /err\.status === 401/);
  assert.match(sessionSource, /window\.location\.href = '\/login'/);
  assert.match(sidebarSource, /id: 'equipo', label: 'Equipo'/);
  assert.match(sidebarSource, /m\.role === 'admin' \? 'Admin' : 'Miembro'/);
  assert.doesNotMatch(sidebarSource, /m\.role === 'admin' \? 'Admin' : '(?:Profesional|Especialista)'/);
  assert.match(dashboardSource, /viewType === 'equipo' && <TeamView \/>/);
  assert.match(teamStylesSource, /@media \(max-width: 760px\)/);
  assert.match(teamStylesSource, /@media \(max-width: 420px\)/);
});
