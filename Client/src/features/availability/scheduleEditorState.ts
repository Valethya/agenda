import type { Shift } from '../../types';
import { buildSevenDaySchedule, buildShiftWriteInput, mergeCanonicalShift } from './scheduleRules';

export interface ScheduleEditorState {
  canonicalSchedule: Shift[];
  draftSchedule: Shift[];
  dirtyDays: number[];
  saving: boolean;
}

export interface ScheduleSaveDependencies {
  saveShift: (input: ReturnType<typeof buildShiftWriteInput>) => Promise<Shift>;
  loadShifts: () => Promise<Shift[]>;
}

export interface ScheduleSaveResult {
  state: ScheduleEditorState;
  error: unknown | null;
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

export const persistPreparedSchedule = async (
  state: ScheduleEditorState,
  workerId: string,
  dependencies: ScheduleSaveDependencies
): Promise<ScheduleSaveResult> => {
  if (!state.saving || state.dirtyDays.length === 0) {
    return { state, error: null };
  }

  try {
    const savedShifts: Shift[] = [];
    for (const dayOfWeek of [...state.dirtyDays].sort((left, right) => left - right)) {
      const day = state.draftSchedule.find((shift) => shift.dayOfWeek === dayOfWeek);
      if (!day) continue;
      savedShifts.push(await dependencies.saveShift(buildShiftWriteInput(workerId, day)));
    }
    return {
      state: applyCanonicalSaveResponses(state, savedShifts),
      error: null
    };
  } catch (error) {
    try {
      const shifts = await dependencies.loadShifts();
      return {
        state: reconcileScheduleEditor(workerId, shifts),
        error
      };
    } catch {
      return {
        state: discardScheduleDraft({ ...state, saving: false }),
        error
      };
    }
  }
};
