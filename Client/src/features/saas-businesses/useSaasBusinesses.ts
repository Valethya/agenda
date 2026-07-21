import { useCallback, useEffect, useState } from 'react';
import type { CreateSaasBusinessInput, SaasBusiness } from '../../types';
import * as api from '../../services/api';

export function useSaasBusinesses() {
  const [businesses, setBusinesses] = useState<SaasBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchBusinesses = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      setBusinesses(await api.getSaasBusinesses());
    } catch (err) {
      console.error('Error fetching businesses:', err);
      setError('Error de conexión al cargar la lista de negocios.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const toggleStatus = async (business: SaasBusiness) => {
    try {
      setActionLoadingId(business._id);
      const updated = await api.toggleSaasBusinessStatus(business._id);
      setBusinesses(previous => previous.map(item => (
        item._id === business._id ? { ...item, isActive: updated.isActive } : item
      )));
    } catch (err) {
      console.error('Error toggling business status:', err);
      alert('Error de conexión');
    } finally {
      setActionLoadingId(null);
    }
  };

  const impersonate = async (business: SaasBusiness) => {
    try {
      setActionLoadingId(business._id);
      const response = await api.impersonateBusiness(business._id);
      if (response?.status === 'success') {
        window.location.href = `/admin?slug=${encodeURIComponent(business.slug)}`;
        return;
      }
      alert(response?.message || 'Error al iniciar suplantación');
    } catch (err) {
      console.error('Error impersonating:', err);
      alert('Error de red al intentar impersonar el negocio');
    } finally {
      setActionLoadingId(null);
    }
  };

  const createBusiness = async (input: CreateSaasBusinessInput): Promise<boolean> => {
    try {
      const response = await api.createSaasBusiness(input);
      if (response?.status !== 'success') {
        alert('Error al crear el negocio.');
        return false;
      }
      alert('Negocio y administrador creados correctamente.');
      await fetchBusinesses(false);
      return true;
    } catch (err) {
      console.error('Error creating business:', err);
      alert('Error de conexión o datos duplicados.');
      return false;
    }
  };

  return {
    businesses,
    loading,
    error,
    actionLoadingId,
    fetchBusinesses,
    toggleStatus,
    impersonate,
    createBusiness
  };
}
