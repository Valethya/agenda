import type { Shift, ShiftWriteInput, TeamMembership } from '../../types';

export const TEAM_SCHEDULE_SOURCE = '/team';
export const SHIFT_SCHEDULE_ENDPOINT = '/availability/shifts';
export const SCHEDULE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const isScheduleCandidate = (member: TeamMembership): boolean =>
  member.isActive === true && member.isBookable === true;

export const filterScheduleCandidates = (members: TeamMembership[]): TeamMembership[] =>
  members.filter(isScheduleCandidate);

export const createClosedScheduleDay = (workerId: string, dayOfWeek: number): Shift => ({
  worker: workerId,
  dayOfWeek,
  isOpen: false,
  startTime: '09:00',
  endTime: '18:00',
  breaks: []
});

export const buildSevenDaySchedule = (workerId: string, shifts: Shift[]): Shift[] =>
  SCHEDULE_DAY_ORDER.map((dayOfWeek) => {
    const persisted = shifts.find((shift) => shift.dayOfWeek === dayOfWeek);
    return persisted
      ? {
          ...persisted,
          breaks: persisted.breaks.map((entry) => ({ ...entry }))
        }
      : createClosedScheduleDay(workerId, dayOfWeek);
  });

export const buildShiftWriteInput = (workerId: string, shift: Shift): ShiftWriteInput => ({
  workerId,
  dayOfWeek: shift.dayOfWeek,
  isOpen: shift.isOpen,
  startTime: shift.startTime,
  endTime: shift.endTime,
  breaks: shift.breaks.map((entry) => ({
    startTime: entry.startTime,
    endTime: entry.endTime
  }))
});

export const mergeCanonicalShift = (schedule: Shift[], saved: Shift): Shift[] =>
  schedule.map((shift) => shift.dayOfWeek === saved.dayOfWeek
    ? { ...saved, breaks: saved.breaks.map((entry) => ({ ...entry })) }
    : shift);
