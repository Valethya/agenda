import React from 'react';
import styles from './AdminDashboard.module.scss';
import { CalendarProvider } from '../context/CalendarContext';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { SessionProvider, useSession } from '../context/SessionContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarMonthView from './CalendarMonthView';
import ScheduleManagementView from './ScheduleManagementView';
import AppointmentModal from './AppointmentModal';
import ImpersonationBanner from './ImpersonationBanner';
import SaasBusinessesView from './SaasBusinessesView';
import SaasMetricsView from './SaasMetricsView';
import TeamView from './TeamView';
import ServicesView from './ServicesView';

const DashboardContent: React.FC = () => {
  const { viewType } = useCalendarNavigation();
  const { loading: dataLoading, error: dataError, businessConfig } = useCalendarData();
  const { currentUser, loading: sessionLoading, error: sessionError } = useSession();
  const loading = sessionLoading || dataLoading;
  const error = sessionError || dataError;

  if (loading) {
    return (
      <div className={styles.loadingOverlay}>
        <div className={styles.spinner} />
        <span className={styles.loadingText}>Cargando panel...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorOverlay}>
        <span className={styles.errorText}>{error}</span>
        <button className={styles.btnRetry} onClick={() => window.location.reload()}>
          Reintentar
        </button>
      </div>
    );
  }

  const showLeyenda = !['horarios', 'equipo', 'servicios', 'saas-negocios', 'saas-metricas'].includes(viewType);

  return (
    <div className={styles.appContainer}>
      {currentUser?.isImpersonating && (
        <ImpersonationBanner businessName={businessConfig.businessName} />
      )}

      <div className={styles.app}>
        <Sidebar />

        <main className={styles.main}>
          <Topbar />

          <div className={styles.content}>
            {/* Leyenda - Oculta en vistas que no representan el calendario */}
            {showLeyenda && (
              <div className={styles.leyenda}>
                <div className={styles.leyendaItem}>
                  <div className={`${styles.leyendaDot} ${styles.confirmada}`} />
                  Confirmada
                </div>
                <div className={styles.leyendaItem}>
                  <div className={`${styles.leyendaDot} ${styles.pendiente}`} />
                  Pendiente
                </div>
                <div className={styles.leyendaItem}>
                  <div className={`${styles.leyendaDot} ${styles.completada}`} />
                  Completada
                </div>
                <div className={styles.leyendaItem}>
                  <div className={`${styles.leyendaDot} ${styles.cancelada}`} />
                  Cancelada
                </div>
                <div className={styles.leyendaItem}>
                  <div className={`${styles.leyendaDot} ${styles.diaLibre}`} />
                  Día libre
                </div>
              </div>
            )}

            {/* Vistas dinámicas */}
            <div className={styles.viewContainer}>
              {viewType === 'semana' && <CalendarWeekView />}
              {viewType === 'dia' && <CalendarDayView />}
              {viewType === 'mes' && <CalendarMonthView />}
              {viewType === 'equipo' && <TeamView />}
              {viewType === 'servicios' && <ServicesView />}
              {viewType === 'saas-negocios' && <SaasBusinessesView />}
              {viewType === 'saas-metricas' && <SaasMetricsView />}
              {viewType === 'horarios' && (
                <ScheduleManagementView canManageTeam={currentUser?.role === 'admin'} />
              )}
            </div>
          </div>
        </main>

        <AppointmentModal />
      </div>
    </div>
  );
};

export const AdminDashboard: React.FC = () => {
  return (
    <SessionProvider>
      <CalendarProvider>
        <DashboardContent />
      </CalendarProvider>
    </SessionProvider>
  );
};

export default AdminDashboard;
