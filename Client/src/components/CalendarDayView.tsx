import React, { useEffect, useState } from 'react';
import styles from './CalendarDayView.module.scss';
import { useCalendar } from '../context/CalendarContext';
import { generateHoras, timeToRowIndex, formatLocalDateStr, getWorkerDaysOff } from '../utils/time';
import AppointmentCard from './AppointmentCard';

export const CalendarDayView: React.FC = () => {
  const { currentDate, citas, profs, selectedProfessionalId, businessConfig, shifts } = useCalendar();
  const [minutesSinceEight, setMinutesSinceEight] = useState<number | null>(null);

  useEffect(() => {
    const updateTimeLine = () => {
      const now = new Date();
      if (formatLocalDateStr(currentDate) === formatLocalDateStr(now)) {
        const mins = (now.getHours() - 8) * 60 + now.getMinutes();
        if (mins >= 0 && mins < 18 * 60) {
          setMinutesSinceEight(mins);
          return;
        }
      }
      setMinutesSinceEight(null);
    };

    updateTimeLine();
    const interval = setInterval(updateTimeLine, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [currentDate]);

  const slotDuration = businessConfig.appointmentSettings?.slotDuration || 60;
  const HORAS = generateHoras(slotDuration);

  // Filter professionals to display as columns (based on filter dropdown)
  const activeProfs = selectedProfessionalId 
    ? profs.filter(p => p._id === selectedProfessionalId) 
    : profs;

  const colsCount = activeProfs.length || 1;
  const gridTemplateColumns = `60px repeat(${colsCount}, 1fr)`;

  // Filter appointments for the selected date
  const selectedDateStr = formatLocalDateStr(currentDate);
  let dayAppointments = citas.filter(c => {
    const cDate = new Date(c.date);
    return formatLocalDateStr(cDate) === selectedDateStr;
  });

  // Filter appointments by active professionals
  const activeProfIds = activeProfs.map(p => p._id);
  dayAppointments = dayAppointments.filter(c => {
    const wId = typeof c.worker === 'object' ? c.worker._id : c.worker;
    return activeProfIds.includes(wId);
  });

  const colors = [
    'linear-gradient(135deg,#8A9BAE,#7A8E9E)',
    'linear-gradient(135deg,#B5A898,#A5988A)',
    'linear-gradient(135deg,#7A9E8C,#6A8E7C)',
    'linear-gradient(135deg,#C4AA7A,#B49A6A)'
  ];

  return (
    <div className={styles.container}>
      {/* Header showing Professionals as Columns */}
      <div className={styles.dayHeader} style={{ gridTemplateColumns }}>
        <div className={styles.headerTime} />
        {activeProfs.map((p, idx) => {
          const initials = `${p.firstName[0] || ''}${p.lastName[0] || ''}`.toUpperCase();
          const color = colors[idx % colors.length];
          return (
            <div key={p._id} className={styles.profColHeader}>
              <div className={styles.profAvatar} style={{ background: color }}>{initials}</div>
              <div className={styles.profInfo}>
                <div className={styles.profName}>{p.firstName} {p.lastName.split(' ')[0]}</div>
                <div className={styles.profRole}>
                  {p.role === 'admin' ? 'Administrador' : (businessConfig.professionalRoleLabel || 'Especialista')}
                </div>
              </div>
            </div>
          );
        })}
        {activeProfs.length === 0 && (
          <div className={styles.profColHeader}>
            <div className={styles.profInfo}>
              <div className={styles.profName}>Sin profesionales activos</div>
            </div>
          </div>
        )}
      </div>

      {/* Grid of hours */}
      <div 
        className={styles.dayGrid} 
        id="dayGrid" 
        style={{ 
          gridTemplateColumns, 
          gridTemplateRows: `repeat(${HORAS.length}, 52px)` 
        }}
      >
        {/* Hours labels and empty cells */}
        {HORAS.map((hora, rowIdx) => (
          <React.Fragment key={hora}>
            <div className={styles.timeLabel}>
              {slotDuration < 60 && hora.endsWith(':30') ? '' : hora}
            </div>
            {activeProfs.map((p, colIdx) => {
              const isLastCol = colIdx === activeProfs.length - 1;
              return (
                <div 
                  key={`${p._id}-${hora}`}
                  className={`${styles.dayCell} ${isLastCol ? styles.lastCol : ''}`}
                  style={{
                    gridColumn: colIdx + 2,
                    gridRow: rowIdx + 1
                  }}
                />
              );
            })}
            {activeProfs.length === 0 && (
              <div 
                className={`${styles.dayCell} ${styles.lastCol}`}
                style={{
                  gridColumn: 2,
                  gridRow: rowIdx + 1
                }}
              />
            )}
          </React.Fragment>
        ))}

        {/* Days Off Overlay */}
        {activeProfs.map((p, colIdx) => {
          const dayOfWeek = currentDate.getDay();
          const isOff = getWorkerDaysOff(p.email).includes(dayOfWeek);
          if (!isOff) return null;
          
            return (
              <div 
                key={`dayoff-${p._id}`}
                className={styles.dayOffOverlay}
                style={{
                  gridColumn: `${colIdx + 2} / span 1`,
                  gridRow: `1 / span ${HORAS.length}`,
                  '--col-idx': colIdx,
                  '--total-cols': activeProfs.length
                } as React.CSSProperties}
              />
            );
        })}

        {/* Descansos (Breaks) loaded dynamically from database shifts */}
        {activeProfs.map((p, colIdx) => {
          const dayOfWeek = currentDate.getDay();
          const isOff = getWorkerDaysOff(p.email).includes(dayOfWeek);
          if (isOff) return null; // No breaks on days off!

          // Find the shift for this worker and day of the week
          const workerShift = shifts.find(s => s.worker === p._id && s.dayOfWeek === dayOfWeek);
          if (!workerShift || !workerShift.isOpen || !workerShift.breaks) return null;

          return workerShift.breaks.map((brk, bIdx) => {
            const breakRow = timeToRowIndex(brk.startTime, slotDuration);
            
            let breakSpan = 1;
            if (brk.endTime && brk.startTime) {
              const [hStart, mStart] = brk.startTime.split(':').map(Number);
              const startMins = hStart * 60 + mStart;
              const [hEnd, mEnd] = brk.endTime.split(':').map(Number);
              const endMins = hEnd * 60 + mEnd;
              const diffMin = endMins - startMins;
              breakSpan = Math.max(1, Math.round(diffMin / slotDuration));
            }

            return (
              <div 
                key={`break-${p._id}-${bIdx}`}
                className={styles.descanso}
                style={{
                  gridColumn: `${colIdx + 2} / span 1`,
                  gridRow: `${breakRow} / span ${breakSpan}`,
                  height: `${breakSpan * 52}px`,
                  '--col-idx': colIdx,
                  '--total-cols': activeProfs.length
                } as React.CSSProperties}
              />
            );
          });
        })}

        {/* Render Appointments */}
        {dayAppointments.map(c => {
          const workerId = typeof c.worker === 'object' ? c.worker._id : c.worker;
          const profIdx = activeProfs.findIndex(p => p._id === workerId);
          if (profIdx === -1) return null;

          const rowStart = timeToRowIndex(c.startTime, slotDuration);
          
          let duracion = 1;
          if (c.endTime && c.startTime) {
            const [hStart, mStart] = c.startTime.split(':').map(Number);
            let startMins = hStart * 60 + mStart;
            if (hStart < 8) startMins += 24 * 60;
            
            const [hEnd, mEnd] = c.endTime.split(':').map(Number);
            let endMins = hEnd * 60 + mEnd;
            if (hEnd < 8) endMins += 24 * 60;
            
            const diffMin = endMins - startMins;
            duracion = Math.max(1, Math.round(diffMin / slotDuration));
          }

          return (
            <AppointmentCard 
              key={c._id}
              appointment={c}
              size="medium"
              style={{
                gridColumn: `${profIdx + 2} / span 1`,
                gridRow: `${rowStart} / span ${duracion}`,
                top: '3px',
                height: `calc(${duracion * 52}px - 6px)`
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

export default CalendarDayView;
