import nodemailer from "nodemailer";
import logger from "../config/logger.js";
import BusinessConfig from "../db/models/businessConfig.model.js";

let transporter;

// Obtener o inicializar el transportador SMTP
const getTransporter = async () => {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST || process.env["SMTP-HOST"];
  const smtpPort = process.env.SMTP_PORT || process.env["SMTP-PORT"];
  const smtpUser = process.env.SMTP_USER || process.env["SMTP-USER"];
  const smtpPass = process.env.SMTP_PASS || process.env["SMTP-PASS"];
  const smtpSecure = process.env.SMTP_SECURE || process.env["SMTP-SECURE"];

  const hasSmtpConfig = smtpHost && smtpPort && smtpUser && smtpPass;

  // Imprimir las llaves SMTP encontradas para depuración remota
  const smtpKeys = Object.keys(process.env).filter(k => k.toUpperCase().includes("SMTP"));
  logger.info(`Mailer: Llaves SMTP encontradas en process.env: ${JSON.stringify(smtpKeys)}`);

  if (hasSmtpConfig) {
    const isSecure = smtpSecure === 'true' || 
                     smtpSecure === '1' || 
                     Number(smtpPort) === 465;
    logger.info(`Mailer: Configurando transportador SMTP de producción (host=${smtpHost}, port=${smtpPort}, secure=${isSecure}, user=${smtpUser})...`);
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: isSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });  } else {
    logger.info("Mailer: Configurando transportador SMTP de prueba (Ethereal)...");
    // Crear cuenta de prueba de Ethereal Mail para desarrollo
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }

  return transporter;
};

// Obtener configuración de marca de un negocio
const getBrandingSettings = async (businessId) => {
  const settings = {
    brandColor: "#4F46E5",
    logoUrl: "",
    customFooter: "",
    businessName: "Mi Agenda",
    contactEmail: ""
  };

  if (!businessId) return settings;

  try {
    const config = await BusinessConfig.findOne({ business: businessId });
    if (config) {
      if (config.businessName) settings.businessName = config.businessName;
      if (config.emailSettings) {
        if (config.emailSettings.brandColor) settings.brandColor = config.emailSettings.brandColor;
        if (config.emailSettings.logoUrl) settings.logoUrl = config.emailSettings.logoUrl;
        if (config.emailSettings.customFooter) settings.customFooter = config.emailSettings.customFooter;
      }
    }

    // Recuperar el email del dueño del negocio para Reply-To y BCC
    const Business = (await import("../db/models/business.model.js")).default;
    const business = await Business.findById(businessId).populate("owner");
    if (business && business.owner && business.owner.email) {
      settings.contactEmail = Array.isArray(business.owner.email)
        ? business.owner.email[0]
        : business.owner.email;
    }
  } catch (error) {
    logger.error(`Error al recuperar configuración de correo para negocio ${businessId}: ${error.message}`);
  }

  return settings;
};

// Enviar Correo Genérico con Soporte de Negocio
export const sendMail = async ({ to, subject, html, businessId = null }) => {
  const recipient = Array.isArray(to) ? to[0] : to;
  try {
    const activeTransporter = await getTransporter();

    let fromName = process.env.SMTP_FROM_NAME || process.env["SMTP-FROM-NAME"] || "Agenda App";
    let replyTo = null;
    let bccEmail = null;

    if (businessId) {
      const branding = await getBrandingSettings(businessId);
      fromName = branding.businessName || fromName;
      if (branding.contactEmail) {
        replyTo = branding.contactEmail;
        bccEmail = branding.contactEmail; // Copia oculta al dueño del negocio
      }
    }

    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env["SMTP-FROM-EMAIL"] || process.env.SMTP_USER || process.env["SMTP-USER"] || "noreply@agendaapp.com";
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipient,
      subject,
      html,
    };

    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }

    // Si hay correo de copia oculta asignado y no es el mismo que recibe el email principal
    if (bccEmail && bccEmail !== recipient) {
      mailOptions.bcc = bccEmail;
    }

    const info = await activeTransporter.sendMail(mailOptions);
    logger.info(`Email enviado con éxito a ${recipient}. MessageId: ${info.messageId}`);

    // Si es Ethereal, mostramos en la consola el enlace de previsualización del correo
    if (activeTransporter.options.host === "smtp.ethereal.email") {
      console.log(`\n=================== EMAIL ENVIADO (PRUEBAS) ===================`);
      console.log(`De: "${fromName}" <${fromEmail}>`);
      console.log(`Para: ${recipient}`);
      if (mailOptions.bcc) {
        console.log(`Copia Oculta (BCC): ${mailOptions.bcc}`);
      }
      if (replyTo) {
        console.log(`Responder a (Reply-To): ${replyTo}`);
      }
      console.log(`Asunto: ${subject}`);
      console.log(`Previsualizar correo en tu navegador: ${nodemailer.getTestMessageUrl(info)}`);
      console.log(`================================================================\n`);
    }

    return info;
  } catch (error) {
    logger.error(`Error enviando email a ${recipient}: ${error.message}`);
    // No lanzamos la excepción para evitar interrumpir la ejecución principal del servidor
  }
};

