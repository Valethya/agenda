import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentReadCapability,
  consumeGuestAppointmentRescheduleCapability,
  exchangeGuestAppointmentCancelChallenge,
  exchangeGuestAppointmentReadChallenge,
  exchangeGuestAppointmentRescheduleChallenge,
  requestGuestAppointmentCancelChallenge,
  requestGuestAppointmentReadChallenge,
  requestGuestAppointmentRescheduleChallenge,
} from "../services/guestAppointmentCapability.service.js";

const INVALID_PROOF_CODE = "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF";
const CANCEL_STATE_CONFLICT_CODE = "GUEST_APPOINTMENT_CANCEL_STATE_CONFLICT";
const RESCHEDULE_STATE_CONFLICT_CODE = "GUEST_APPOINTMENT_RESCHEDULE_STATE_CONFLICT";
const RESCHEDULE_SLOT_CONFLICT_CODE = "GUEST_APPOINTMENT_RESCHEDULE_SLOT_CONFLICT";

const secure = (res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  return res;
};
const invalidProof = (res) => secure(res).status(403).json({ status: "fail", code: INVALID_PROOF_CODE, message: "Acceso guest no válido" });
const cancelStateConflict = (res) => secure(res).status(409).json({
  status: "fail", code: CANCEL_STATE_CONFLICT_CODE, message: "La reserva ya no se encuentra en un estado cancelable",
});
const rescheduleConflict = (res, code) => secure(res).status(409).json({
  status: "fail",
  code,
  message: code === RESCHEDULE_SLOT_CONFLICT_CODE
    ? "El horario seleccionado ya no se encuentra disponible"
    : "La reserva ya no se encuentra en un estado reagendable",
});
const acceptedChallenge = (res, message) => secure(res).status(202).json({ status: "accepted", message });
const exchangeResponse = (res, capability) => secure(res).status(200).json({
  status: "success",
  capability: {
    businessId: capability.businessId,
    appointmentId: capability.appointmentId,
    action: capability.action,
    bearer: capability.bearer,
    expiresAt: capability.expiresAt,
  },
});

export const requestReadChallenge = async (req, res) => {
  await requestGuestAppointmentReadChallenge({ businessId: req.body.businessId, appointmentId: req.body.appointmentId });
  return acceptedChallenge(res, "Si la cita puede verificarse por este canal, recibirás un correo para continuar.");
};
export const requestCancelChallenge = async (req, res) => {
  await requestGuestAppointmentCancelChallenge({ businessId: req.body.businessId, appointmentId: req.body.appointmentId });
  return acceptedChallenge(res, "Si la cita puede verificarse por este canal, recibirás un correo para autorizar la cancelación.");
};
export const requestRescheduleChallenge = async (req, res) => {
  await requestGuestAppointmentRescheduleChallenge({ businessId: req.body.businessId, appointmentId: req.body.appointmentId });
  return acceptedChallenge(res, "Si la cita puede verificarse por este canal, recibirás un correo para autorizar el reagendado.");
};

export const exchangeReadChallenge = async (req, res) => {
  try {
    const capability = await exchangeGuestAppointmentReadChallenge(req.body);
    return exchangeResponse(res, capability);
  } catch { return invalidProof(res); }
};
export const exchangeCancelChallenge = async (req, res) => {
  try {
    const capability = await exchangeGuestAppointmentCancelChallenge(req.body);
    return exchangeResponse(res, capability);
  } catch { return invalidProof(res); }
};
export const exchangeRescheduleChallenge = async (req, res) => {
  try {
    const capability = await exchangeGuestAppointmentRescheduleChallenge(req.body);
    return exchangeResponse(res, capability);
  } catch { return invalidProof(res); }
};

export const consumeReadCapability = async (req, res) => {
  try {
    const appointment = await consumeGuestAppointmentReadCapability(req.body);
    return secure(res).status(200).json({ status: "success", appointment });
  } catch { return invalidProof(res); }
};
export const consumeCancelCapability = async (req, res) => {
  try {
    const appointment = await consumeGuestAppointmentCancelCapability(req.body);
    return secure(res).status(200).json({ status: "success", appointment });
  } catch (error) {
    if (error?.code === CANCEL_STATE_CONFLICT_CODE) return cancelStateConflict(res);
    return invalidProof(res);
  }
};
export const consumeRescheduleCapability = async (req, res) => {
  try {
    const appointment = await consumeGuestAppointmentRescheduleCapability(req.body);
    return secure(res).status(200).json({ status: "success", appointment });
  } catch (error) {
    if (error?.code === RESCHEDULE_STATE_CONFLICT_CODE || error?.code === RESCHEDULE_SLOT_CONFLICT_CODE) {
      return rescheduleConflict(res, error.code);
    }
    return invalidProof(res);
  }
};
