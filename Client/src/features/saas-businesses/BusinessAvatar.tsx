import React from 'react';
import styles from '../../components/SaasBusinessesView.module.scss';
import { getBusinessAvatarGradient, getMeaningfulInitials } from '../../utils/avatar';

export const BusinessAvatar: React.FC<{ name: string; slug: string }> = ({ name, slug }) => {
  return (
    <div
      className={`${styles.faviconWrap} ${styles.colored}`}
      style={{ background: getBusinessAvatarGradient(slug), border: 'none' }}
    >
      <span className={styles.faviconFallback}>{getMeaningfulInitials(name)}</span>
    </div>
  );
};
