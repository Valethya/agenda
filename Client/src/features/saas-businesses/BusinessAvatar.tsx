import React, { useState } from 'react';
import styles from '../../components/SaasBusinessesView.module.scss';

const GRADIENTS = [
  'linear-gradient(135deg,#8A9BAE,#7A8E9E)',
  'linear-gradient(135deg,#B5A898,#A5988A)',
  'linear-gradient(135deg,#7A9E8C,#6A8E7C)',
  'linear-gradient(135deg,#C4AA7A,#B49A6A)',
  'linear-gradient(135deg,#B5827A,#A5726A)'
];

function getAvatarGradient(slug: string) {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = slug.charCodeAt(index) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function getInitials(name: string): string {
  if (!name) return '';
  const stopWords = ['de', 'del', 'el', 'la', 'los', 'las', 'y', 'en', 'para', 'con', 'a'];
  const words = name.split(/\s+/).filter(word => (
    word.length > 0 && !stopWords.includes(word.toLocaleLowerCase('es'))
  ));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

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
      style={error ? { background: getAvatarGradient(slug), border: 'none' } : undefined}
    >
      {error ? (
        <span className={styles.faviconFallback}>{getInitials(name)}</span>
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
