import React from 'react';
import styles from './ServiceTag.module.scss';
import type { Service } from '../types';

interface ServiceTagProps {
  service: Service;
}

const PALETTE = ['#8A9BAE', '#B5A898', '#7A9E8C', '#C4AA7A', '#B5827A'];

export const ServiceTag: React.FC<ServiceTagProps> = ({ service }) => {
  if (!service) return null;
  
  // Assign a stable color from the palette based on the service name or ID
  const hash = service.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const color = service.color || PALETTE[hash % PALETTE.length];

  return (
    <span className={styles.tag} title={service.name}>
      <span className={styles.dot} style={{ backgroundColor: color }} />
      {service.name}
    </span>
  );
};

export default ServiceTag;
