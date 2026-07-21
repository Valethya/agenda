import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Appointment, Professional, BusinessConfig, Shift } from '../types';
import * as api from '../services/api';
import { io } from 'socket.io-client';

export type ViewType = 'semana' | 'dia' | 'mes' | 'horarios' | 'saas-negocios' | 'saas-metricas';

interface CalendarContextType {
  currentDate: Date;
  viewType: ViewType;
  selectedProfessionalId: string | null;
  selectedAppointment: Appointment | null;
  citas: Appointment[];
  profs: Professional[];
  shifts: Shift[];
  businessConfig: BusinessConfig;
  loading: boolean;
  error: string | null;
  currentUser: any;
  setDate: (d: Date) => void;
  setViewType: (v: ViewType) => void;
  setSelectedProfessionalId: (id: string | null) => void;
  setSelectedAppointment: (app: Appointment | null) => void;
  confirmApp: (id: string) => Promise<boolean>;
  completeApp: (id: string) => Promise<boolean>;
  cancelApp: (id: string) => Promise<boolean>;
  logoutUser: () => Promise<void>;
  refreshData: () => Promise<void>;
  switchWorkspace: (businessId: string) => Promise<void>;
}

const CalendarContext = createContext<CalendarContextType | undefined>(undefined);

export const CalendarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentDate, setDate] = useState<Date>(new Date());
  const [viewType, setViewType] = useState<ViewType>('semana');
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  
  const [citas, setCitas] = useState<Appointment[]>([]);
  const [profs, setProfs] = useState<Professional[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [businessConfig, setBusinessConfig] = useState<BusinessConfig>({
    businessName: "Atmósfera",
    professionalRoleLabel: "Profesional",
    professionalRoleLabelPlural: "Profesionales",
    enabledNavItems: ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"]
  });
  
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const loadAllData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Authenticate
      const userRes = await api.getCurrentUser();
      if (!userRes || userRes.status !== "success") {
        window.location.href = "/login";
        return;
      }
      const loggedUser = userRes.payload || userRes.user;
      setCurrentUser(loggedUser);

      const params = new URLSearchParams(window.location.search);
      const urlSlug = params.get('slug')?.trim();
      const urlView = params.get('view');

      // Un superadministrador sin tenant explícito permanece en el ámbito global.
      // No se deben consultar endpoints de calendario hasta que elija un negocio.
      if (loggedUser.role === 'superadmin' && !urlSlug) {
        setViewType(urlView === 'saas-metricas' ? 'saas-metricas' : 'saas-negocios');
        setSelectedProfessionalId(null);
        return;
      }

      // Si el usuario posee un negocio y el slug no está en la URL, redireccionar agregándolo.
      if (typeof window !== 'undefined' && loggedUser.businessSlug && !urlSlug) {
        params.set("slug", loggedUser.businessSlug);
        window.location.href = `${window.location.pathname}?${params.toString()}`;
        return;
      }

      // Load Config, Workers, Appointments parallelly
      const [config, workers, appointments] = await Promise.all([
        api.getBusinessConfigData(),
        api.getWorkers(),
        api.getMyAppointments()
      ]);

      setBusinessConfig(config);
      setProfs(workers);
      setCitas(appointments);

      // Load shifts for all workers in parallel
      const shiftsPromises = workers.map(w => api.getWorkerShifts(w._id));
      const shiftsResults = await Promise.all(shiftsPromises);
      const allShifts = shiftsResults.flat();
      setShifts(allShifts);

      // Set default view & filter based on role, supporting URL query parameters
      const tenantViews: ViewType[] = ['semana', 'dia', 'mes', 'horarios'];
      const superadminViews: ViewType[] = [...tenantViews, 'saas-negocios', 'saas-metricas'];
      const allowedViews = loggedUser.role === 'superadmin' ? superadminViews : tenantViews;

      if (urlView && allowedViews.includes(urlView as ViewType)) {
        setViewType(urlView as ViewType);
        setSelectedProfessionalId(null);
      } else if (loggedUser && loggedUser.role === 'worker') {
        setViewType('semana');
        setSelectedProfessionalId(loggedUser._id);
      } else if (loggedUser && loggedUser.role === 'superadmin') {
        setViewType('mes');
        setSelectedProfessionalId(null);
      } else {
        setViewType('dia');
        setSelectedProfessionalId(null);
      }
    } catch (err: unknown) {
      console.error("Error loading calendar data:", err);
      setError("Ocurrió un error al cargar la información del panel.");
      // If unauthorized, redirect to login
      if (api.isApiError(err) && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    try {
      setError(null);
      const appointments = await api.getMyAppointments();
      setCitas(appointments);
    } catch (err: any) {
      console.error("Error refreshing appointments:", err);
      setError("Error al sincronizar datos.");
    }
  };
  useEffect(() => {
    loadAllData();

    // Sincronización en tiempo real vía WebSockets
    const apiUrl = import.meta.env.PUBLIC_API_URL;
    if (apiUrl) {
      try {
        const socketUrl = new URL(apiUrl).origin;
        const socket = io(socketUrl, {
          transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
          console.log("Conectado a WebSockets para actualizaciones de calendario:", socket.id);
        });

        socket.on('calendar_update', () => {
          // La vista global del superadministrador no tiene un tenant que sincronizar.
          if (api.getBusinessSlug()) {
            console.log("Recibido evento global 'calendar_update'. Sincronizando citas...");
            refreshData();
          }
        });

        socket.on('disconnect', () => {
          console.log("Desconectado de WebSockets de calendario");
        });

        return () => {
          socket.disconnect();
        };
      } catch (err) {
        console.error("Error al establecer conexión WebSocket:", err);
      }
    }
  }, []);
  const confirmApp = async (id: string): Promise<boolean> => {
    try {
      const res = await api.confirmAppointment(id);
      if (res && res.status === "success") {
        setCitas(prev => prev.map(c => c._id === id ? { ...c, status: 'confirmed' } : c));
        return true;
      }
      return false;
    } catch (err) {
      console.error("Error confirming appointment:", err);
      return false;
    }
  };

  const completeApp = async (id: string): Promise<boolean> => {
    try {
      const res = await api.completeAppointment(id);
      if (res && res.status === "success") {
        setCitas(prev => prev.map(c => c._id === id ? { ...c, status: 'completed' } : c));
        return true;
      }
      return false;
    } catch (err) {
      console.error("Error completing appointment:", err);
      return false;
    }
  };

  const cancelApp = async (id: string): Promise<boolean> => {
    try {
      const res = await api.cancelAppointment(id);
      if (res && res.status === "success") {
        setCitas(prev => prev.map(c => c._id === id ? { ...c, status: 'cancelled' } : c));
        return true;
      }
      return false;
    } catch (err) {
      console.error("Error cancelling appointment:", err);
      return false;
    }
  };

  const logoutUser = async () => {
    try {
      const res = await api.logout();
      if (res && res.status === "success") {
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Error logging out:", err);
      alert("Error al cerrar sesión");
    }
  };

  const switchWorkspace = async (businessId: string) => {
    try {
      setLoading(true);
      const res = await api.switchBusiness(businessId);
      if (res && res.status === "success") {
        const user = res.payload || res.user;
        if (user.businessSlug) {
          window.location.href = `/admin?slug=${user.businessSlug}`;
        } else {
          window.location.href = "/admin";
        }
      } else {
        alert("Error al cambiar de negocio");
        setLoading(false);
      }
    } catch (err) {
      console.error("Error switching workspace:", err);
      alert("Error al intentar cambiar de negocio");
      setLoading(false);
    }
  };

  return (
    <CalendarContext.Provider value={{
      currentDate,
      viewType,
      selectedProfessionalId,
      selectedAppointment,
      citas,
      profs,
      shifts,
      businessConfig,
      loading,
      error,
      currentUser,
      setDate,
      setViewType,
      setSelectedProfessionalId,
      setSelectedAppointment,
      confirmApp,
      completeApp,
      cancelApp,
      logoutUser,
      refreshData,
      switchWorkspace
    }}>
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => {
  const context = useContext(CalendarContext);
  if (context === undefined) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
};
