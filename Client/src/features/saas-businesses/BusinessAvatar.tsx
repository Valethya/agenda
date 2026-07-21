import React, { useState } from 'react';
import styles from '../../components/SaasBusinessesView.module.scss';
import { getBusinessAvatarGradient, getMeaningfulInitials } from '../../utils/avatar';

export const BusinessAvatar: React.FC<{ name: string; slug: string }> = ({ name, slug }) => {
  const domain = slug === 'atmosfera' || slug === 'atmosfera-landing'
    ? 'atmosfera.studio'
    : `${slug}.cl`;
  const isLocalhost = typeof window !== 'undefined'
    && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [loading, setLoading] = useState(!isLocalhost);
  const [error, setError] = useState(isLocalhost);

  return (
    <div
      className={`${styles.faviconWrap} ${loading ? styles.loading : ''} ${error ? styles.colored : ''}`}
      style={error ? { background: getBusinessAvatarGradient(slug), border: 'none' } : undefined}
    >
      {error ? (
        <span className={styles.faviconFallback}>{getMeaningfulInitials(name)}</span>
      ) : (
        <img
          src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
          alt={name}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
        />
      )}
    </div>
  );
};
