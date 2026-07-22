import React from 'react';
import type { Appointment, Shift } from '../../types';
import AppointmentCard from '../../components/AppointmentCard';
import { timeRangeToSlotSpan, timeToRowIndex } from '../../utils/time';
import {
  findAppointmentColumnIndex,
  getColumnSchedule,
  type AppointmentLayout,
  type CalendarGridColumn
} from './calendarGridRules';

const GRID_ROW_HEIGHT = 52;

interface CalendarGridSlotsProps {
  hours: string[];
  columns: CalendarGridColumn[];
  timeLabelClassName: string;
  cellClassName: string;
  lastCellClassName: string;
}

export const CalendarGridSlots: React.FC<CalendarGridSlotsProps> = ({
  hours,
  columns,
  timeLabelClassName,
  cellClassName,
  lastCellClassName
}) => {
  const columnKeys = columns.length > 0 ? columns.map(column => column.key) : ['empty'];

  return hours.map((hour, rowIndex) => (
    <React.Fragment key={hour}>
      <div className={timeLabelClassName}>{hour}</div>
      {columnKeys.map((columnKey, columnIndex) => (
        <div
          key={`${columnKey}-${hour}`}
          className={`${cellClassName} ${columnIndex === columnKeys.length - 1 ? lastCellClassName : ''}`}
          style={{ gridColumn: columnIndex + 2, gridRow: rowIndex + 1 }}
        />
      ))}
    </React.Fragment>
  ));
};

interface CalendarScheduleOverlaysProps {
  columns: CalendarGridColumn[];
  shifts: Shift[];
  rowCount: number;
  slotDuration: number;
  startHour: number;
  dayOffClassName: string;
  breakClassName: string;
}

export const CalendarScheduleOverlays: React.FC<CalendarScheduleOverlaysProps> = ({
  columns,
  shifts,
  rowCount,
  slotDuration,
  startHour,
  dayOffClassName,
  breakClassName
}) => (
  <>
    {columns.map((column, columnIndex) => {
      const schedule = getColumnSchedule(column, shifts);
      if (!schedule.isOff) return null;

      return (
        <div
          key={`dayoff-${column.key}`}
          className={dayOffClassName}
          style={{
            gridColumn: `${columnIndex + 2} / span 1`,
            gridRow: `1 / span ${rowCount}`,
            '--col-idx': columnIndex,
            '--total-cols': columns.length
          } as React.CSSProperties}
        />
      );
    })}

    {columns.flatMap((column, columnIndex) => {
      const schedule = getColumnSchedule(column, shifts);
      return schedule.breaks.map((breakItem, breakIndex) => {
        const row = timeToRowIndex(breakItem.startTime, slotDuration, startHour);
        const span = timeRangeToSlotSpan(
          breakItem.startTime,
          breakItem.endTime,
          slotDuration,
          startHour
        );

        return (
          <div
            key={`break-${column.key}-${breakIndex}`}
            className={breakClassName}
            style={{
              gridColumn: `${columnIndex + 2} / span 1`,
              gridRow: `${row} / span ${span}`,
              height: `${span * GRID_ROW_HEIGHT}px`,
              '--col-idx': columnIndex,
              '--total-cols': columns.length
            } as React.CSSProperties}
          />
        );
      });
    })}
  </>
);

interface CalendarAppointmentsLayerProps {
  appointments: Appointment[];
  columns: CalendarGridColumn[];
  slotDuration: number;
  startHour: number;
  layouts?: Map<string, AppointmentLayout>;
}

export const CalendarAppointmentsLayer: React.FC<CalendarAppointmentsLayerProps> = ({
  appointments,
  columns,
  slotDuration,
  startHour,
  layouts = new Map()
}) => (
  <>
    {appointments.map(appointment => {
      const columnIndex = findAppointmentColumnIndex(appointment, columns);
      if (columnIndex < 0) return null;

      const row = timeToRowIndex(appointment.startTime, slotDuration, startHour);
      const span = appointment.endTime
        ? timeRangeToSlotSpan(appointment.startTime, appointment.endTime, slotDuration, startHour)
        : 1;

      return (
        <AppointmentCard
          key={appointment._id}
          appointment={appointment}
          size="medium"
          style={{
            gridColumn: `${columnIndex + 2} / span 1`,
            gridRow: `${row} / span ${span}`,
            top: '3px',
            height: `calc(${span * GRID_ROW_HEIGHT}px - 6px)`,
            ...(layouts.get(appointment._id) || {})
          }}
        />
      );
    })}
  </>
);

export const CalendarTimeline: React.FC<{ minutes: number | null; className: string }> = ({
  minutes,
  className
}) => minutes === null ? null : (
  <div className={className} style={{ top: `${(minutes / 60) * GRID_ROW_HEIGHT}px` }} />
);
