export interface GuestAppointmentIdentity {
  businessId: string;
  appointmentId: string;
}

export type GuestAppointmentPurpose =
  | 'appointment-read-bootstrap'
  | 'appointment-cancel-bootstrap';

export interface GuestAppointmentProof extends GuestAppointmentIdentity {
  verificationId: string;
  purpose: GuestAppointmentPurpose;
  challengeSecret: string;
}

export interface GuestAppointmentReadCapability extends GuestAppointmentIdentity {
  action: 'read';
  bearer: string;
  expiresAt: string;
}

export interface GuestAppointmentCancelCapability extends GuestAppointmentIdentity {
  action: 'cancel';
  bearer: string;
  expiresAt: string;
}

export interface GuestAppointmentReadProjection {
  appointmentId: string;
  business: { id: string; name: string; slug: string } | null;
  service: { id: string; name: string; duration: number } | null;
  professional: { id: string; firstName: string; lastName: string } | null;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  paymentStatus: string;
}

export interface GuestAppointmentCancelProjection extends GuestAppointmentIdentity {
  status: 'cancelled';
  date: string;
  startTime: string;
  endTime: string;
}

export interface GuestChallengeAccepted {
  status: 'accepted';
  message: string;
}

export type GuestReadChallengeAccepted = GuestChallengeAccepted;
export type GuestCancelChallengeAccepted = GuestChallengeAccepted;
