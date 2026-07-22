import React from 'react';
import styles from './CalendarDayView.module.scss';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { formatLocalDateStr, generateHoras, getBusinessHoursBounds } from '../utils/time';
import { getPersonAvatarGradient, getPersonInitials } from '../utils/avatar';
import {
  buildDayColumns,
  filterAppointmentsForColumns
} from '../features/calendar-grid/calendarGridRules';
import { useCalendarTimeline } from '../features/calendar-grid/useCalendarTimeline';
import {
  CalendarAppointmentsLayer,
  CalendarGridSlots,
  CalendarScheduleOverlays,
  CalendarTimeline
} from '../features/calendar-grid/CalendarGridLayers';

export const CalendarDayView: React.FC = () => {
  const { currentDate, selectedProfessionalId } = useCalendarNavigation();
  const { citas, profs, businessConfig, shifts } = useCalendarData();
  const slotDuration = businessConfig.appointmentSettings?.slotDuration || 60;
  const { startHour, endHour } = getBusinessHoursBounds(businessConfig);
  const hours = generateHoras(slotDuration, startHour, endHour);

  const activeProfessionals = selectedProfessionalId
    ? profs.filter(professional => professional._id === selectedProfessionalId)
    : profs;
  const columns = buildDayColumns(currentDate, activeProfessionals);
  const appointments = filterAppointmentsForColumns(citas, columns);
  const minutesSinceStart = useCalendarTimeline(
    [formatLocalDateStr(currentDate)],
    startHour,
    endHour
  );

  const columnCount = Math.max(columns.length, 1);
  const gridTemplateColumns = `60px repeat(${columnCount}, 1fr)`;

  return (
    <div className={styles.container}>
      <div className={styles.dayHeader} style={{ gridTemplateColumns }}>
        <div className={styles.headerTime} />
        {activeProfessionals.map((professional, index) => (
          <div key={professional._id} className={styles.profColHeader}>
            <div
              className={styles.profAvatar}
              style={{ background: getPersonAvatarGradient(index) }}
            >
              {getPersonInitials(professional.firstName, professional.lastName)}
            </div>
            <div className={styles.profInfo}>
              <div className={styles.profName}>
                {professional.firstName} {professional.lastName.split(' ')[0]}
              </div>
              <div className={styles.profRole}>
                {professional.role === 'admin'
                  ? 'Administrador'
                  : businessConfig.professionalRoleLabel || 'Especialista'}
              </div>
            </div>
          </div>
        ))}
        {activeProfessionals.length === 0 && (
          <div className={styles.profColHeader}>
            <div className={styles.profInfo}>
              <div className={styles.profName}>Sin profesionales activos</div>
            </div>
          </div>
        )}
      </div>

      <div
        className={styles.dayGrid}
        id="dayGrid"
        style={{
          gridTemplateColumns,
          gridTemplateRows: `repeat(${hours.length}, 52px)`
        }}
      >
        <CalendarGridSlots
          hours={hours}
          columns={columns}
          timeLabelClassName={styles.timeLabel}
          cellClassName={styles.dayCell}
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
        />
        <CalendarTimeline minutes={minutesSinceStart} className={styles.nowLine} />
      </div>
    </div>
  );
};

export default CalendarDayView;
