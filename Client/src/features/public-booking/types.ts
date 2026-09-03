export interface PublicService {
  id: string;
  business: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  depositAmount: number;
}

export interface PublicProfessional {
  id: string;
  firstName: string;
  lastName: string;
}

export interface PublicSlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface PublicAppointmentCreated {
  appointmentId: string;
  businessId: string;
  serviceId: string;
  workerId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
}

export interface PublicClientInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface PublicBookingPayload {
  worker: string;
  service: string;
  date: string;
  startTime: string;
  clientInfo: PublicClientInfo;
  notes?: string;
}

export interface PublicApiResponse<T> {
  status: string;
  message?: string;
  results?: number;
  payload: T;
}
