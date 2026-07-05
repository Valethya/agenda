export interface Client {
  _id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface Professional {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  role: string; // 'admin' | 'worker' | 'superadmin'
  phone?: string;
  business?: string;
}

export interface Service {
  _id: string;
  name: string;
  description?: string;
  duration: number; // in minutes
  price: number;
  depositAmount: number;
  isActive: boolean;
  color?: string; // assigned dynamically or via config
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'pending_payment';

export interface Appointment {
  _id: string;
  client: Client;
  worker: string | Professional; // Professional object if populated, otherwise string id
  service: Service;
  date: string | Date;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' | 'refunded';
  notes?: string;
  business?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Break {
  startTime: string;
  endTime: string;
}

export interface Shift {
  _id?: string;
  worker: string;
  dayOfWeek: number; // 0-6 (0 is Sunday)
  isOpen: boolean;
  startTime: string;
  endTime: string;
  breaks: Break[];
}

export interface BusinessConfig {
  businessName: string;
  professionalRoleLabel: string;
  professionalRoleLabelPlural: string;
  enabledNavItems: string[];
  appointmentSettings?: {
    slotDuration: number;
    bufferTime: number;
    minAdvanceHours: number;
    maxAdvanceDays: number;
    autoConfirmLocalBookings: boolean;
  };
}
