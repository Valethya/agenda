import React, { useEffect, useState } from 'react';
import styles from './CalendarWeekView.module.scss';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import {
  formatLocalDateStr,
  generateHoras,
  getBusinessHoursBounds,
  getWorkerDaysOff,
  parseUTCDateToLocal,
  timeRangeToSlotSpan,
  timeToMinutes,
  timeToRowIndex
} from '../utils/time';
import { getEndOfWeek, getStartOfWeek, getWeekDays } from '../utils/calendarDate';
import AppointmentCard from './AppointmentCard';
import type { Appointment } from '../types';

export const CalendarWeekView: React.FC = () => {
  const { currentDate, selectedProfessionalId } = useCalendarNavigation();
  const { citas, profs, businessConfig, shifts } = useCalendarData();
  
  const slotDuration = businessConfig.appointmentSettings?.slotDuration || 60;
  const { startHour, endHour } = getBusinessHoursBounds(businessConfig);
  const HORAS = generateHoras(slotDuration, startHour, endHour);

  const [minutesSinceEight, setMinutesSinceEight] = useState<number | null>(null);

  useEffect(() => {
    const updateTimeLine = () => {
      const now = new Date();
      // Check if today is within the active week
      const start = getStartOfWeek(currentDate);
      const end = getEndOfWeek(currentDate);
      
      if (now >= start && now <= end) {
        const mins = (now.getHours() - startHour) * 60 + now.getMinutes();
        const totalCalendarMins = (endHour - startHour) * 60;
        if (mins >= 0 && mins < totalCalendarMins) {
          setMinutesSinceEight(mins);
          return;
        }
      }
      setMinutesSinceEight(null);
    };

    updateTimeLine();
    const interval = setInterval(updateTimeLine, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [currentDate, startHour, endHour]);

  // Generate 7 days of the active week (Monday to Sunday)
  const weekDays = getWeekDays(currentDate);

  const weekDateStrings = weekDays.map(d => formatLocalDateStr(d));
  const weekdaysNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // Filter appointments that belong to the active week
  let weekAppointments = citas.filter(c => {
    const cDate = parseUTCDateToLocal(c.date);
    return weekDateStrings.includes(formatLocalDateStr(cDate));
  });

  // Filter by selected professional if active
  if (selectedProfessionalId) {
    weekAppointments = weekAppointments.filter(c => {
      const wId = typeof c.worker === 'object' ? c.worker._id : c.worker;
      return wId === selectedProfessionalId;
    });
  }

  // Map to store overlapping styles for week appointments (grouped by day)
  const layoutStyles = new Map<string, { left?: string; width?: string; right?: string }>();

  weekDateStrings.forEach((dateStr) => {
    const dayApps = weekAppointments.filter(c => {
      const cDate = parseUTCDateToLocal(c.date);
      return formatLocalDateStr(cDate) === dateStr;
    });

    const sortedApps = [...dayApps].sort((a, b) => 
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
    );

    // Group overlapping appointments
    const groups: Appointment[][] = [];
    let currentGroup: Appointment[] = [];
    let currentGroupEnd = 0;

    sortedApps.forEach(app => {
      const start = timeToMinutes(app.startTime);
      const end = timeToMinutes(app.endTime || app.startTime);
      
      if (currentGroup.length === 0 || start < currentGroupEnd) {
        currentGroup.push(app);
        currentGroupEnd = Math.max(currentGroupEnd, end);
      } else {
        groups.push(currentGroup);
        currentGroup = [app];
        currentGroupEnd = end;
      }
    });
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    groups.forEach(group => {
      const columns: number[] = [];
      const appColumns = group.map(app => {
        const start = timeToMinutes(app.startTime);
        const end = timeToMinutes(app.endTime || app.startTime);
        
        let colIdx = -1;
        for (let i = 0; i < columns.length; i++) {
          if (columns[i] <= start) {
            colIdx = i;
            columns[i] = end;
            break;
          }
        }
        if (colIdx === -1) {
          colIdx = columns.length;
          columns.push(end);
        }
        return { app, colIdx };
      });

      const totalCols = columns.length;
      appColumns.forEach(({ app, colIdx }) => {
        if (totalCols > 1) {
          const widthPercent = 100 / totalCols;
          const leftPercent = colIdx * widthPercent;
          layoutStyles.set(app._id, {
            left: `calc(${leftPercent}% + 2px)`,
            width: `calc(${widthPercent}% - 4px)`,
            right: 'auto'
          });
        }
      });
    });
  });

  const gridTemplateColumns = '60px repeat(7, 1fr)';

  return (
    <div className={styles.container}>
      {/* Header showing Weekdays */}
      <div className={styles.weekHeader} style={{ gridTemplateColumns }}>
        <div className={styles.weekHeaderTime} />
        {weekDays.map((dayDate, idx) => {
          const isToday = formatLocalDateStr(dayDate) === formatLocalDateStr(new Date());
          return (
            <div key={idx} className={`${styles.dayColHeader} ${isToday ? styles.today : ''}`}>
              <div className={styles.dayName}>{weekdaysNames[idx]}</div>
              <div className={styles.dayNum}>{dayDate.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Grid of hours */}
      <div 
        className={styles.weekGrid} 
        id="weekGrid" 
        style={{ 
          gridTemplateColumns,
          gridTemplateRows: `repeat(${HORAS.length}, 52px)`
        }}
      >
        {/* Hours labels and empty cells */}
        {HORAS.map((hora, rowIdx) => (
          <React.Fragment key={hora}>
            <div className={styles.timeLabel}>
              {hora}
            </div>
            {weekDays.map((_, colIdx) => {
              const isLastCol = colIdx === 6;
              return (
                <div 
                  key={`${colIdx}-${hora}`}
                  className={`${styles.weekCell} ${isLastCol ? styles.lastCol : ''}`}
                  style={{
                    gridColumn: colIdx + 2,
                    gridRow: rowIdx + 1
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}

        {/* Days Off Overlay */}
        {selectedProfessionalId && weekDays.map((dayDate, colIdx) => {
          const dayOfWeek = dayDate.getDay();
          const p = profs.find(p => p._id === selectedProfessionalId);
          if (!p) return null;

          const pShifts = shifts.filter(s => s.worker === p._id || (typeof s.worker === 'object' && s.worker._id === p._id));
          const isOff = getWorkerDaysOff(p.email, pShifts).includes(dayOfWeek);
          if (!isOff) return null;

          return (
            <div 
              key={`dayoff-week-${colIdx}`}
              className={styles.dayOffOverlay}
              style={{
                gridColumn: `${colIdx + 2} / span 1`,
                gridRow: `1 / span ${HORAS.length}`,
                '--col-idx': colIdx,
                '--total-cols': 7
              } as React.CSSProperties}
            />
          );
        })}

        {/* Descansos (Breaks) loaded dynamically from database shifts */}
        {selectedProfessionalId && weekDays.map((dayDate, colIdx) => {
          const dayOfWeek = dayDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          const p = profs.find(p => p._id === selectedProfessionalId);
          if (!p) return null;

          const pShifts = shifts.filter(s => s.worker === p._id || (typeof s.worker === 'object' && s.worker._id === p._id));
          const isOff = getWorkerDaysOff(p.email, pShifts).includes(dayOfWeek);
          if (isOff) return null; // No breaks on days off!

          // Find the shift for this worker and day of the week
          const workerShift = shifts.find(s => s.worker === p._id && s.dayOfWeek === dayOfWeek);
          if (!workerShift || !workerShift.isOpen || !workerShift.breaks) return null;

          return workerShift.breaks.map((brk, bIdx) => {
            const breakRow = timeToRowIndex(brk.startTime, slotDuration, startHour);
            
            let breakSpan = 1;
            if (brk.endTime && brk.startTime) {
              breakSpan = timeRangeToSlotSpan(brk.startTime, brk.endTime, slotDuration, startHour);
            }

            return (
              <div 
                key={`break-week-${colIdx}-${bIdx}`}
                className={styles.descanso}
                style={{
                  gridColumn: `${colIdx + 2} / span 1`,
                  gridRow: `${breakRow} / span ${breakSpan}`,
                  height: `${breakSpan * 52}px`,
                  '--col-idx': colIdx,
                  '--total-cols': 7
                } as React.CSSProperties}
              />
            );
          });
        })}

        {/* Render Appointments */}
        {weekAppointments.map(c => {
          const cDate = parseUTCDateToLocal(c.date);
          const dateStr = formatLocalDateStr(cDate);
          const colIdx = weekDateStrings.indexOf(dateStr);
          if (colIdx === -1) return null;

          const rowStart = timeToRowIndex(c.startTime, slotDuration, startHour);
          
          let duracion = 1;
          if (c.endTime && c.startTime) {
            duracion = timeRangeToSlotSpan(c.startTime, c.endTime, slotDuration, startHour);
          }

          const cardLayout = layoutStyles.get(c._id) || {};

          return (
            <AppointmentCard 
              key={c._id}
              appointment={c}
              size="medium"
              style={{
                gridColumn: `${colIdx + 2} / span 1`,
                gridRow: `${rowStart} / span ${duracion}`,
                top: '3px',
                height: `calc(${duracion * 52}px - 6px)`,
                ...cardLayout
              }}
            />
          );
        })}

        {/* Current timeline */}
        {minutesSinceEight !== null && (
          <div 
            className={styles.nowLine}
            style={{
              top: `${(minutesSinceEight / 60) * 52}px`
            }}
          />
        )}
      </div>
    </div>
  );
};

export default CalendarWeekView;
