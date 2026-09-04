export interface GuestAppointmentIdentity {
  businessId: string;
  appointmentId: string;
}

export interface GuestAppointmentProof extends GuestAppointmentIdentity {
  verificationId: string;
  purpose: 'appointment-read-bootstrap';
  challengeSecret: string;
}

export interface GuestAppointmentReadCapability extends GuestAppointmentIdentity {
  action: 'read';
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

export interface GuestReadChallengeAccepted {
  status: 'accepted';
  message: string;
}
