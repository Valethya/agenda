import React, { useMemo, useState } from 'react';
import styles from './SaasBusinessesView.module.scss';
import type { SaasBusiness } from '../types';
import {
  filterAndSortBusinesses,
  getBusinessMetrics,
  getBusinessPanelPath,
  type BusinessSortOption
} from '../features/saas-businesses/businessRules';
import { useSaasBusinesses } from '../features/saas-businesses/useSaasBusinesses';
import { BusinessesHeader } from '../features/saas-businesses/BusinessesHeader';
import { BusinessesToolbar } from '../features/saas-businesses/BusinessesToolbar';
import { BusinessesTable } from '../features/saas-businesses/BusinessesTable';
import { CreateBusinessModal } from '../features/saas-businesses/CreateBusinessModal';

export const SaasBusinessesView: React.FC = () => {
  const {
    businesses,
    loading,
    error,
    actionLoadingId,
    fetchBusinesses,
    toggleStatus,
    impersonate,
    createBusiness
  } = useSaasBusinesses();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<BusinessSortOption>('nombre');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const metrics = useMemo(() => getBusinessMetrics(businesses), [businesses]);
  const processedBusinesses = useMemo(
    () => filterAndSortBusinesses(businesses, searchTerm, sortBy),
    [businesses, searchTerm, sortBy]
  );

  const openBusiness = (business: SaasBusiness) => {
    const path = getBusinessPanelPath(business);
    if (path) window.location.href = path;
  };

  if (loading) return <div className={styles.loading}>Cargando lista de negocios...</div>;

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <p className={styles.errorText}>{error}</p>
        <button onClick={() => fetchBusinesses()} className={styles.btnRetry}>Reintentar</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <BusinessesHeader metrics={metrics} />
      <BusinessesToolbar
        searchTerm={searchTerm}
        sortBy={sortBy}
        onSearchChange={setSearchTerm}
        onSortChange={setSortBy}
        onCreate={() => setShowCreateModal(true)}
      />
      <BusinessesTable
        businesses={processedBusinesses}
        actionLoadingId={actionLoadingId}
        onOpen={openBusiness}
        onImpersonate={impersonate}
        onToggleStatus={toggleStatus}
      />
      {showCreateModal && (
        <CreateBusinessModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createBusiness}
        />
      )}
    </div>
  );
};

export default SaasBusinessesView;
