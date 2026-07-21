import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Appointment } from '../types';
import { useSession } from './SessionContext';
import { resolveCalendarSelection, type ViewType } from './sessionPolicy';

interface CalendarNavigationContextType {
  currentDate: Date;
  viewType: ViewType;
  selectedProfessionalId: string | null;
  selectedAppointment: Appointment | null;
  setDate: (date: Date) => void;
  setViewType: (viewType: ViewType) => void;
  setSelectedProfessionalId: (id: string | null) => void;
  setSelectedAppointment: (appointment: Appointment | null) => void;
}

const CalendarNavigationContext = createContext<CalendarNavigationContextType | undefined>(undefined);

export const CalendarNavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, scope } = useSession();
  const [currentDate, setDate] = useState(new Date());
  const [viewType, setViewType] = useState<ViewType>('semana');
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  useEffect(() => {
    if (!currentUser || scope === 'loading' || scope === 'redirecting') return;

    const params = new URLSearchParams(window.location.search);
    const selection = resolveCalendarSelection(currentUser, scope, params.get('view'));
    setViewType(selection.viewType);
    setSelectedProfessionalId(selection.selectedProfessionalId);
    setSelectedAppointment(null);
  }, [currentUser, scope]);

  return (
    <CalendarNavigationContext.Provider value={{
      currentDate,
      viewType,
      selectedProfessionalId,
      selectedAppointment,
      setDate,
      setViewType,
      setSelectedProfessionalId,
      setSelectedAppointment
    }}>
      {children}
    </CalendarNavigationContext.Provider>
  );
};

export const useCalendarNavigation = () => {
  const context = useContext(CalendarNavigationContext);
  if (context === undefined) {
    throw new Error('useCalendarNavigation must be used within a CalendarNavigationProvider');
  }
  return context;
};

export type { ViewType } from './sessionPolicy';
