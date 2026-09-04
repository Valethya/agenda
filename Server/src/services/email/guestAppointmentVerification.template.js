const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const purposeFromAccessUrl = (accessUrl) => {
  try {
    const url = new URL(accessUrl);
    return new URLSearchParams(url.hash.slice(1)).get("purpose");
  } catch {
    return null;
  }
};

export const guestAppointmentVerificationTemplate = ({ accessUrl, businessName }) => {
  const safeUrl = escapeHtml(accessUrl);
  const safeBusinessName = escapeHtml(businessName || "Agenda");
  const isCancel = purposeFromAccessUrl(accessUrl) === "appointment-cancel-bootstrap";

  const subject = isCancel
    ? `Autoriza la cancelación de tu cita - ${safeBusinessName}`
    : `Verifica el acceso a tu cita - ${safeBusinessName}`;
  const heading = isCancel ? "Autorizar cancelación" : "Acceso a tu cita";
  const intro = isCancel
    ? `Se solicitó autorización para cancelar una cita en <strong>${safeBusinessName}</strong>.`
    : `Se solicitó consultar una cita en <strong>${safeBusinessName}</strong>.`;
  const actionNote = isCancel
    ? "Abrir este enlace no cancela la reserva. Después de verificarlo deberás confirmar explícitamente la cancelación en Agenda."
    : "El enlace permite continuar con la consulta de esa reserva.";

  return {
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222;">
        <h2>${heading}</h2>
        <p>${intro}</p>
        <p>Este enlace demuestra únicamente control actual de este correo para esa cita y esa acción. No crea una cuenta ni entrega acceso a otras citas.</p>
        <p><strong>${actionNote}</strong></p>
        <p style="margin: 28px 0;">
          <a href="${safeUrl}" rel="noreferrer" style="display: inline-block; padding: 12px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Verificar y continuar</a>
        </p>
        <p>Si no solicitaste este acceso, ignora este mensaje.</p>
      </div>
    `,
  };
};
