import { z } from "zod";
import { isStrictISODate } from "../utils/date.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/u, "ID inválido");
const bearer = z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Bearer inválido");
const empty = z.object({}).strict();
const calendarDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "La fecha debe estar en formato YYYY-MM-DD")
  .refine(isStrictISODate, "La fecha debe ser una fecha Gregoriana válida");
const startTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "Formato de hora inválido (HH:MM)");

const requestEnvelope = (body) => z.object({
  body: body.strict(),
  query: empty,
  params: empty,
}).strict();

const challengeBody = z.object({
  businessId: objectId,
  appointmentId: objectId,
});
const exchangeBody = z.object({
  businessId: objectId,
  appointmentId: objectId,
  verificationId: objectId,
  challengeSecret: bearer,
});
const consumeBody = z.object({
  businessId: objectId,
  appointmentId: objectId,
  bearer,
});
const rescheduleConsumeBody = z.object({
  businessId: objectId,
  appointmentId: objectId,
  bearer,
  date: calendarDate,
  startTime,
});

export const guestAppointmentReadChallengeSchema = requestEnvelope(challengeBody);
export const guestAppointmentReadExchangeSchema = requestEnvelope(exchangeBody);
export const guestAppointmentReadConsumeSchema = requestEnvelope(consumeBody);

export const guestAppointmentCancelChallengeSchema = requestEnvelope(challengeBody);
export const guestAppointmentCancelExchangeSchema = requestEnvelope(exchangeBody);
export const guestAppointmentCancelConsumeSchema = requestEnvelope(consumeBody);

export const guestAppointmentRescheduleChallengeSchema = requestEnvelope(challengeBody);
export const guestAppointmentRescheduleExchangeSchema = requestEnvelope(exchangeBody);
export const guestAppointmentRescheduleConsumeSchema = requestEnvelope(rescheduleConsumeBody);
