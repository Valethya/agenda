import type { Appointment, Break, Professional, Shift } from '../../types';
import { getWeekDays } from '../../utils/calendarDate.ts';
import {
  formatLocalDateStr,
  getWorkerDaysOff,
  parseUTCDateToLocal,
  timeToMinutes
} from '../../utils/time.ts';

export interface CalendarGridColumn {
  key: string;
  date: Date;
  professional: Professional | null;
  professionalId: string | null;
}

export interface CalendarColumnSchedule {
  isOff: boolean;
  breaks: Break[];
}

export interface AppointmentLayout {
  left?: string;
  width?: string;
  right?: string;
}

type EntityReference = string | { _id: string };

export function getEntityId(reference: EntityReference): string {
  return typeof reference === 'object' ? reference._id : reference;
}

export function buildDayColumns(date: Date, professionals: Professional[]): CalendarGridColumn[] {
  return professionals.map(professional => ({
    key: `day:${professional._id}`,
    date: new Date(date),
    professional,
    professionalId: professional._id
  }));
}

export function buildWeekColumns(date: Date, professional: Professional | null): CalendarGridColumn[] {
  return getWeekDays(date).map(day => ({
    key: `week:${formatLocalDateStr(day)}`,
    date: day,
    professional,
    professionalId: professional?._id || null
  }));
}

export function findAppointmentColumnIndex(
  appointment: Appointment,
  columns: CalendarGridColumn[]
): number {
  const appointmentDate = formatLocalDateStr(parseUTCDateToLocal(appointment.date));
  const workerId = getEntityId(appointment.worker);

  return columns.findIndex(column => (
    formatLocalDateStr(column.date) === appointmentDate
    && (!column.professionalId || column.professionalId === workerId)
  ));
}

export function filterAppointmentsForColumns(
  appointments: Appointment[],
  columns: CalendarGridColumn[]
): Appointment[] {
  return appointments.filter(appointment => findAppointmentColumnIndex(appointment, columns) >= 0);
}

export function getColumnSchedule(
  column: CalendarGridColumn,
  shifts: Shift[]
): CalendarColumnSchedule {
  if (!column.professional || !column.professionalId) {
    return { isOff: false, breaks: [] };
  }

  const workerShifts = shifts.filter(shift => getEntityId(shift.worker) === column.professionalId);
  const dayOfWeek = column.date.getDay();
  const isOff = getWorkerDaysOff(column.professional.email, workerShifts).includes(dayOfWeek);
  const shift = workerShifts.find(candidate => candidate.dayOfWeek === dayOfWeek);

  return {
    isOff,
    breaks: !isOff && shift?.isOpen ? shift.breaks || [] : []
  };
}

export function calculateOverlappingLayouts(
  appointments: Appointment[],
  columns: CalendarGridColumn[]
): Map<string, AppointmentLayout> {
  const layouts = new Map<string, AppointmentLayout>();

  columns.forEach((_, columnIndex) => {
    const columnAppointments = appointments
      .filter(appointment => findAppointmentColumnIndex(appointment, columns) === columnIndex)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const groups: Appointment[][] = [];
    let currentGroup: Appointment[] = [];
    let currentGroupEnd = 0;

    columnAppointments.forEach(appointment => {
      const start = timeToMinutes(appointment.startTime);
      const end = timeToMinutes(appointment.endTime || appointment.startTime);

      if (currentGroup.length === 0 || start < currentGroupEnd) {
        currentGroup.push(appointment);
        currentGroupEnd = Math.max(currentGroupEnd, end);
      } else {
        groups.push(currentGroup);
        currentGroup = [appointment];
        currentGroupEnd = end;
      }
    });

    if (currentGroup.length > 0) groups.push(currentGroup);

    groups.forEach(group => {
      const columnEnds: number[] = [];
      const assignments = group.map(appointment => {
        const start = timeToMinutes(appointment.startTime);
        const end = timeToMinutes(appointment.endTime || appointment.startTime);
        let overlapColumn = columnEnds.findIndex(columnEnd => columnEnd <= start);

        if (overlapColumn === -1) {
          overlapColumn = columnEnds.length;
          columnEnds.push(end);
        } else {
          columnEnds[overlapColumn] = end;
        }

        return { appointment, overlapColumn };
      });

      if (columnEnds.length <= 1) return;

      assignments.forEach(({ appointment, overlapColumn }) => {
        const widthPercent = 100 / columnEnds.length;
        layouts.set(appointment._id, {
          left: `calc(${overlapColumn * widthPercent}% + 2px)`,
          width: `calc(${widthPercent}% - 4px)`,
          right: 'auto'
        });
      });
    });
  });

  return layouts;
}

export function getCurrentTimelineMinutes(
  now: Date,
  activeDateKeys: string[],
  startHour: number,
  endHour: number
): number | null {
  if (!activeDateKeys.includes(formatLocalDateStr(now))) return null;

  const minutes = (now.getHours() - startHour) * 60 + now.getMinutes();
  const totalCalendarMinutes = (endHour - startHour) * 60;
  return minutes >= 0 && minutes < totalCalendarMinutes ? minutes : null;
}
