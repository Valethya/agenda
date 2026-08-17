import nodemailer from "nodemailer";
import dns from "dns";
import logger from "../../config/logger.js";

let transporter;

/**
 * Obtener o inicializar el transportador SMTP.
 * Soporta SMTP de producción y Ethereal (desarrollo).
 */
const getTransporter = async () => {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST || process.env["SMTP-HOST"];
  const smtpPort = process.env.SMTP_PORT || process.env["SMTP-PORT"];
  const smtpUser = process.env.SMTP_USER || process.env["SMTP-USER"];
  const smtpPass = process.env.SMTP_PASS || process.env["SMTP-PASS"];
  const smtpSecure = process.env.SMTP_SECURE || process.env["SMTP-SECURE"];

  const hasSmtpConfig = smtpHost && smtpPort && smtpUser && smtpPass;
  const smtpKeys = Object.keys(process.env).filter((key) => key.toUpperCase().includes("SMTP"));
  logger.info(`Mailer: Llaves SMTP encontradas en process.env: ${JSON.stringify(smtpKeys)}`);

  if (hasSmtpConfig) {
    const isSecure = smtpSecure === "true" || smtpSecure === "1" || Number(smtpPort) === 465;
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

const deliverMail = async ({
  to,
  subject,
  html,
  fromName = "Agenda App",
  replyTo = null,
  bccEmail = null,
}, { sensitive = false } = {}) => {
  const recipient = Array.isArray(to) ? to[0] : to;

  try {
    const fromEmail = process.env.SMTP_FROM_EMAIL
      || process.env["SMTP-FROM-EMAIL"]
      || process.env.SMTP_USER
      || process.env["SMTP-USER"]
      || "noreply@atmosferastudio.cl";

    if (process.env.RESEND_API_KEY) {
      if (!sensitive) {
        logger.info(`Mailer: Enviando email a ${recipient} usando la API de Resend (HTTPS)...`);
      }

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
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      let resData = {};
      try {
        resData = await response.json();
      } catch {
        resData = {};
      }

      if (!response.ok) {
        if (sensitive) throw new Error("SENSITIVE_MAIL_DELIVERY_FAILED");
        throw new Error(resData.message || JSON.stringify(resData));
      }

      if (sensitive) {
        logger.info("Mailer: Email sensible entregado al proveedor configurado.");
      } else {
        logger.info(`Email enviado con éxito a ${recipient} vía Resend. ID: ${resData.id}`);
      }
      return resData;
    }

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

    if (sensitive) {
      logger.info("Mailer: Email sensible entregado al transportador configurado.");
    } else {
      logger.info(`Email enviado con éxito a ${recipient}. MessageId: ${info.messageId}`);

      if (activeTransporter.options.host === "smtp.ethereal.email") {
        console.log("\n=================== EMAIL ENVIADO (PRUEBAS) ===================");
        console.log(`De: "${fromName}" <${fromEmail}>`);
        console.log(`Para: ${recipient}`);
        if (mailOptions.bcc) console.log(`Copia Oculta (BCC): ${mailOptions.bcc}`);
        if (replyTo) console.log(`Responder a (Reply-To): ${replyTo}`);
        console.log(`Asunto: ${subject}`);
        console.log(`Previsualizar correo en tu navegador: ${nodemailer.getTestMessageUrl(info)}`);
        console.log("================================================================\n");
      }
    }

    return info;
  } catch (error) {
    if (sensitive) {
      // Never include recipient, provider payload, bearer URL, HTML or provider
      // error text in logs for bearer-bearing messages.
      logger.error("Mailer: Error al entregar email sensible.");
      return undefined;
    }

    logger.error(`Error enviando email a ${recipient}: ${error.message}`);
    return undefined;
  }
};

/**
 * Compatibilidad para correos operacionales existentes.
 */
export const sendMail = async (options) => deliverMail(options, { sensitive: false });

/**
 * Transporte para mensajes que contienen bearer material. No registra destino,
 * contenido, URL, error del proveedor ni preview URL.
 */
export const sendSensitiveMail = async (options) => deliverMail(options, { sensitive: true });
