import type { Shift } from '../../types';
import { buildSevenDaySchedule, mergeCanonicalShift } from './scheduleRules';

export interface ScheduleEditorState {
  canonicalSchedule: Shift[];
  draftSchedule: Shift[];
  dirtyDays: number[];
  saving: boolean;
}

export const cloneSchedule = (schedule: Shift[]): Shift[] => schedule.map((shift) => ({
  ...shift,
  breaks: shift.breaks.map((entry) => ({ ...entry }))
}));

export const createScheduleEditorState = (workerId: string, shifts: Shift[]): ScheduleEditorState => {
  const canonicalSchedule = buildSevenDaySchedule(workerId, shifts);
  return {
    canonicalSchedule,
    draftSchedule: cloneSchedule(canonicalSchedule),
    dirtyDays: [],
    saving: false
  };
};

export const editScheduleDay = (
  state: ScheduleEditorState,
  dayOfWeek: number,
  updater: (shift: Shift) => Shift
): ScheduleEditorState => {
  if (state.saving) return state;
  const dirtyDays = state.dirtyDays.includes(dayOfWeek)
    ? state.dirtyDays
    : [...state.dirtyDays, dayOfWeek];
  return {
    ...state,
    draftSchedule: state.draftSchedule.map((shift) =>
      shift.dayOfWeek === dayOfWeek ? updater(shift) : shift
    ),
    dirtyDays
  };
};

export const beginScheduleSave = (state: ScheduleEditorState): ScheduleEditorState => {
  if (state.saving || state.dirtyDays.length === 0) return state;
  return { ...state, saving: true };
};

export const applyCanonicalSaveResponses = (
  state: ScheduleEditorState,
  savedShifts: Shift[]
): ScheduleEditorState => {
  let canonicalSchedule = cloneSchedule(state.canonicalSchedule);
  for (const saved of savedShifts) {
    canonicalSchedule = mergeCanonicalShift(canonicalSchedule, saved);
  }
  return {
    canonicalSchedule,
    draftSchedule: cloneSchedule(canonicalSchedule),
    dirtyDays: [],
    saving: false
  };
};

export const reconcileScheduleEditor = (
  workerId: string,
  shifts: Shift[]
): ScheduleEditorState => createScheduleEditorState(workerId, shifts);

export const discardScheduleDraft = (state: ScheduleEditorState): ScheduleEditorState => ({
  ...state,
  draftSchedule: cloneSchedule(state.canonicalSchedule),
  dirtyDays: [],
  saving: false
});
