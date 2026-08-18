const CONFIG_ERROR_CODE = "GUEST_APPOINTMENT_ACCESS_CONFIG_INVALID";

const configurationError = () => {
  const error = new Error("Configuración de acceso guest no válida");
  error.code = CONFIG_ERROR_CODE;
  return error;
};

export const GUEST_APPOINTMENT_ACCESS_CONFIG_ERROR_CODE = CONFIG_ERROR_CODE;

export const getTrustedGuestAppointmentOrigin = () => {
  const configured = process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN;
  if (typeof configured !== "string" || configured.length === 0 || configured !== configured.trim()) {
    throw configurationError();
  }

  let url;
  try {
    url = new URL(configured);
  } catch {
    throw configurationError();
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw configurationError();
  }

  return url.origin;
};

export const buildGuestAppointmentVerificationUrl = ({
  businessId,
  appointmentId,
  verificationId,
  purpose,
  challengeSecret,
}) => {
  const origin = getTrustedGuestAppointmentOrigin();
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