// Plantilla base para email con diseño minimalista moderno y branding de negocio
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

// 1. Enviar Email de Restablecimiento de Contraseña
export const sendResetPasswordEmail = async (email, token) => {
  const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${token}`;
  
  const content = `
    <p>Hola,</p>
    <p>Has solicitado restablecer tu contraseña para ingresar a tu Agenda. Haz clic en el botón de abajo para continuar:</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${resetUrl}" style="background-color: #4F46E5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Restablecer Contraseña</a>
    </div>
    <p>Este enlace es válido por 1 hora. Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
  `;

  await sendMail({
    to: email,
    subject: "Restablece tu contraseña - Agenda",
    html: getBaseTemplate("Restablecimiento de Contraseña", content),
  });
};

// 2. Enviar Email de Confirmación de Cita (Creación)
export const sendAppointmentBookedEmail = async (email, appointmentDetail) => {
  const { worker, service, date, startTime, status, business } = appointmentDetail;
  const businessId = business ? (business._id || business) : null;
  const branding = await getBrandingSettings(businessId);

  const formattedDate = new Date(date).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
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
  `;

  await sendMail({
    to: email,
    subject: `Tu solicitud de cita ha sido recibida - ${branding.businessName}`,
    html: getBaseTemplate("Solicitud de Cita Recibida", content, branding),
    businessId,
  });
};

// 3. Enviar Email de Cita Confirmada (Pago exitoso o confirmación manual)
export const sendAppointmentConfirmedEmail = async (email, appointmentDetail) => {
  const { worker, service, date, startTime, business } = appointmentDetail;
  const businessId = business ? (business._id || business) : null;
  const branding = await getBrandingSettings(businessId);

  const formattedDate = new Date(date).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
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
  `;

  await sendMail({
    to: email,
    subject: `¡Cita Confirmada! - ${branding.businessName}`,
    html: getBaseTemplate("Cita Confirmada", content, branding),
    businessId,
  });
};

// 4. Enviar Email de Cita Cancelada
export const sendAppointmentCancelledEmail = async (email, appointmentDetail) => {
  const { worker, service, date, startTime, business } = appointmentDetail;
  const businessId = business ? (business._id || business) : null;
  const branding = await getBrandingSettings(businessId);

  const formattedDate = new Date(date).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
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
  `;

  await sendMail({
    to: email,
    subject: `Cita Cancelada - ${branding.businessName}`,
    html: getBaseTemplate("Cita Cancelada", content, branding),
    businessId,
  });
};

// 5. Enviar Email de Alerta de Aprobación Pendiente al Barbero
export const sendWorkerPendingApprovalEmail = async (workerEmail, appointmentDetail) => {
  const { client, worker, service, date, startTime, business } = appointmentDetail;
  const businessId = business ? (business._id || business) : null;
  const branding = await getBrandingSettings(businessId);

  const formattedDate = new Date(date).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
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
  `;

  await sendMail({
    to: workerEmail,
    subject: `⚠️ Nueva cita pendiente de aprobación - ${branding.businessName}`,
    html: getBaseTemplate("Nueva Solicitud de Cita", content, branding),
    businessId,
  });
};
