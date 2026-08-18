import { z } from "zod";
import { isStrictISODate } from "../utils/date.js";

const isoDateSchema = (requiredMessage, formatMessage) => z
  .string({ required_error: requiredMessage })
  .regex(/^\d{4}-\d{2}-\d{2}$/, formatMessage)
  .refine(isStrictISODate, "La fecha debe ser una fecha Gregoriana válida");

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID inválido");
const guestNameSchema = (label) => z
  .string({ required_error: `${label} del cliente es obligatorio` })
  .trim()
  .min(1, `${label} no puede estar vacío`)
  .max(120, `${label} no puede superar los 120 caracteres`);

const normalizeEmailDomain = (value) => {
  const separator = value.lastIndexOf("@");
  if (separator < 1) return value;
  return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
};

const guestEmailSchema = z
  .string({ required_error: "El correo es obligatorio" })
  .trim()
  .max(320, "El correo no puede superar los 320 caracteres")
  .email("Formato de correo inválido")
  .transform(normalizeEmailDomain);

// Contrato operacional mínimo: E.164-like, sin extensiones ni texto libre.
const guestPhoneSchema = z
  .string({ required_error: "El número de teléfono es obligatorio" })
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, "Formato de teléfono inválido");

const guestClientInfoSchema = z.object({
  firstName: guestNameSchema("El nombre"),
  lastName: guestNameSchema("El apellido"),
  email: guestEmailSchema,
  phone: guestPhoneSchema,
}).strict();

const bookingCoreShape = {
  worker: z
    .string({ required_error: "El ID del trabajador es obligatorio" })
    .regex(/^[0-9a-fA-F]{24}$/, "ID de trabajador inválido"),
  service: z
    .string({ required_error: "El ID del servicio es obligatorio" })
    .regex(/^[0-9a-fA-F]{24}$/, "ID de servicio inválido"),
  date: isoDateSchema("La fecha es obligatoria", "La fecha debe estar en formato YYYY-MM-DD"),
  startTime: z
    .string({ required_error: "La hora de inicio es obligatoria" })
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de inicio inválido (HH:MM)"),
  notes: z
    .string()
    .trim()
    .max(500, "Las notas de la cita no pueden superar los 500 caracteres")
    .optional(),
};

// Flujo interno legacy protegido por sesión/Membership. Sus knobs operacionales se
// mantienen aquí únicamente para callers internos existentes.
export const createAppointmentSchema = z.object({
  body: z.object({
    ...bookingCoreShape,
    clientInfo: guestClientInfoSchema.optional(),
    paymentOption: z.string().optional(),
    isSuggestion: z.boolean().optional(),
    businessId: objectIdSchema.optional(),
    slug: z.string().trim().min(1).optional(),
  }),
});

// Frontera headless pública: sólo campos contractuales. .strict() garantiza que
// isSuggestion/paymentOption u otros controles legacy fallen con 400 antes del service layer.
export const publicCreateAppointmentSchema = z.object({
  body: z.object({
    ...bookingCoreShape,
    clientInfo: guestClientInfoSchema,
    businessId: objectIdSchema.optional(),
    slug: z.string().trim().min(1).optional(),
  }).strict(),
});

// Validación de consulta de disponibilidad de franjas horarias
export const availabilityQuerySchema = z.object({
  query: z.object({
    workerId: z
      .string({ required_error: "El parámetro workerId es obligatorio" })
      .regex(/^[0-9a-fA-F]{24}$/, "ID de trabajador inválido"),
    serviceId: z
      .string({ required_error: "El parámetro serviceId es obligatorio" })
      .regex(/^[0-9a-fA-F]{24}$/, "ID de servicio inválido"),
    date: isoDateSchema("El parámetro date es obligatorio", "El formato de fecha debe ser YYYY-MM-DD"),
  }),
});

// Validación de creación de bloqueos administrativos puntuales
export const createBlockSchema = z.object({
  body: z.object({
    workerId: z
      .string({ required_error: "El ID del trabajador es obligatorio" })
      .regex(/^[0-9a-fA-F]{24}$/, "ID de trabajador inválido"),
    date: isoDateSchema("La fecha del bloqueo es obligatoria", "El formato de fecha debe ser YYYY-MM-DD"),
    startTime: z
      .string({ required_error: "La hora de inicio es obligatoria" })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:MM)"),
    endTime: z
      .string({ required_error: "La hora de finalización es obligatoria" })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:MM)"),
    reason: z
      .string()
      .max(200, "El motivo del bloqueo no puede superar los 200 caracteres")
      .optional(),
  }),
});
