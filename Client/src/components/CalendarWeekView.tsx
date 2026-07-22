import React from 'react';
import styles from './CalendarWeekView.module.scss';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { formatLocalDateStr, generateHoras, getBusinessHoursBounds } from '../utils/time';
import {
  buildWeekColumns,
  calculateOverlappingLayouts,
  filterAppointmentsForColumns
} from '../features/calendar-grid/calendarGridRules';
import { useCalendarTimeline } from '../features/calendar-grid/useCalendarTimeline';
import {
  CalendarAppointmentsLayer,
  CalendarGridSlots,
  CalendarScheduleOverlays,
  CalendarTimeline
} from '../features/calendar-grid/CalendarGridLayers';

const WEEKDAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const CalendarWeekView: React.FC = () => {
  const { currentDate, selectedProfessionalId } = useCalendarNavigation();
  const { citas, profs, businessConfig, shifts } = useCalendarData();
  const slotDuration = businessConfig.appointmentSettings?.slotDuration || 60;
  const { startHour, endHour } = getBusinessHoursBounds(businessConfig);
  const hours = generateHoras(slotDuration, startHour, endHour);

  const selectedProfessional = selectedProfessionalId
    ? profs.find(professional => professional._id === selectedProfessionalId) || null
    : null;
  const columns = buildWeekColumns(currentDate, selectedProfessional);
  const appointments = filterAppointmentsForColumns(citas, columns);
  const layouts = calculateOverlappingLayouts(appointments, columns);
  const activeDateKeys = columns.map(column => formatLocalDateStr(column.date));
  const minutesSinceStart = useCalendarTimeline(activeDateKeys, startHour, endHour);
  const gridTemplateColumns = '60px repeat(7, 1fr)';
  const todayKey = formatLocalDateStr(new Date());

  return (
    <div className={styles.container}>
      <div className={styles.weekHeader} style={{ gridTemplateColumns }}>
        <div className={styles.weekHeaderTime} />
        {columns.map((column, index) => {
          const isToday = formatLocalDateStr(column.date) === todayKey;
          return (
            <div
              key={column.key}
              className={`${styles.dayColHeader} ${isToday ? styles.today : ''}`}
            >
              <div className={styles.dayName}>{WEEKDAY_NAMES[index]}</div>
              <div className={styles.dayNum}>{column.date.getDate()}</div>
            </div>
          );
        })}
      </div>

      <div
        className={styles.weekGrid}
        id="weekGrid"
        style={{
          gridTemplateColumns,
          gridTemplateRows: `repeat(${hours.length}, 52px)`
        }}
      >
        <CalendarGridSlots
          hours={hours}
          columns={columns}
          timeLabelClassName={styles.timeLabel}
          cellClassName={styles.weekCell}
          lastCellClassName={styles.lastCol}
        />
        <CalendarScheduleOverlays
          columns={columns}
          shifts={shifts}
          rowCount={hours.length}
          slotDuration={slotDuration}
          startHour={startHour}
          dayOffClassName={styles.dayOffOverlay}
          breakClassName={styles.descanso}
        />
        <CalendarAppointmentsLayer
          appointments={appointments}
          columns={columns}
          slotDuration={slotDuration}
          startHour={startHour}
          layouts={layouts}
        />
        <CalendarTimeline minutes={minutesSinceStart} className={styles.nowLine} />
      </div>
    </div>
  );
};

export default CalendarWeekView;
