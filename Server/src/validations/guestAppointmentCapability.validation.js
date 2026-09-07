import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/u, "ID inválido");
const bearer = z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Bearer inválido");
const empty = z.object({}).strict();

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

export const guestAppointmentReadChallengeSchema = requestEnvelope(challengeBody);
export const guestAppointmentReadExchangeSchema = requestEnvelope(exchangeBody);
export const guestAppointmentReadConsumeSchema = requestEnvelope(consumeBody);

export const guestAppointmentCancelChallengeSchema = requestEnvelope(challengeBody);
export const guestAppointmentCancelExchangeSchema = requestEnvelope(exchangeBody);
export const guestAppointmentCancelConsumeSchema = requestEnvelope(consumeBody);
