import React from 'react';
import styles from '../../components/SaasBusinessesView.module.scss';
import type { BusinessSortOption } from './businessRules';

interface BusinessesToolbarProps {
  searchTerm: string;
  sortBy: BusinessSortOption;
  onSearchChange: (value: string) => void;
  onSortChange: (value: BusinessSortOption) => void;
  onCreate: () => void;
}

export const BusinessesToolbar: React.FC<BusinessesToolbarProps> = ({
  searchTerm,
  sortBy,
  onSearchChange,
  onSortChange,
  onCreate
}) => (
  <div className={styles.toolbar}>
    <div className={styles.searchWrap}>
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input
        type="text"
        placeholder="Buscar por nombre, slug o dueño..."
        value={searchTerm}
        onChange={event => onSearchChange(event.target.value)}
      />
    </div>
    <div className={styles.toolbarRight}>
      <span className={styles.sortLabel}>Ordenar por</span>
      <select
        className={styles.sortSelect}
        value={sortBy}
        onChange={event => onSortChange(event.target.value as BusinessSortOption)}
      >
        <option value="nombre">Nombre (A-Z)</option>
        <option value="fecha">Fecha de registro</option>
        <option value="estado">Estado</option>
      </select>
      <button className={styles.btnNew} onClick={onCreate}>
        <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Nuevo negocio
      </button>
    </div>
  </div>
);
