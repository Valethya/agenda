import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/u, "ID inválido");
const bearer = z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Bearer inválido");
const empty = z.object({}).strict();

const requestEnvelope = (body) => z.object({
  body: body.strict(),
  query: empty,
  params: empty,
}).strict();

export const guestAppointmentReadChallengeSchema = requestEnvelope(z.object({
  businessId: objectId,
  appointmentId: objectId,
}));

export const guestAppointmentReadExchangeSchema = requestEnvelope(z.object({
  businessId: objectId,
  appointmentId: objectId,
  verificationId: objectId,
  challengeSecret: bearer,
}));

export const guestAppointmentReadConsumeSchema = requestEnvelope(z.object({
  businessId: objectId,
  appointmentId: objectId,
  bearer,
}));
