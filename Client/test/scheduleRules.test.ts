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
import {
  beginScheduleSave,
  createScheduleEditorState,
  discardScheduleDraft,
  editScheduleDay,
  persistPreparedSchedule,
  reconcileScheduleEditor
} from '../src/features/availability/scheduleEditorState.ts';

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
  const state = createScheduleEditorState('worker-a', [
    shift({ worker: 'worker-a', dayOfWeek: 1, isOpen: true })
  ]);

  assert.deepEqual(state.draftSchedule.map((day) => day.dayOfWeek), [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(state.draftSchedule.length, 7);
  assert.equal(state.draftSchedule[0].isOpen, true);
  assert.equal(state.draftSchedule[1].isOpen, false);
  assert.equal(state.dirtyDays.length, 0);
});

test('cargar un día ausente no dispara guardado ni marca dirty state', async () => {
  const state = createScheduleEditorState('worker-a', []);
  let saveCalls = 0;
  const result = await persistPreparedSchedule(state, 'worker-a', {
    saveShift: async () => {
      saveCalls += 1;
      return shift();
    },
    loadShifts: async () => []
  });

  assert.equal(saveCalls, 0);
  assert.equal(result.state.dirtyDays.length, 0);
  assert.equal(result.state.draftSchedule.every((day) => day.isOpen === false), true);
});

test('editar un único día marca exclusivamente ese día', () => {
  const initial = createScheduleEditorState('worker-a', []);
  const edited = editScheduleDay(initial, 3, (day) => ({ ...day, isOpen: true }));

  assert.deepEqual(edited.dirtyDays, [3]);
  assert.equal(edited.draftSchedule.find((day) => day.dayOfWeek === 3)?.isOpen, true);
  assert.equal(edited.draftSchedule.find((day) => day.dayOfWeek === 2)?.isOpen, false);
});

test('guardar persiste exclusivamente días modificados y usa respuesta canónica', async () => {
  let state = createScheduleEditorState('worker-a', []);
  state = editScheduleDay(state, 4, (day) => ({
    ...day,
    isOpen: true,
    startTime: '10:00',
    endTime: '17:00'
  }));
  state = beginScheduleSave(state);

  const payloads: Array<ReturnType<typeof buildShiftWriteInput>> = [];
  const result = await persistPreparedSchedule(state, 'worker-a', {
    saveShift: async (payload) => {
      payloads.push(payload);
      return shift({
        worker: 'worker-a',
        dayOfWeek: payload.dayOfWeek,
        isOpen: payload.isOpen,
        startTime: '10:30',
        endTime: '16:30',
        breaks: payload.breaks
      });
    },
    loadShifts: async () => []
  });

  assert.deepEqual(payloads.map((payload) => payload.dayOfWeek), [4]);
  assert.equal(result.error, null);
  assert.equal(result.state.canonicalSchedule.find((day) => day.dayOfWeek === 4)?.startTime, '10:30');
  assert.equal(result.state.draftSchedule.find((day) => day.dayOfWeek === 4)?.endTime, '16:30');
  assert.deepEqual(result.state.dirtyDays, []);
  assert.equal(result.state.saving, false);
});

test('saving bloquea doble submit y nuevas ediciones', () => {
  let state = createScheduleEditorState('worker-a', []);
  state = editScheduleDay(state, 2, (day) => ({ ...day, isOpen: true }));
  const saving = beginScheduleSave(state);
  const secondBegin = beginScheduleSave(saving);
  const attemptedEdit = editScheduleDay(saving, 3, (day) => ({ ...day, isOpen: true }));

  assert.equal(saving.saving, true);
  assert.equal(secondBegin, saving);
  assert.equal(attemptedEdit, saving);
  assert.deepEqual(saving.dirtyDays, [2]);
});

test('fallo de guardado recarga autoridad y elimina optimismo falso', async () => {
  let state = createScheduleEditorState('worker-a', [
    shift({ worker: 'worker-a', dayOfWeek: 1, startTime: '09:00' })
  ]);
  state = editScheduleDay(state, 1, (day) => ({ ...day, startTime: '12:00' }));
  state = beginScheduleSave(state);
  let reloads = 0;

  const result = await persistPreparedSchedule(state, 'worker-a', {
    saveShift: async () => { throw new Error('rechazado'); },
    loadShifts: async () => {
      reloads += 1;
      return [shift({ worker: 'worker-a', dayOfWeek: 1, startTime: '08:30', endTime: '17:30' })];
    }
  });

  assert.equal(reloads, 1);
  assert.match((result.error as Error).message, /rechazado/);
  assert.equal(result.state.canonicalSchedule.find((day) => day.dayOfWeek === 1)?.startTime, '08:30');
  assert.equal(result.state.draftSchedule.find((day) => day.dayOfWeek === 1)?.startTime, '08:30');
  assert.deepEqual(result.state.dirtyDays, []);
  assert.equal(result.state.saving, false);
});

test('cerrar edición sin guardar descarta draft y restaura canónico', () => {
  let state = createScheduleEditorState('worker-a', [shift({ worker: 'worker-a', dayOfWeek: 1 })]);
  state = editScheduleDay(state, 1, (day) => ({ ...day, startTime: '14:00' }));
  const discarded = discardScheduleDraft(state);

  assert.equal(discarded.draftSchedule.find((day) => day.dayOfWeek === 1)?.startTime, '09:00');
  assert.equal(discarded.canonicalSchedule.find((day) => day.dayOfWeek === 1)?.startTime, '09:00');
  assert.deepEqual(discarded.dirtyDays, []);
});

test('cambiar profesional reemplaza estado y no conserva dirty state anterior', () => {
  let state = createScheduleEditorState('worker-a', []);
  state = editScheduleDay(state, 5, (day) => ({ ...day, isOpen: true }));
  const nextProfessional = reconcileScheduleEditor('worker-b', [
    shift({ worker: 'worker-b', dayOfWeek: 2, startTime: '11:00' })
  ]);

  assert.deepEqual(state.dirtyDays, [5]);
  assert.deepEqual(nextProfessional.dirtyDays, []);
  assert.equal(nextProfessional.draftSchedule.every((day) => day.worker === 'worker-b'), true);
  assert.equal(nextProfessional.draftSchedule.find((day) => day.dayOfWeek === 2)?.startTime, '11:00');
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

test('merge canónico conserva la respuesta confirmada del backend', () => {
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

test('policy auxiliar: la vista administrativa sigue usando Team y no workers legacy', () => {
  const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const viewSource = readFileSync(new URL('../src/components/ScheduleManagementView.tsx', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');
  const rulesSource = readFileSync(new URL('../src/features/availability/scheduleRules.ts', import.meta.url), 'utf8');

  assert.equal(SHIFT_SCHEDULE_ENDPOINT, '/availability/shifts');
  assert.match(viewSource, /api\.getTeam\(\)/);
  assert.match(viewSource, /filterScheduleCandidates/);
  assert.doesNotMatch(viewSource, /getWorkers|internal\/users\/workers/);
  assert.doesNotMatch(rulesSource, /member\.role\s*===\s*['"]worker['"]|role\s*===\s*['"]worker['"]/);
  assert.match(dashboardSource, /viewType === 'horarios'.*<ScheduleManagementView/s);
  assert.match(apiSource, /getTeam\(\)/);
});
