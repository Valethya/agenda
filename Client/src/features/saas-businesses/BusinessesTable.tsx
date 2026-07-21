import React from 'react';
import type { SaasBusiness } from '../../types';
import styles from '../../components/SaasBusinessesView.module.scss';
import { BusinessAvatar } from './BusinessAvatar';
import {
  formatBusinessDate,
  getBusinessStatus,
  getPrimaryContact
} from './businessRules';

interface BusinessesTableProps {
  businesses: SaasBusiness[];
  actionLoadingId: string | null;
  onOpen: (business: SaasBusiness) => void;
  onImpersonate: (business: SaasBusiness) => void;
  onToggleStatus: (business: SaasBusiness) => void;
}

const STATUS_PRESENTATION = {
  activo: { label: 'Activo', className: styles.statusActivo },
  trial: { label: 'Trial', className: styles.statusTrial },
  inactivo: { label: 'Inactivo', className: styles.statusInactivo }
};

export const BusinessesTable: React.FC<BusinessesTableProps> = ({
  businesses,
  actionLoadingId,
  onOpen,
  onImpersonate,
  onToggleStatus
}) => (
  <div className={styles.tableWrap}>
    <table>
      <thead>
        <tr>
          <th>Negocio</th>
          <th>Slug</th>
          <th>Dueño / Administrador</th>
          <th>Contacto</th>
          <th>Registro</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {businesses.map(business => {
          const status = STATUS_PRESENTATION[getBusinessStatus(business)];
          const ownerEmail = getPrimaryContact(business.owner?.email) || 'Sin asignar';
          const ownerPhone = getPrimaryContact(business.owner?.phone) || '—';

          return (
            <tr key={business._id}>
              <td>
                <div className={styles.negocioCell}>
                  <BusinessAvatar name={business.name} slug={business.slug} />
                  <div className={styles.negocioInfo}>
                    <div className={styles.negocioName}>{business.name}</div>
                    <div className={styles.negocioId}>ID: {business._id}</div>
                  </div>
                </div>
              </td>
              <td><span className={styles.slugChip}>{business.slug}</span></td>
              <td>
                <div className={styles.ownerName}>
                  {business.owner ? `${business.owner.firstName} ${business.owner.lastName}` : 'Sin dueño'}
                </div>
                <div className={styles.ownerEmail}>{ownerEmail}</div>
              </td>
              <td><div className={styles.contactTel}>{ownerPhone}</div></td>
              <td><div className={styles.regDate}>{formatBusinessDate(business.createdAt)}</div></td>
              <td>
                <span
                  className={`${styles.statusBadge} ${status.className}`}
                  onClick={() => onToggleStatus(business)}
                  title="Haz clic para activar/desactivar el negocio"
                >
                  {status.label}
                </span>
              </td>
              <td>
                <div className={styles.rowActions}>
                  <button
                    className={`${styles.actionBtn} ${styles.acceder}`}
                    onClick={() => onOpen(business)}
                    disabled={actionLoadingId !== null || !business.isActive}
                    title={`Abrir el panel de ${business.name} sin impersonar`}
                    aria-label={`Abrir el panel de ${business.name} sin impersonar`}
                  >
                    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.impersonar}`}
                    onClick={() => onImpersonate(business)}
                    disabled={actionLoadingId !== null || !business.isActive}
                    title={`Impersonar al administrador de ${business.name}`}
                    aria-label={`Impersonar al administrador de ${business.name}`}
                  >
                    <svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /><polyline points="16 11 18 13 22 9" /></svg>
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={() => onToggleStatus(business)}
                    disabled={actionLoadingId !== null}
                    title={business.isActive ? 'Suspender Negocio' : 'Activar Negocio'}
                    aria-label={business.isActive ? `Suspender ${business.name}` : `Activar ${business.name}`}
                  >
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
        {businesses.length === 0 && (
          <tr>
            <td colSpan={7} className={styles.noData}>No se encontraron negocios con los filtros aplicados.</td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
