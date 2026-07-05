import { z } from "zod";

// Validación de creación de citas
export const createAppointmentSchema = z.object({
  body: z.object({
    worker: z
      .string({ required_error: "El ID del trabajador es obligatorio" })
      .regex(/^[0-9a-fA-F]{24}$/, "ID de trabajador inválido"),
    service: z
      .string({ required_error: "El ID del servicio es obligatorio" })
      .regex(/^[0-9a-fA-F]{24}$/, "ID de servicio inválido"),
    date: z
      .string({ required_error: "La fecha es obligatoria" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe estar en formato YYYY-MM-DD"),
    startTime: z
      .string({ required_error: "La hora de inicio es obligatoria" })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de inicio inválido (HH:MM)"),
    notes: z
      .string()
      .max(500, "Las notas de la cita no pueden superar los 500 caracteres")
      .optional(),
    clientInfo: z
      .object({
        firstName: z.string({ required_error: "El nombre del cliente es obligatorio" }).min(1, "El nombre no puede estar vacío"),
        lastName: z.string({ required_error: "El apellido del cliente es obligatorio" }).min(1, "El apellido no puede estar vacío"),
        email: z.string({ required_error: "El correo es obligatorio" }).email("Formato de correo inválido"),
        phone: z.string({ required_error: "El número de teléfono es obligatorio" }).min(1, "El teléfono no puede estar vacío"),
      })
      .optional(),
    paymentOption: z.string().optional(),
    isSuggestion: z.boolean().optional(),
  }),
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
    date: z
      .string({ required_error: "El parámetro date es obligatorio" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "El formato de fecha debe ser YYYY-MM-DD"),
  }),
});

// Validación de creación de bloqueos administrativos puntuales
export const createBlockSchema = z.object({
  body: z.object({
    workerId: z
      .string({ required_error: "El ID del trabajador es obligatorio" })
      .regex(/^[0-9a-fA-F]{24}$/, "ID de trabajador inválido"),
    date: z
      .string({ required_error: "La fecha del bloqueo es obligatoria" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "El formato de fecha debe ser YYYY-MM-DD"),
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
