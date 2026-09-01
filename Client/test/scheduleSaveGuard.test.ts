import assert from 'node:assert/strict';
import test from 'node:test';
import type { Shift } from '../src/types/index.ts';
import {
  beginScheduleSave,
  createScheduleEditorState,
  editScheduleDay,
  persistPreparedSchedule
} from '../src/features/availability/scheduleEditorState.ts';
import { runWithScheduleSaveGuard } from '../src/features/availability/scheduleSaveGuard.ts';

const shift = (overrides: Partial<Shift> = {}): Shift => ({
  worker: 'worker-a',
  dayOfWeek: 1,
  isOpen: true,
  startTime: '09:00',
  endTime: '18:00',
  breaks: [],
  ...overrides
});

const prepareDirtyState = (dayOfWeek: number) => {
  let state = createScheduleEditorState('worker-a', []);
  state = editScheduleDay(state, dayOfWeek, (day) => ({
    ...day,
    isOpen: true
  }));
  return beginScheduleSave(state);
};

test('guard síncrono impide reentrada antes del render y vuelve a liberar el save', async () => {
  const guard = { current: false };
  const firstState = prepareDirtyState(2);
  let saveCalls = 0;
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const persist = async (state: typeof firstState, block: boolean) => persistPreparedSchedule(
    state,
    'worker-a',
    {
      saveShift: async (payload) => {
        saveCalls += 1;
        if (block) await firstPending;
        return shift({
          dayOfWeek: payload.dayOfWeek,
          isOpen: payload.isOpen,
          startTime: payload.startTime,
          endTime: payload.endTime,
          breaks: payload.breaks
        });
      },
      loadShifts: async () => []
    }
  );

  const firstAttempt = runWithScheduleSaveGuard(guard, () => persist(firstState, true));
  await Promise.resolve();

  assert.equal(guard.current, true);
  assert.equal(saveCalls, 1);

  const secondAttempt = await runWithScheduleSaveGuard(guard, () => persist(firstState, false));
  assert.equal(secondAttempt.acquired, false);
  assert.equal(saveCalls, 1);

  releaseFirst();
  const firstResult = await firstAttempt;
  assert.equal(firstResult.acquired, true);
  assert.equal(firstResult.value?.error, null);
  assert.equal(guard.current, false);
  assert.equal(saveCalls, 1);

  const laterState = prepareDirtyState(3);
  const laterAttempt = await runWithScheduleSaveGuard(guard, () => persist(laterState, false));
  assert.equal(laterAttempt.acquired, true);
  assert.equal(laterAttempt.value?.error, null);
  assert.equal(saveCalls, 2);
  assert.equal(guard.current, false);
});

test('guard síncrono se libera aunque la operación lance una excepción', async () => {
  const guard = { current: false };

  await assert.rejects(
    runWithScheduleSaveGuard(guard, async () => {
      throw new Error('fallo inesperado fuera de persistPreparedSchedule');
    }),
    /fallo inesperado/
  );

  assert.equal(guard.current, false);

  const retry = await runWithScheduleSaveGuard(guard, async () => 'ok');
  assert.equal(retry.acquired, true);
  assert.equal(retry.value, 'ok');
  assert.equal(guard.current, false);
});
