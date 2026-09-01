import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Shift, TeamMembership } from '../src/types/index.ts';
import {
  SHIFT_SCHEDULE_ENDPOINT,
  TEAM_SCHEDULE_SOURCE,
  buildSevenDaySchedule,
  buildShiftWriteInput,
  filterScheduleCandidates,
  mergeCanonicalShift
} from '../src/features/availability/scheduleRules.ts';

const member = (overrides: Partial<TeamMembership> = {}): TeamMembership => ({
  membershipId: '64f000000000000000000001',
  userId: '64f000000000000000000101',
  name: 'Persona Demo',
  role: 'worker',
  isBookable: true,
  isActive: true,
  isOwner: false,
  ...overrides
});

const shift = (overrides: Partial<Shift> = {}): Shift => ({
  worker: '64f000000000000000000101',
  dayOfWeek: 1,
  isOpen: true,
  startTime: '09:00',
  endTime: '18:00',
  breaks: [],
  ...overrides
});

test('Horarios deriva candidatos exclusivamente de Team activo + bookable', () => {
  const adminBookable = member({ userId: 'admin-bookable', role: 'admin', isBookable: true });
  const workerBookable = member({ userId: 'worker-bookable', role: 'worker', isBookable: true });
  const workerRoleOnly = member({ userId: 'worker-role-only', role: 'worker', isBookable: false });
  const inactive = member({ userId: 'inactive', role: 'worker', isBookable: true, isActive: false });

  assert.deepEqual(
    filterScheduleCandidates([adminBookable, workerBookable, workerRoleOnly, inactive]).map((item) => item.userId),
    ['admin-bookable', 'worker-bookable']
  );
  assert.equal(TEAM_SCHEDULE_SOURCE, '/team');
  assert.notEqual(TEAM_SCHEDULE_SOURCE, '/internal/users/workers');
});

test('se representan siempre siete días y la ausencia de Shift es día cerrado', () => {
  const schedule = buildSevenDaySchedule('worker-a', [
    shift({ worker: 'worker-a', dayOfWeek: 1, isOpen: true })
  ]);

  assert.deepEqual(schedule.map((day) => day.dayOfWeek), [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(schedule.length, 7);
  assert.equal(schedule[0].isOpen, true);
  assert.equal(schedule[1].isOpen, false);
  assert.equal(schedule[1].startTime, '09:00');
  assert.equal(schedule[1].endTime, '18:00');
});

test('payload de Shift sólo contiene campos funcionales de horario', () => {
  const payload = buildShiftWriteInput('worker-a', shift({
    worker: 'worker-a',
    dayOfWeek: 3,
    isOpen: true,
    startTime: '10:00',
    endTime: '17:00',
    breaks: [{ startTime: '13:00', endTime: '13:30' }]
  }));

  assert.deepEqual(payload, {
    workerId: 'worker-a',
    dayOfWeek: 3,
    isOpen: true,
    startTime: '10:00',
    endTime: '17:00',
    breaks: [{ startTime: '13:00', endTime: '13:30' }]
  });
  for (const forbidden of ['business', 'role', 'membershipId', 'isBookable', 'tenantAuthority', 'createdBy']) {
    assert.equal(forbidden in payload, false);
  }
});

test('estado canónico sólo se reemplaza con la respuesta confirmada', () => {
  const schedule = buildSevenDaySchedule('worker-a', [shift({ worker: 'worker-a' })]);
  const confirmed = shift({
    worker: 'worker-a',
    dayOfWeek: 1,
    startTime: '11:00',
    endTime: '16:00',
    breaks: [{ startTime: '13:00', endTime: '13:30' }]
  });
  const next = mergeCanonicalShift(schedule, confirmed);

  assert.equal(next.find((day) => day.dayOfWeek === 1)?.startTime, '11:00');
  assert.deepEqual(next.find((day) => day.dayOfWeek === 1)?.breaks, confirmed.breaks);
});

test('la vista Horarios usa Team, edición real y reconciliación canónica', () => {
  const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const viewSource = readFileSync(new URL('../src/components/ScheduleManagementView.tsx', import.meta.url), 'utf8');
  const cardSource = readFileSync(new URL('../src/components/ProfessionalScheduleCard.tsx', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');
  const rulesSource = readFileSync(new URL('../src/features/availability/scheduleRules.ts', import.meta.url), 'utf8');

  assert.equal(SHIFT_SCHEDULE_ENDPOINT, '/availability/shifts');
  assert.match(viewSource, /api\.getTeam\(\)/);
  assert.match(viewSource, /filterScheduleCandidates/);
  assert.doesNotMatch(viewSource, /getWorkers|internal\/users\/workers/);
  assert.doesNotMatch(rulesSource, /member\.role\s*===\s*['"]worker['"]|role\s*===\s*['"]worker['"]/);
  assert.match(dashboardSource, /viewType === 'horarios'.*<ScheduleManagementView/s);
  assert.match(viewSource, /Editar horarios/);
  assert.match(viewSource, /setEditing/);

  assert.match(cardSource, /type="checkbox"/);
  assert.match(cardSource, /type="time"/);
  assert.match(cardSource, /Añadir descanso/);
  assert.match(cardSource, /Quitar/);
  assert.match(cardSource, /Guardar cambios/);
  assert.match(cardSource, /saving \|\| dirtyDays\.size === 0/);
  assert.match(cardSource, /api\.saveWorkerShift/);
  assert.match(cardSource, /mergeCanonicalShift/);
  assert.match(cardSource, /await loadCanonicalSchedule\(\)/);
  assert.match(cardSource, /Horarios guardados correctamente/);
  assert.match(cardSource, /setError/);

  assert.match(apiSource, /getTeam\(\)/);
  assert.match(apiSource, /saveWorkerShift/);
  assert.match(apiSource, /POST|method: 'POST'/);
});
