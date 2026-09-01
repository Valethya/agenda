export interface Client {
  _id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface AppointmentClient extends Client {
  kind: 'account' | 'guest';
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

export type EntityReference<T extends { _id: string }> = string | T;

export interface ServiceWorkerSummary {
  _id: string;
  firstName?: string;
  lastName?: string;
}

export interface Service {
  _id: string;
  name: string;
  description?: string;
  duration: number; // in minutes
  price: number;
  depositAmount: number;
  isActive: boolean;
  workers?: Array<string | ServiceWorkerSummary>;
  color?: string; // assigned dynamically or via config
}

export interface ServiceWriteInput {
  name: string;
  description: string;
  duration: number;
  price: number;
  depositAmount: number;
  workers: string[];
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'pending_payment';

export interface Appointment {
  _id: string;
  // DTO operacional interno: puede representar una cuenta real o un guest
  // Appointment-scoped. kind no concede identidad/ownership.
  client: AppointmentClient;
  worker: EntityReference<Professional>;
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
  worker: EntityReference<Professional>;
  dayOfWeek: number; // 0-6 (0 is Sunday)
  isOpen: boolean;
  startTime: string;
  endTime: string;
  breaks: Break[];
}

export interface WorkingHour {
  dayOfWeek: number;
  isOpen: boolean;
  startTime: string;
  endTime: string;
  breaks: Break[];
}

export interface AppointmentSettings {
  slotDuration?: number;
  bufferTime?: number;
  minAdvanceHours?: number;
  maxAdvanceDays?: number;
  autoConfirmLocalBookings?: boolean;
}

export interface BusinessUiSettings {
  professionalRoleLabel?: string;
  professionalRoleLabelPlural?: string;
  enabledNavItems?: string[];
}

export interface BusinessSummary {
  _id: string;
  name: string;
  slug: string;
}

export interface BusinessConfigPayload {
  businessName?: string;
  business?: BusinessSummary;
  workingHours?: WorkingHour[];
  appointmentSettings?: AppointmentSettings;
  uiSettings?: BusinessUiSettings;
}

export interface BusinessConfig {
  businessName: string;
  professionalRoleLabel: string;
  professionalRoleLabelPlural: string;
  enabledNavItems: string[];
  business?: BusinessSummary;
  workingHours?: WorkingHour[];
  appointmentSettings?: AppointmentSettings;
  uiSettings?: BusinessUiSettings;
}

export type UserRole = 'admin' | 'worker' | 'superadmin' | 'user';
export type TeamMembershipRole = 'admin' | 'worker';

export interface TeamMembership {
  membershipId: string;
  userId: string;
  name: string | null;
  role: TeamMembershipRole;
  isBookable: boolean;
  isActive: boolean;
  isOwner: boolean;
}

export type TeamMembershipPatch = Partial<
  Pick<TeamMembership, 'role' | 'isBookable' | 'isActive'>
>;

export interface BusinessMembership {
  id: string;
  businessId: string;
  businessName?: string;
  businessSlug?: string;
  role: UserRole;
}

export interface SessionIdentity {
  id?: string;
  _id?: string;
  firstName: string;
  lastName: string;
  email?: string;
  role: UserRole;
  businessId?: string;
  businessSlug?: string;
  isImpersonating?: boolean;
}

export interface SessionUser extends SessionIdentity {
  memberships: BusinessMembership[];
  originalUser?: SessionIdentity | null;
}

export interface ApiResponse<T> {
  status: string;
  message?: string;
  payload: T;
}

export interface SessionApiResponse<T extends SessionIdentity = SessionIdentity> extends ApiResponse<T> {
  status: 'success' | 'succes';
  user: T;
}

export type AuthResponse =
  | SessionApiResponse<SessionIdentity>
  | {
      status: 'needs_selection';
      message?: string;
      memberships: BusinessMembership[];
    };

export interface BusinessOwner {
  firstName: string;
  lastName: string;
  email: string | string[];
  phone?: string | string[];
}

export interface SaasBusiness {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
  subscriptionStatus?: 'active' | 'trial';
  owner?: BusinessOwner;
  createdAt?: string;
}

export interface CreateSaasBusinessInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerPhone: string;
}
