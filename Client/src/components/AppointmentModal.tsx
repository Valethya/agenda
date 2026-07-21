import React from 'react';
import styles from './AppointmentModal.module.scss';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import StatusBadge from './StatusBadge';
import { parseUTCDateToLocal } from '../utils/time';

export const AppointmentModal: React.FC = () => {
  const { selectedAppointment, setSelectedAppointment } = useCalendarNavigation();
  const { confirmApp, completeApp, cancelApp, profs, businessConfig } = useCalendarData();

  if (!selectedAppointment) {
    return (
      <div className={styles.overlay} onClick={() => setSelectedAppointment(null)} />
    );
  }

  const app = selectedAppointment;
  const clientName = app.client ? `${app.client.firstName} ${app.client.lastName}` : 'Cliente';
  
  const professional = typeof app.worker === 'object'
    ? `${app.worker.firstName} ${app.worker.lastName}`
    : profs.find(p => p._id === app.worker)?.firstName || 'Profesional';

  const rawDateStr = parseUTCDateToLocal(app.date).toLocaleDateString('es-ES', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });
  const capitalizedDate = rawDateStr.charAt(0).toUpperCase() + rawDateStr.slice(1);

  const price = app.service?.price || 0;
  const serviceDeposit = app.service?.depositAmount || 0;

  // Calcular abono pagado real y saldo pendiente real basándose en el estado de pago de la cita
  let paidAmount = 0;
  let pendingAmount = price;

  if (app.paymentStatus === 'partially_paid') {
    paidAmount = serviceDeposit;
    pendingAmount = price - serviceDeposit;
  } else if (app.paymentStatus === 'fully_paid') {
    paidAmount = price;
    pendingAmount = 0;
  }
  
  const paymentStatusMap = {
    unpaid: 'Impago',
    partially_paid: 'Pago parcial',
    fully_paid: 'Pagado Completo',
    refunded: 'Reembolsado'
  };
  const paymentStatusLabel = paymentStatusMap[app.paymentStatus] || 'Impago';

  const handleClose = () => {
    setSelectedAppointment(null);
  };

  const handleConfirm = async () => {
    const ok = await confirmApp(app._id);
    if (ok) handleClose();
  };

  const handleComplete = async () => {
    const ok = await completeApp(app._id);
    if (ok) handleClose();
  };

  const handleCancel = async () => {
    const ok = await cancelApp(app._id);
    if (ok) handleClose();
  };

  return (
    <div className={`${styles.overlay} ${styles.open}`} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>{clientName}</div>
            <div className={styles.serviceInfo}>
              {app.service?.name} · {app.service?.duration || 60} min
            </div>
          </div>
          <div className={styles.headerRight}>
            <StatusBadge status={app.status} />
            <button className={styles.closeBtn} onClick={handleClose}>✕</button>
          </div>
        </div>
        
        <div className={styles.body}>
          <div className={styles.grid}>
            <div className={`${styles.field} ${styles.dateTimeField}`}>
              <div className={styles.label}>Fecha y hora</div>
              <div className={styles.dateLabel}>{capitalizedDate}</div>
              <div className={styles.timeLabel}>{app.startTime}</div>
            </div>
            {profs.length > 1 && (
              <div className={styles.field}>
                <div className={styles.label}>{businessConfig.professionalRoleLabel}</div>
                <div className={styles.value}>{professional}</div>
              </div>
            )}
            <div className={styles.field}>
              <div className={styles.label}>Teléfono</div>
              <div className={styles.value}>{app.client?.phone || 'Sin teléfono'}</div>
            </div>
            <div className={styles.field}>
              <div className={styles.label}>Email</div>
              <div className={styles.value}>{app.client?.email || 'Sin email'}</div>
            </div>
          </div>
          
          <div className={styles.field}>
            <div className={styles.label}>Detalle del Pago</div>
            <div className={styles.paymentBox}>
              {paidAmount > 0 ? (
                <>
                  <div className={styles.paymentRow}>
                    <span className={styles.paymentKey}>Abono</span>
                    <span className={styles.paymentVal}>${paidAmount.toLocaleString('es-CL')}</span>
                  </div>
                  {pendingAmount > 0 && (
                    <div className={styles.paymentRow}>
                      <span className={styles.paymentKey}>Por cobrar</span>
                      <span className={`${styles.paymentVal} ${styles.highlightedVal}`}>
                        ${pendingAmount.toLocaleString('es-CL')}
                      </span>
                    </div>
                  )}
                  <div className={`${styles.paymentRow} ${styles.totalRow}`}>
                    <span className={styles.paymentKey}>Total</span>
                    <span className={styles.paymentVal}>${price.toLocaleString('es-CL')}</span>
                  </div>
                </>
              ) : (
                <div className={styles.paymentRow}>
                  <span className={styles.paymentKey}>Total</span>
                  <span className={styles.paymentVal}>${price.toLocaleString('es-CL')}</span>
                </div>
              )}
              <div className={styles.paymentRow}>
                <span className={styles.paymentKey}>Estado</span>
                <span className={`${styles.paymentValStatus} ${
                  app.paymentStatus === 'unpaid' 
                    ? styles.unpaid 
                    : app.paymentStatus === 'partially_paid' 
                      ? styles.partial 
                      : styles.paid
                }`}>
                  {paymentStatusLabel}
                </span>
              </div>
            </div>
          </div>
          
          <div className={styles.field}>
            <div className={styles.label}>Notas</div>
            <div className={styles.value}>{app.notes || 'Sin notas adicionales'}</div>
          </div>
        </div>

        <div className={styles.footer}>
          {app.status !== 'cancelled' && app.status !== 'completed' && (
            <button className={`${styles.btn} ${styles.danger}`} onClick={handleCancel}>
              Cancelar cita
            </button>
          )}
          <button className={styles.btn} onClick={handleClose}>Volver</button>
          {app.status === 'pending' && (
            <button className={`${styles.btn} ${styles.primary}`} onClick={handleConfirm}>
              Confirmar
            </button>
          )}
          {app.status === 'confirmed' && (
            <button className={`${styles.btn} ${styles.complete}`} onClick={handleComplete}>
              Completar Cita
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppointmentModal;
