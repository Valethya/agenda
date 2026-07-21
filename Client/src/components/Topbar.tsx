import React from 'react';
import styles from './Topbar.module.scss';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { useSession } from '../context/SessionContext';
import ViewSwitcher from './ViewSwitcher';
import DateNav from './DateNav';
import NewAppointmentButton from './NewAppointmentButton';

export const Topbar: React.FC = () => {
  const { currentDate, viewType, selectedProfessionalId, setSelectedProfessionalId } = useCalendarNavigation();
  const { profs, businessConfig } = useCalendarData();
  const { currentUser } = useSession();

  const getStartOfWeek = (d: Date): Date => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(date.setDate(diff));
    start.setHours(0,0,0,0);
    return start;
  };

  const getEndOfWeek = (d: Date): Date => {
    const start = getStartOfWeek(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23,59,59,999);
    return end;
  };

  const formatWeekRange = (date: Date): string => {
    const start = getStartOfWeek(date);
    const end = getEndOfWeek(date);
    const startDay = start.getDate();
    const endDay = end.getDate();
    const startMonth = start.toLocaleDateString('es-ES', { month: 'long' });
    const endMonth = end.toLocaleDateString('es-ES', { month: 'long' });

    if (start.getMonth() === end.getMonth()) {
      return `Semana del ${startDay} al ${endDay} de ${startMonth}`;
    } else {
      return `Semana del ${startDay} de ${startMonth} al ${endDay} de ${endMonth}`;
    }
  };

  const formatLongDate = (date: Date): string => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const str = date.toLocaleDateString('es-ES', options);
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const getTitle = (): string => {
    if (viewType === 'semana') {
      return formatWeekRange(currentDate);
    } else if (viewType === 'dia') {
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
      const dayStr = currentDate.toLocaleDateString('es-ES', options);
      return dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
    } else if (viewType === 'mes') {
      const monthStr = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      return monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
    } else if (viewType === 'horarios') {
      return 'Horarios del equipo';
    }
    return '';
  };

  const todayStr = formatLongDate(new Date());

  const handleProfChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedProfessionalId(val ? val : null);
  };

  // Enforce single professional selection in Week View, and lock selection for workers
  React.useEffect(() => {
    if (currentUser?.role === 'worker') {
      setSelectedProfessionalId(currentUser._id);
    } else if (viewType === 'semana' && !selectedProfessionalId && profs.length > 0) {
      setSelectedProfessionalId(profs[0]._id);
    }
  }, [viewType, selectedProfessionalId, profs, currentUser]);

  const isSaasView = viewType === 'saas-negocios' || viewType === 'saas-metricas';

  if (isSaasView) {
    return (
      <div className={styles.topbar}>
        <div className={styles.left}>
          <span className={styles.title} style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.25rem', fontWeight: 300, display: 'flex', alignItems: 'center', gap: '0.75rem', textTransform: 'none', letterSpacing: 'normal' }}>
            Consola de administración
            <span style={{ fontSize: '0.58rem', fontWeight: 400, letterSpacing: '0.18em', padding: '0.25rem 0.65rem', background: '#DCE4EA', color: '#8A9BAE', borderRadius: '2px', textTransform: 'uppercase', fontFamily: 'Jost, sans-serif' }}>
              SAAS ADMIN
            </span>
          </span>
          <span className={styles.date}>{todayStr}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.topbar}>
      <div className={styles.left}>
        <DateNav />
        <span className={styles.title} id="topbar-title">{getTitle()}</span>
        <span className={styles.date}>{todayStr}</span>
      </div>
      <div className={styles.right}>
        {viewType !== 'horarios' && currentUser?.role !== 'worker' && profs.length > 1 && (
          <div className={styles.filterWrapper}>
            <label htmlFor="prof-filter" className={styles.filterLabel}>
              {(businessConfig?.professionalRoleLabel || 'Profesional')}:
            </label>
            <select
              id="prof-filter"
              value={selectedProfessionalId || ''}
              onChange={handleProfChange}
              className={styles.filterSelect}
            >
              {viewType !== 'semana' && <option value="">Todos</option>}
              {profs.map(p => (
                <option key={p._id} value={p._id}>
                  {p.firstName} {p.lastName.split(' ')[0]}
                </option>
              ))}
            </select>
          </div>
        )}
        <ViewSwitcher />
        <NewAppointmentButton />
      </div>
    </div>
  );
};

export default Topbar;
