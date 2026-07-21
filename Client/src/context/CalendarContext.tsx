import React from 'react';
import { CalendarDataProvider } from './CalendarDataContext';
import { CalendarNavigationProvider } from './CalendarNavigationContext';

export const CalendarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CalendarNavigationProvider>
    <CalendarDataProvider>{children}</CalendarDataProvider>
  </CalendarNavigationProvider>
);

export type { ViewType } from './CalendarNavigationContext';
