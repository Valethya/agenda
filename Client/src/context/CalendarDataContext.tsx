import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { Appointment, BusinessConfig, Professional, Shift } from '../types';
import * as api from '../services/api';
import { useSession } from './SessionContext';

interface CalendarDataContextType {
  citas: Appointment[];
  profs: Professional[];
  shifts: Shift[];
  businessConfig: BusinessConfig;
  loading: boolean;
  error: string | null;
  confirmApp: (id: string) => Promise<boolean>;
  completeApp: (id: string) => Promise<boolean>;
  cancelApp: (id: string) => Promise<boolean>;
  refreshData: () => Promise<void>;
}

const DEFAULT_BUSINESS_CONFIG: BusinessConfig = {
  businessName: 'Agenda',
  professionalRoleLabel: 'Profesional',
  professionalRoleLabelPlural: 'Profesionales',
  enabledNavItems: ['calendario', 'horarios', 'clientes', 'servicios', 'equipo', 'reportes']
};

const CalendarDataContext = createContext<CalendarDataContextType | undefined>(undefined);

export const CalendarDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { scope } = useSession();
  const [citas, setCitas] = useState<Appointment[]>([]);
  const [profs, setProfs] = useState<Professional[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [businessConfig, setBusinessConfig] = useState<BusinessConfig>(DEFAULT_BUSINESS_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    if (scope !== 'tenant') return;
    try {
      setError(null);
      setCitas(await api.getMyAppointments());
    } catch (err: unknown) {
      console.error('Error refreshing appointments:', err);
      setError('Error al sincronizar datos.');
    }
  }, [scope]);

  useEffect(() => {
    let active = true;

    if (scope === 'loading' || scope === 'redirecting') {
      setLoading(true);
      return () => {
        active = false;
      };
    }

    if (scope === 'global') {
      setCitas([]);
      setProfs([]);
      setShifts([]);
      setBusinessConfig(DEFAULT_BUSINESS_CONFIG);
      setError(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    const loadTenantData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [config, workers, appointments] = await Promise.all([
          api.getBusinessConfigData(),
          api.getWorkers(),
          api.getMyAppointments()
        ]);
        const workerShifts = (await Promise.all(
          workers.map(worker => api.getWorkerShifts(worker._id))
        )).flat();

        if (!active) return;
        setBusinessConfig(config);
        setProfs(workers);
        setCitas(appointments);
        setShifts(workerShifts);
      } catch (err: unknown) {
        console.error('Error loading calendar data:', err);
        if (api.isApiError(err) && err.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (active) setError('Ocurrió un error al cargar la información del panel.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadTenantData();
    return () => {
      active = false;
    };
  }, [scope]);

  useEffect(() => {
    if (scope !== 'tenant') return;

    const apiUrl = import.meta.env.PUBLIC_API_URL;
    if (!apiUrl) return;

    try {
      const socket = io(new URL(apiUrl).origin, {
        transports: ['websocket', 'polling']
      });

      socket.on('calendar_update', refreshData);
      return () => socket.disconnect();
    } catch (err) {
      console.error('Error al establecer conexión WebSocket:', err);
    }
  }, [scope, refreshData]);

  const updateAppointmentStatus = async (
    id: string,
    status: Appointment['status'],
    request: (appointmentId: string) => Promise<{ status: string }>
  ): Promise<boolean> => {
    try {
      const response = await request(id);
      if (response?.status !== 'success') return false;
      setCitas(previous => previous.map(appointment => (
        appointment._id === id ? { ...appointment, status } : appointment
      )));
      return true;
    } catch (err) {
      console.error(`Error updating appointment to ${status}:`, err);
      return false;
    }
  };

  const confirmApp = (id: string) => updateAppointmentStatus(id, 'confirmed', api.confirmAppointment);
  const completeApp = (id: string) => updateAppointmentStatus(id, 'completed', api.completeAppointment);
  const cancelApp = (id: string) => updateAppointmentStatus(id, 'cancelled', api.cancelAppointment);

  return (
    <CalendarDataContext.Provider value={{
      citas,
      profs,
      shifts,
      businessConfig,
      loading,
      error,
      confirmApp,
      completeApp,
      cancelApp,
      refreshData
    }}>
      {children}
    </CalendarDataContext.Provider>
  );
};

export const useCalendarData = () => {
  const context = useContext(CalendarDataContext);
  if (context === undefined) {
    throw new Error('useCalendarData must be used within a CalendarDataProvider');
  }
  return context;
};
