import React from 'react';
import styles from '../../components/SaasBusinessesView.module.scss';
import type { BusinessMetrics } from './businessRules';

export const BusinessesHeader: React.FC<{ metrics: BusinessMetrics }> = ({ metrics }) => (
  <div className={styles.pageHeader}>
    <div className={styles.pageHeaderTop}>
      <div>
        <h1 className={styles.pageTitle}>Negocios registrados</h1>
        <p className={styles.pageDesc}>Selecciona un negocio para abrir su panel sin cambiar tu identidad, o inicia el modo soporte mediante impersonación.</p>
      </div>
    </div>
    <div className={styles.pageStats}>
      {([
        ['total', 'Total'],
        ['active', 'Activos'],
        ['trial', 'En trial'],
        ['inactive', 'Inactivos']
      ] as const).map(([key, label], index) => (
        <React.Fragment key={key}>
          {index > 0 && <div className={styles.pstatDivider} />}
          <div className={styles.pstat}>
            <div className={styles.pstatNum}>{metrics[key]}</div>
            <div className={styles.pstatLabel}>{label}</div>
          </div>
        </React.Fragment>
      ))}
    </div>
  </div>
);
