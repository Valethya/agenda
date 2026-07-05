import React from 'react';
import styles from './AdminDashboard.module.scss';
import { CalendarProvider, useCalendar } from '../context/CalendarContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarMonthView from './CalendarMonthView';
import ProfessionalScheduleCard from './ProfessionalScheduleCard';
import AppointmentModal from './AppointmentModal';

const DashboardContent: React.FC = () => {
  const { viewType, loading, error, profs } = useCalendar();

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

  return (
    <div className={styles.app}>
      <Sidebar />
      
      <main className={styles.main}>
        <Topbar />
        
        <div className={styles.content}>
          {/* Leyenda - Oculta en vista de horarios */}
          {viewType !== 'horarios' && (
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
            
            {viewType === 'horarios' && (
              <div className={styles.horariosView}>
                <div className={styles.horariosHeader}>
                  <h2 className={styles.horariosTitle}>Horarios del equipo</h2>
                  <button className={styles.btnRetry} style={{ background: 'var(--niebla)', border: 'none' }}>
                    Editar horarios
                  </button>
                </div>
                <div className={styles.profCards}>
                  {profs.map((p, idx) => (
                    <ProfessionalScheduleCard 
                      key={p._id}
                      professional={p}
                      idx={idx}
                    />
                  ))}
                  {profs.length === 0 && (
                    <div style={{ padding: '2rem', color: 'var(--texto-suave)', textAlign: 'center', gridColumn: '1 / -1' }}>
                      No hay profesionales disponibles.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <AppointmentModal />
    </div>
  );
};

export const AdminDashboard: React.FC = () => {
  return (
    <CalendarProvider>
      <DashboardContent />
    </CalendarProvider>
  );
};

export default AdminDashboard;
