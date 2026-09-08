import AuditLog from "../db/models/auditLog.model.js";
import GuestAppointmentCapability from "../db/models/guestAppointmentCapability.model.js";
import * as communicationRepository from "./guestAppointmentCommunicationJob.repository.js";
import { GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION } from "../security/guestAppointmentCapability.constants.js";

export const consumeRescheduleCapabilityInSession = async ({
  businessId,
  appointmentId,
  secretHash,
  now,
  session,
}) => {
  if (GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION["appointment-reschedule-bootstrap"] !== "reschedule") {
    throw new TypeError("RESCHEDULE no está implementado");
  }
  return GuestAppointmentCapability.findOneAndUpdate(
    {
      business: businessId,
      appointment: appointmentId,
      action: "reschedule",
      secretHash,
      status: "active",
      expiresAt: { $gt: now },
    },
    { $set: { status: "consumed", consumedAt: now } },
    { new: true, runValidators: true, session },
  );
};

export const createGuestRescheduleAuditInSession = async ({
  appointmentId,
  businessId,
  oldWindow,
  newWindow,
  session,
}) => {
  const [audit] = await AuditLog.create([{
    appointmentId,
    event: "APPOINTMENT_RESCHEDULED",
    level: "INFO",
    message: "Reserva reagendada mediante autoridad guest.",
    metadata: {
      actorCapability: "guest-reschedule",
      businessId,
      oldDate: oldWindow.date,
      oldStartTime: oldWindow.startTime,
      oldEndTime: oldWindow.endTime,
      newDate: newWindow.date,
      newStartTime: newWindow.startTime,
      newEndTime: newWindow.endTime,
    },
  }], { session });

  // The audit record and communication intent share the same transaction as the
  // moved Appointment. External delivery cannot observe this job until commit.
  const jobId = communicationRepository.buildCommunicationJobId({
    event: "reschedule",
    appointmentId,
    operationId: audit._id,
  });
  await communicationRepository.enqueueInSession({
    jobId,
    businessId,
    appointmentId,
    event: "reschedule",
    session,
  });
  return audit;
};
