import React from 'react';
import styles from './Topbar.module.scss';
import { useCalendar } from '../context/CalendarContext';

export const ViewSwitcher: React.FC = () => {
  const { viewType, setViewType } = useCalendar();

  if (viewType === 'horarios') return null;

  return (
    <div className={styles.viewSwitcher}>
      <button 
        className={`${styles.viewBtn} ${viewType === 'dia' ? styles.active : ''}`}
        onClick={() => setViewType('dia')}
      >
        Día
      </button>
      <button 
        className={`${styles.viewBtn} ${viewType === 'semana' ? styles.active : ''}`}
        onClick={() => setViewType('semana')}
      >
        Semana
      </button>
      <button 
        className={`${styles.viewBtn} ${viewType === 'mes' ? styles.active : ''}`}
        onClick={() => setViewType('mes')}
      >
        Mes
      </button>
    </div>
  );
};

export default ViewSwitcher;
