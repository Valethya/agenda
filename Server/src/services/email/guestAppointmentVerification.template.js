const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export const guestAppointmentVerificationTemplate = ({ accessUrl, businessName }) => {
  const safeUrl = escapeHtml(accessUrl);
  const safeBusinessName = escapeHtml(businessName || "Agenda");

  return {
    subject: `Verifica el acceso a tu cita - ${safeBusinessName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222;">
        <h2>Acceso a tu cita</h2>
        <p>Se solicitó consultar una cita en <strong>${safeBusinessName}</strong>.</p>
        <p>Este enlace demuestra únicamente control actual de este correo para esa cita y esa acción. No crea una cuenta ni entrega acceso a otras citas.</p>
        <p style="margin: 28px 0;">
          <a href="${safeUrl}" rel="noreferrer" style="display: inline-block; padding: 12px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Verificar y continuar</a>
        </p>
        <p>Si no solicitaste este acceso, ignora este mensaje.</p>
      </div>
    `,
  };
};
