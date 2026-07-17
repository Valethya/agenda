/**
 * Plantillas HTML de email con soporte de branding por negocio.
 * Cada función retorna un objeto { subject, html } listo para enviar.
 */

// Plantilla base HTML con diseño minimalista moderno
const getBaseTemplate = (title, content, branding = {}) => {
  const brandColor = branding.brandColor || "#4F46E5";
  const logoHtml = branding.logoUrl 
    ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${branding.logoUrl}" alt="Logo" style="max-height: 60px; object-fit: contain;" /></div>` 
    : "";
  const footerHtml = branding.customFooter 
    ? `<p style="font-size: 14px; color: #666; text-align: center; margin-top: 25px; font-style: italic; border-top: 1px dashed #f0f0f0; padding-top: 15px;">${branding.customFooter}</p>` 
    : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0f0f0; border-radius: 8px; color: #333;">
      ${logoHtml}
      <h2 style="color: ${brandColor}; margin-bottom: 20px; border-bottom: 2px solid ${brandColor}; padding-bottom: 10px;">${title}</h2>
      <div style="line-height: 1.6; font-size: 16px;">
        ${content}
      </div>
      ${footerHtml}
      <hr style="border: 0; border-top: 1px solid #f0f0f0; margin: 30px 0;" />
      <p style="font-size: 12px; color: #999; text-align: center;">Este es un correo automático, por favor no respondas a este mensaje.</p>
    </div>
  `;
};

// Helper para formatear fechas en español
const formatDateES = (date) =>
  new Date(date).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

// 1. Restablecimiento de Contraseña
export const resetPassword = (resetUrl) => ({
  subject: "Restablece tu contraseña - Agenda",
  html: getBaseTemplate("Restablecimiento de Contraseña", `
    <p>Hola,</p>
    <p>Has solicitado restablecer tu contraseña para ingresar a tu Agenda. Haz clic en el botón de abajo para continuar:</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${resetUrl}" style="background-color: #4F46E5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Restablecer Contraseña</a>
    </div>
    <p>Este enlace es válido por 1 hora. Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
  `),
});

// 2. Cita Recibida (Reserva creada)
export const appointmentBooked = (detail, branding) => {
  const { worker, service, date, startTime, status } = detail;
  const formattedDate = formatDateES(date);

  return {
    subject: `Tu solicitud de cita ha sido recibida - ${branding.businessName}`,
    html: getBaseTemplate("Solicitud de Cita Recibida", `
      <p>Hola,</p>
      <p>Hemos recibido tu solicitud de reserva en <strong>${branding.businessName}</strong>. A continuación tienes los detalles de tu cita:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px;">
        <tr><td style="padding: 8px 0; font-weight: bold; width: 120px;">Servicio:</td><td style="padding: 8px 0;">${service.name}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Profesional:</td><td style="padding: 8px 0;">${worker.firstName} ${worker.lastName}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Fecha:</td><td style="padding: 8px 0; text-transform: capitalize;">${formattedDate}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Hora:</td><td style="padding: 8px 0;">${startTime} hrs</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Estado:</td><td style="padding: 8px 0;"><span style="background-color: #FEF3C7; color: #D97706; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 13px;">${status === "pending_payment" ? "Pendiente de Pago" : "Pendiente"}</span></td></tr>
      </table>
      ${status === "pending_payment" ? `<p>Recuerda realizar el pago correspondiente para confirmar definitivamente tu hora.</p>` : `<p>Te notificaremos por correo electrónico una vez que tu cita sea confirmada.</p>`}
    `, branding),
  };
};

// 3. Cita Confirmada
export const appointmentConfirmed = (detail, branding) => {
  const { worker, service, date, startTime } = detail;
  const formattedDate = formatDateES(date);

  return {
    subject: `¡Cita Confirmada! - ${branding.businessName}`,
    html: getBaseTemplate("Cita Confirmada", `
      <p>Hola,</p>
      <p>¡Tu cita en <strong>${branding.businessName}</strong> ha sido confirmada con éxito! Te esperamos en el horario indicado:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px;">
        <tr><td style="padding: 8px 0; font-weight: bold; width: 120px;">Servicio:</td><td style="padding: 8px 0;">${service.name}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Profesional:</td><td style="padding: 8px 0;">${worker.firstName} ${worker.lastName}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Fecha:</td><td style="padding: 8px 0; text-transform: capitalize;">${formattedDate}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Hora:</td><td style="padding: 8px 0;">${startTime} hrs</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Estado:</td><td style="padding: 8px 0;"><span style="background-color: #D1FAE5; color: #059669; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 13px;">Confirmada</span></td></tr>
      </table>
      <p>Si deseas realizar cambios, recuerda hacerlo con un mínimo de 2 horas de anticipación.</p>
    `, branding),
  };
};

// 4. Cita Cancelada
export const appointmentCancelled = (detail, branding) => {
  const { worker, service, date, startTime } = detail;
  const formattedDate = formatDateES(date);

  return {
    subject: `Cita Cancelada - ${branding.businessName}`,
    html: getBaseTemplate("Cita Cancelada", `
      <p>Hola,</p>
      <p>Te informamos que tu cita en <strong>${branding.businessName}</strong> ha sido cancelada:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px;">
        <tr><td style="padding: 8px 0; font-weight: bold; width: 120px;">Servicio:</td><td style="padding: 8px 0;">${service.name}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Profesional:</td><td style="padding: 8px 0;">${worker.firstName} ${worker.lastName}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Fecha:</td><td style="padding: 8px 0; text-transform: capitalize;">${formattedDate}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Hora:</td><td style="padding: 8px 0;">${startTime} hrs</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Estado:</td><td style="padding: 8px 0;"><span style="background-color: #FEE2E2; color: #DC2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 13px;">Cancelada</span></td></tr>
      </table>
      <p>Lamentamos los inconvenientes. Puedes volver a consultar las horas disponibles si deseas agendar una nueva hora.</p>
    `, branding),
  };
};

// 5. Notificación al Worker (Aprobación Pendiente)
export const workerPendingApproval = (detail, branding) => {
  const { client, worker, service, date, startTime } = detail;
  const formattedDate = formatDateES(date);

  return {
    subject: `⚠️ Nueva cita pendiente de aprobación - ${branding.businessName}`,
    html: getBaseTemplate("Nueva Solicitud de Cita", `
      <p>Hola <strong>${worker.firstName}</strong>,</p>
      <p>Has recibido una nueva solicitud de reserva en <strong>${branding.businessName}</strong> que requiere tu confirmación manual:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px;">
        <tr><td style="padding: 8px 0; font-weight: bold; width: 120px;">Cliente:</td><td style="padding: 8px 0;">${client.firstName} ${client.lastName}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Teléfono:</td><td style="padding: 8px 0;">${client.phone ? client.phone.join(", ") : "No indicado"}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Email:</td><td style="padding: 8px 0;">${client.email ? client.email.join(", ") : "No indicado"}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Servicio:</td><td style="padding: 8px 0;">${service.name}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Fecha:</td><td style="padding: 8px 0; text-transform: capitalize;">${formattedDate}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Hora:</td><td style="padding: 8px 0;">${startTime} hrs</td></tr>
      </table>
      <p>Por favor, ingresa al panel administrativo de <strong>${branding.businessName}</strong> para confirmar o gestionar esta cita.</p>
    `, branding),
  };
};
