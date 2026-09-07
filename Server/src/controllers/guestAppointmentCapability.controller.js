import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentReadCapability,
  exchangeGuestAppointmentCancelChallenge,
  exchangeGuestAppointmentReadChallenge,
  requestGuestAppointmentCancelChallenge,
  requestGuestAppointmentReadChallenge,
} from "../services/guestAppointmentCapability.service.js";

const INVALID_PROOF_CODE = "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF";
const STATE_CONFLICT_CODE = "GUEST_APPOINTMENT_CANCEL_STATE_CONFLICT";

const secure = (res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  return res;
};

const invalidProof = (res) => secure(res).status(403).json({
  status: "fail",
  code: INVALID_PROOF_CODE,
  message: "Acceso guest no válido",
});

const stateConflict = (res) => secure(res).status(409).json({
  status: "fail",
  code: STATE_CONFLICT_CODE,
  message: "La reserva ya no se encuentra en un estado cancelable",
});

const acceptedChallenge = (res, message) => secure(res).status(202).json({
  status: "accepted",
  message,
});

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

export const exchangeReadChallenge = async (req, res) => {
  try {
    const capability = await exchangeGuestAppointmentReadChallenge({
      businessId: req.body.businessId,
      appointmentId: req.body.appointmentId,
      verificationId: req.body.verificationId,
      challengeSecret: req.body.challengeSecret,
    });
    return exchangeResponse(res, capability);
  } catch {
    return invalidProof(res);
  }
};

export const exchangeCancelChallenge = async (req, res) => {
  try {
    const capability = await exchangeGuestAppointmentCancelChallenge({
      businessId: req.body.businessId,
      appointmentId: req.body.appointmentId,
      verificationId: req.body.verificationId,
      challengeSecret: req.body.challengeSecret,
    });
    return exchangeResponse(res, capability);
  } catch {
    return invalidProof(res);
  }
};

export const consumeReadCapability = async (req, res) => {
  try {
    const appointment = await consumeGuestAppointmentReadCapability({
      businessId: req.body.businessId,
      appointmentId: req.body.appointmentId,
      bearer: req.body.bearer,
    });
    return secure(res).status(200).json({ status: "success", appointment });
  } catch {
    return invalidProof(res);
  }
};

export const consumeCancelCapability = async (req, res) => {
  try {
    const appointment = await consumeGuestAppointmentCancelCapability({
      businessId: req.body.businessId,
      appointmentId: req.body.appointmentId,
      bearer: req.body.bearer,
    });
    return secure(res).status(200).json({ status: "success", appointment });
  } catch (error) {
    if (error?.code === STATE_CONFLICT_CODE) return stateConflict(res);
    return invalidProof(res);
  }
};
