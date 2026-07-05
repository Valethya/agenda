import React from 'react';
import styles from './StatusBadge.module.scss';
import type { AppointmentStatus } from '../types';

interface StatusBadgeProps {
  status: AppointmentStatus;
  type?: 'full' | 'dot' | 'label';
}

const statusMap = {
  pending: { label: 'Pendiente', class: 'pendiente' },
  pending_payment: { label: 'Pago Pendiente', class: 'pendiente' },
  confirmed: { label: 'Confirmada', class: 'confirmada' },
  completed: { label: 'Completada', class: 'completada' },
  cancelled: { label: 'Cancelada', class: 'cancelada' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'full' }) => {
  const info = statusMap[status] || { label: status, class: 'pendiente' };
  const statusClass = styles[info.class] || '';

  if (type === 'dot') {
    return <span className={`${styles.dot} ${statusClass}`} title={info.label} />;
  }

  return (
    <span className={`${styles.badge} ${statusClass}`}>
      {type === 'full' && <span className={`${styles.dotInner} ${statusClass}`} />}
      {info.label}
    </span>
  );
};

export default StatusBadge;
