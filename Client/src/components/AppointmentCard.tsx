import React from 'react';
import styles from './AppointmentCard.module.scss';
import type { Appointment } from '../types';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';

interface AppointmentCardProps {
  appointment: Appointment;
  size: 'small' | 'medium' | 'large';
  style?: React.CSSProperties;
}

export const AppointmentCard: React.FC<AppointmentCardProps> = ({ appointment, size, style }) => {
  const { setSelectedAppointment } = useCalendarNavigation();
  const { confirmApp, completeApp, cancelApp } = useCalendarData();

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.actionBtn}`)) {
      return;
    }
    setSelectedAppointment(appointment);
  };

  const clientName = appointment.client 
    ? `${appointment.client.firstName} ${appointment.client.lastName}` 
    : 'Cliente';

  const statusClassMap = {
    pending: 'pendiente',
    pending_payment: 'pendiente',
    confirmed: 'confirmada',
    completed: 'completada',
    cancelled: 'cancelada',
  };

  const statusKey = statusClassMap[appointment.status] || 'pendiente';
  const statusClass = styles[statusKey] || '';
  const sizeClass = styles[size] || styles.medium;

  if (size === 'small') {
    const shortName = appointment.client ? appointment.client.firstName : 'Cita';
    return (
      <div 
        className={`${styles.card} ${styles.small} ${statusClass}`}
        onClick={handleCardClick}
        title={`${clientName} - ${appointment.startTime}`}
      >
        {shortName}
      </div>
    );
  }

  if (size === 'large') {
    const professional = typeof appointment.worker === 'object' 
      ? `${appointment.worker.firstName} ${appointment.worker.lastName}`
      : 'Profesional';

    return (
      <div 
        className={`${styles.card} ${styles.large} ${statusClass}`} 
        style={style}
        onClick={handleCardClick}
      >
        <div className={styles.info}>
          <div className={styles.name}>{clientName}</div>
          <div className={styles.service}>{appointment.service.name}</div>
          <div className={styles.professional}>{professional}</div>
        </div>
        <div className={styles.time}>{appointment.startTime}</div>
        <div className={styles.actions}>
          {appointment.status === 'pending' && (
            <button 
              className={`${styles.actionBtn} ${styles.confirm}`} 
              title="Confirmar"
              onClick={() => confirmApp(appointment._id)}
            >
              ✓
            </button>
          )}
          {appointment.status === 'confirmed' && (
            <button 
              className={`${styles.actionBtn} ${styles.complete}`} 
              title="Marcar como Completada"
              onClick={() => completeApp(appointment._id)}
            >
              ✓
            </button>
          )}
          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
            <button 
              className={`${styles.actionBtn} ${styles.cancel}`} 
              title="Cancelar"
              onClick={() => cancelApp(appointment._id)}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`${styles.card} ${styles.medium} ${statusClass}`} 
      style={style}
      onClick={handleCardClick}
    >
      <div className={styles.name}>{clientName}</div>
      <div className={styles.service}>{appointment.service.name}</div>
      <div className={styles.time}>{appointment.startTime}</div>
    </div>
  );
};

export default AppointmentCard;
