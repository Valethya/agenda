const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export const tenantOnboardingTemplate = ({
  onboardingId,
  challengeSecret,
  expiresAt,
  businessName,
}) => ({
  subject: `Completa tu incorporación a ${businessName || "Agenda"}`,
  html: `
    <h1>Incorporación a ${escapeHtml(businessName || "Agenda")}</h1>
    <p>Se inició una incorporación de Equipo para este correo.</p>
    <p>Identificador: <strong>${escapeHtml(onboardingId)}</strong></p>
    <p>Código seguro: <strong>${escapeHtml(challengeSecret)}</strong></p>
    <p>Este material es de un solo uso y vence el ${escapeHtml(expiresAt.toISOString())}.</p>
    <p>No compartas este código. No contiene una contraseña ni concede acceso al negocio.</p>
  `,
});
