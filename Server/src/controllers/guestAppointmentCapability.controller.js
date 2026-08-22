import { consumeGuestAppointmentReadCapability, exchangeGuestAppointmentReadChallenge, requestGuestAppointmentReadChallenge } from "../services/guestAppointmentCapability.service.js";

const INVALID_PROOF_CODE = "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF";

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

export const requestReadChallenge = async (req, res) => {
  await requestGuestAppointmentReadChallenge({ businessId: req.body.businessId, appointmentId: req.body.appointmentId });
  return secure(res).status(202).json({
    status: "accepted",
    message: "Si la cita puede verificarse por este canal, recibirás un correo para continuar.",
  });
};

export const exchangeReadChallenge = async (req, res) => {
  try {
    const capability = await exchangeGuestAppointmentReadChallenge({
      businessId: req.body.businessId,
      appointmentId: req.body.appointmentId,
      verificationId: req.body.verificationId,
      challengeSecret: req.body.challengeSecret,
    });
    return secure(res).status(200).json({
      status: "success",
      capability: {
        businessId: capability.businessId,
        appointmentId: capability.appointmentId,
        action: capability.action,
        bearer: capability.bearer,
        expiresAt: capability.expiresAt,
      },
    });
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
