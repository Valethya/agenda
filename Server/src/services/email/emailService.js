/**
 * Servicio de email: orquesta branding, templates y transporte.
 * Esta es la API pública que consumen los demás servicios.
 * Mantiene compatibilidad con las firmas originales de mailer.js.
 */
import logger from "../../config/logger.js";
import * as businessConfigRepository from "../../repositories/businessConfig.repository.js";
import * as businessRepository from "../../repositories/business.repository.js";
import { sendMail, sendSensitiveMail } from "./transporter.js";
import * as templates from "./templates.js";
import { guestAppointmentVerificationTemplate } from "./guestAppointmentVerification.template.js";
import { frontendUrl } from "../../config/env.js";

const brandingCache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

const getBrandingSettings = async (businessId) => {
  const settings = {
    brandColor: "#4F46E5",
    logoUrl: "",
    customFooter: "",
    businessName: "Mi Agenda",
    contactEmail: "",
  };

  if (!businessId) return settings;

  const cacheKey = businessId.toString();
  const cached = brandingCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;

  try {
    const config = await businessConfigRepository.getConfig(businessId);
    if (config) {
      if (config.businessName) settings.businessName = config.businessName;
      if (config.emailSettings) {
        if (config.emailSettings.brandColor) settings.brandColor = config.emailSettings.brandColor;
        if (config.emailSettings.logoUrl) settings.logoUrl = config.emailSettings.logoUrl;
        if (config.emailSettings.customFooter) settings.customFooter = config.emailSettings.customFooter;
      }
    }

    const business = await businessRepository.findByIdPopulated(businessId, "owner");
    if (business && business.owner && business.owner.email) {
      settings.contactEmail = Array.isArray(business.owner.email)
        ? business.owner.email[0]
        : business.owner.email;
    }

    brandingCache.set(cacheKey, { data: settings, timestamp: Date.now() });
  } catch (error) {
    logger.error(`Error al recuperar configuración de correo para negocio ${businessId}: ${error.message}`);
  }

  return settings;
};

const getMailMeta = (branding) => ({
  fromName: branding.businessName || process.env.SMTP_FROM_NAME || process.env["SMTP-FROM-NAME"] || "Agenda App",
  replyTo: branding.contactEmail || null,
});

export const sendResetPasswordEmail = async (email, token) => {
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
  const template = templates.resetPassword(resetUrl);
  await sendMail({ to: email, ...template });
};

export const sendAppointmentBookedEmail = async (email, appointmentDetail) => {
  const businessId = appointmentDetail.business ? (appointmentDetail.business._id || appointmentDetail.business) : null;
  const branding = await getBrandingSettings(businessId);
  const template = templates.appointmentBooked(appointmentDetail, branding);
  const meta = getMailMeta(branding);
  await sendMail({ to: email, ...template, ...meta, businessId });
};

export const sendAppointmentConfirmedEmail = async (email, appointmentDetail) => {
  const businessId = appointmentDetail.business ? (appointmentDetail.business._id || appointmentDetail.business) : null;
  const branding = await getBrandingSettings(businessId);
  const template = templates.appointmentConfirmed(appointmentDetail, branding);
  const meta = getMailMeta(branding);
  await sendMail({ to: email, ...template, ...meta, businessId });
};

export const sendAppointmentCancelledEmail = async (email, appointmentDetail) => {
  const businessId = appointmentDetail.business ? (appointmentDetail.business._id || appointmentDetail.business) : null;
  const branding = await getBrandingSettings(businessId);
  const template = templates.appointmentCancelled(appointmentDetail, branding);
  const meta = getMailMeta(branding);
  await sendMail({ to: email, ...template, ...meta, businessId });
};

export const sendWorkerPendingApprovalEmail = async (workerEmail, appointmentDetail) => {
  const businessId = appointmentDetail.business ? (appointmentDetail.business._id || appointmentDetail.business) : null;
  const branding = await getBrandingSettings(businessId);
  const template = templates.workerPendingApproval(appointmentDetail, branding);
  const meta = getMailMeta(branding);
  await sendMail({ to: workerEmail, ...template, ...meta, businessId });
};

/**
 * Trusted C2 delivery. The caller must pass the destination persisted by C1;
 * this function has no request object and therefore cannot trust Host/Origin/
 * Referer/X-Forwarded-* headers. Success means the configured transport/provider
 * accepted the message. Sensitive transport suppresses recipient, body, URL,
 * provider errors and preview links from logs.
 */
export const sendGuestAppointmentVerificationEmail = async ({
  destination,
  businessId,
  accessUrl,
}) => {
  const branding = await getBrandingSettings(businessId);
  const template = guestAppointmentVerificationTemplate({
    accessUrl,
    businessName: branding.businessName,
  });
  const meta = getMailMeta(branding);
  const result = await sendSensitiveMail({
    to: destination,
    ...template,
    ...meta,
  });
  return Boolean(result);
};

export { sendMail, sendSensitiveMail } from "./transporter.js";
