import React from 'react';
import styles from './Topbar.module.scss';
import { useCalendar } from '../context/CalendarContext';

export const DateNav: React.FC = () => {
  const { currentDate, setDate, viewType } = useCalendar();

  if (viewType === 'horarios') return null;

  const navigateDate = (direction: -1 | 1) => {
    const newDate = new Date(currentDate);
    
    if (viewType === 'dia') {
      newDate.setDate(newDate.getDate() + direction);
    } else if (viewType === 'semana') {
      newDate.setDate(newDate.getDate() + direction * 7);
    } else if (viewType === 'mes') {
      newDate.setMonth(newDate.getMonth() + direction);
    }
    
    setDate(newDate);
  };

  const handleTodayClick = () => {
    setDate(new Date());
  };

  return (
    <div className={styles.dateNav}>
      <button className={styles.navArrow} onClick={() => navigateDate(-1)}>‹</button>
      <button className={styles.navToday} onClick={handleTodayClick}>Hoy</button>
      <button className={styles.navArrow} onClick={() => navigateDate(1)}>›</button>
    </div>
  );
};

export default DateNav;
