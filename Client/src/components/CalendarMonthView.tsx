import React from 'react';
import styles from './CalendarMonthView.module.scss';
import { useCalendar } from '../context/CalendarContext';
import { formatLocalDateStr, getWorkerDaysOff } from '../utils/time';

export const CalendarMonthView: React.FC = () => {
  const { currentDate, setDate, setViewType, citas, selectedProfessionalId, profs } = useCalendar();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // First day of current month
  const firstDay = new Date(year, month, 1);
  let startDayOfWeek = firstDay.getDay();
  // Adjust Monday-first (Monday is 0, Sunday is 6)
  startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  interface DayCell {
    num: number;
    other: boolean;
    today: boolean;
    date: Date;
  }

  const daysArray: DayCell[] = [];

  // Previous month filler days
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    daysArray.push({
      num: prevMonthTotalDays - i,
      other: true,
      today: false,
      date: new Date(year, month - 1, prevMonthTotalDays - i)
    });
  }

  // Current month days
  const today = new Date();
  const todayStr = formatLocalDateStr(today);

  for (let i = 1; i <= totalDays; i++) {
    const curDate = new Date(year, month, i);
    const isToday = formatLocalDateStr(curDate) === todayStr;
    daysArray.push({
      num: i,
      other: false,
      today: isToday,
      date: curDate
    });
  }

  // Next month filler days (to complete 35 or 42 cells)
  const totalCells = daysArray.length > 35 ? 42 : 35;
  const nextDaysCount = totalCells - daysArray.length;
  for (let i = 1; i <= nextDaysCount; i++) {
    daysArray.push({
      num: i,
      other: true,
      today: false,
      date: new Date(year, month + 1, i)
    });
  }

  const handleDayClick = (date: Date) => {
    setDate(date);
    setViewType('dia');
  };

  return (
    <div className={styles.container}>
      {/* Weekdays headers */}
      <div className={styles.monthWeekdays}>
        <div className={styles.weekday}>Lun</div>
        <div className={styles.weekday}>Mar</div>
        <div className={styles.weekday}>Mié</div>
        <div className={styles.weekday}>Jue</div>
        <div className={styles.weekday}>Vie</div>
        <div className={styles.weekday}>Sáb</div>
        <div className={styles.weekday}>Dom</div>
      </div>

      {/* Grid of monthly cells */}
      <div className={styles.monthGrid}>
        {daysArray.map((d, idx) => {
          const cellDateStr = formatLocalDateStr(d.date);
          let cellAppointments = d.other 
            ? [] 
            : citas.filter(c => formatLocalDateStr(new Date(c.date)) === cellDateStr);

          // Apply professional filter if selected
          if (selectedProfessionalId) {
            cellAppointments = cellAppointments.filter(c => {
              const wId = typeof c.worker === 'object' ? c.worker._id : c.worker;
              return wId === selectedProfessionalId;
            });
          }

          // Check if this day is a day off for the selected professional (only if a professional is selected)
          const selectedProf = selectedProfessionalId ? profs.find(p => p._id === selectedProfessionalId) : null;
          const isDayOff = selectedProf 
            ? getWorkerDaysOff(selectedProf.email).includes(d.date.getDay())
            : false;

          // Count appointments by category
          const confirmedCount = cellAppointments.filter(c => c.status === 'confirmed' || c.status === 'completed').length;
          const pendingCount = cellAppointments.filter(c => c.status === 'pending').length;
          const cancelledCount = cellAppointments.filter(c => c.status === 'cancelled').length;

          return (
            <div 
              key={`cell-${idx}`}
              className={`${styles.monthDay} ${d.today ? styles.today : ''} ${d.other ? styles.otherMonth : ''} ${!d.other && isDayOff ? styles.dayOff : ''}`}
              onClick={() => !d.other && handleDayClick(d.date)}
            >
              <div className={styles.dayNum}>{d.num}</div>
              
              {!d.other && (confirmedCount > 0 || pendingCount > 0 || cancelledCount > 0) && (
                <div className={styles.splitGrid}>
                  {confirmedCount > 0 && (
                    <div className={`${styles.splitSegment} ${styles.confirmed}`} title={`${confirmedCount} confirmadas`}>
                      <span className={styles.splitCount}>{confirmedCount}</span>
                      <span className={styles.splitLabel}>{confirmedCount === 1 ? 'confirmada' : 'confirmadas'}</span>
                    </div>
                  )}
                  {pendingCount > 0 && (
                    <div className={`${styles.splitSegment} ${styles.pending}`} title={`${pendingCount} pendientes`}>
                      <span className={styles.splitCount}>{pendingCount}</span>
                      <span className={styles.splitLabel}>{pendingCount === 1 ? 'pendiente' : 'pendientes'}</span>
                    </div>
                  )}
                  {cancelledCount > 0 && (
                    <div className={`${styles.splitSegment} ${styles.cancelled}`} title={`${cancelledCount} canceladas`}>
                      <span className={styles.splitCount}>{cancelledCount}</span>
                      <span className={styles.splitLabel}>{cancelledCount === 1 ? 'cancelada' : 'canceladas'}</span>
                    </div>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarMonthView;
