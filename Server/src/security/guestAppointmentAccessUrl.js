import { normalizePublicWebsiteUrl } from "./publicWebOrigin.js";

const CONFIG_ERROR_CODE = "GUEST_APPOINTMENT_ACCESS_CONFIG_INVALID";

const configurationError = () => {
  const error = new Error("Configuración de acceso guest no válida");
  error.code = CONFIG_ERROR_CODE;
  return error;
};

export const GUEST_APPOINTMENT_ACCESS_CONFIG_ERROR_CODE = CONFIG_ERROR_CODE;

// The trusted origin is now an explicit tenant-scoped input resolved from fresh
// BusinessConfig.publicWeb trust. There is deliberately no environment fallback.
export const getTrustedGuestAppointmentOrigin = (trustedOrigin) => {
  try {
    return normalizePublicWebsiteUrl(trustedOrigin);
  } catch {
    throw configurationError();
  }
};

export const buildGuestAppointmentVerificationUrl = ({
  trustedOrigin,
  businessId,
  appointmentId,
  verificationId,
  purpose,
  challengeSecret,
}) => {
  const origin = getTrustedGuestAppointmentOrigin(trustedOrigin);
  const fragment = new URLSearchParams({
    businessId: businessId.toString(),
    appointmentId: appointmentId.toString(),
    verificationId: verificationId.toString(),
    purpose,
    challenge: challengeSecret,
  });

  // The bearer stays in the URL fragment. Browsers do not send fragments in the
  // initial HTTP request or Referer header; the trusted frontend must exchange it
  // through the dedicated POST endpoint before loading third-party resources.
  return `${origin}/appointment-access#${fragment.toString()}`;
};
