import nodemailer from "nodemailer";
import dns from "dns";
import logger from "../../config/logger.js";

let transporter;

/**
 * Obtener o inicializar el transportador SMTP.
 * Soporta 3 modos: Resend API (HTTPS), SMTP de producción, y Ethereal (desarrollo).
 */
const getTransporter = async () => {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST || process.env["SMTP-HOST"];
  const smtpPort = process.env.SMTP_PORT || process.env["SMTP-PORT"];
  const smtpUser = process.env.SMTP_USER || process.env["SMTP-USER"];
  const smtpPass = process.env.SMTP_PASS || process.env["SMTP-PASS"];
  const smtpSecure = process.env.SMTP_SECURE || process.env["SMTP-SECURE"];

  const hasSmtpConfig = smtpHost && smtpPort && smtpUser && smtpPass;

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
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { family: 4 }, callback);
      },
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  } else {
    logger.info("Mailer: Configurando transportador SMTP de prueba (Ethereal)...");
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

/**
 * Envía un correo usando Resend API (HTTPS) o SMTP/Ethereal.
 * No lanza excepciones para evitar interrumpir el flujo principal.
 */
export const sendMail = async ({ to, subject, html, fromName = "Agenda App", replyTo = null, bccEmail = null }) => {
  const recipient = Array.isArray(to) ? to[0] : to;
  try {
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env["SMTP-FROM-EMAIL"] || process.env.SMTP_USER || process.env["SMTP-USER"] || "noreply@atmosferastudio.cl";

    // Si hay una API Key de Resend configurada, enviamos por API REST (HTTPS)
    if (process.env.RESEND_API_KEY) {
      logger.info(`Mailer: Enviando email a ${recipient} usando la API de Resend (HTTPS)...`);
      
      const payload = {
        from: `"${fromName}" <${fromEmail}>`,
        to: [recipient],
        subject,
        html,
      };

      if (replyTo) payload.reply_to = replyTo;
      if (bccEmail && bccEmail !== recipient) payload.bcc = [bccEmail];

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || JSON.stringify(resData));
      }

      logger.info(`Email enviado con éxito a ${recipient} vía Resend. ID: ${resData.id}`);
      return resData;
    }

    // Comportamiento tradicional por SMTP o Ethereal
    const activeTransporter = await getTransporter();

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipient,
      subject,
      html,
    };

    if (replyTo) mailOptions.replyTo = replyTo;
    if (bccEmail && bccEmail !== recipient) mailOptions.bcc = bccEmail;

    const info = await activeTransporter.sendMail(mailOptions);
    logger.info(`Email enviado con éxito a ${recipient}. MessageId: ${info.messageId}`);

    if (activeTransporter.options.host === "smtp.ethereal.email") {
      console.log(`\n=================== EMAIL ENVIADO (PRUEBAS) ===================`);
      console.log(`De: "${fromName}" <${fromEmail}>`);
      console.log(`Para: ${recipient}`);
      if (mailOptions.bcc) console.log(`Copia Oculta (BCC): ${mailOptions.bcc}`);
      if (replyTo) console.log(`Responder a (Reply-To): ${replyTo}`);
      console.log(`Asunto: ${subject}`);
      console.log(`Previsualizar correo en tu navegador: ${nodemailer.getTestMessageUrl(info)}`);
      console.log(`================================================================\n`);
    }

    return info;
  } catch (error) {
    logger.error(`Error enviando email a ${recipient}: ${error.message}`);
  }
};
