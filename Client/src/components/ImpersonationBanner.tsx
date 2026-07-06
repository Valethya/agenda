import React, { useState } from 'react';
import styles from './ImpersonationBanner.module.scss';
import { stopImpersonating } from '../services/api';

interface ImpersonationBannerProps {
  businessName: string;
}

export const ImpersonationBanner: React.FC<ImpersonationBannerProps> = ({ businessName }) => {
  const [loading, setLoading] = useState(false);

  const handleStop = async () => {
    try {
      setLoading(true);
      const res = await stopImpersonating();
      if (res && res.status === 'success') {
        window.location.href = '/admin?view=saas-negocios'; // Redireccionar al listado de negocios SaaS
      } else {
        alert('Error al volver a la cuenta de superadmin');
        setLoading(false);
      }
    } catch (err) {
      console.error('Error stopping impersonation:', err);
      alert('Error de red al intentar volver a tu cuenta');
      setLoading(false);
    }
  };

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <span className={styles.dot} />
        <p className={styles.text}>
          Modo soporte: Visualizando el negocio <strong>{businessName}</strong> como administrador
        </p>
      </div>
      <button 
        className={styles.btnStop} 
        onClick={handleStop} 
        disabled={loading}
      >
        {loading ? 'Volviendo...' : 'Volver a mi cuenta'}
      </button>
    </div>
  );
};

export default ImpersonationBanner;
