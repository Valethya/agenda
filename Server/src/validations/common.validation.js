import { z } from "zod";

// --- Helpers reutilizables ---
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID inválido (debe ser un ObjectId de MongoDB)");
const timeHHMM = z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (use HH:MM)");

// --- Params comunes ---
export const objectIdParamSchema = z.object({
  params: z.object({
    id: objectId,
  }),
});

// Schema para rutas con :workerId en params
export const workerIdParamSchema = z.object({
  params: z.object({
    workerId: objectId,
  }),
});

// --- Payment ---
export const initiatePaymentSchema = z.object({
  body: z.object({
    appointmentId: objectId.describe("ID de la cita a pagar"),
    paymentType: z.enum(["deposit", "full"], {
      errorMap: () => ({ message: "El tipo de pago debe ser 'deposit' o 'full'" }),
    }).optional().default("deposit"),
  }),
});

// Callback de Webpay: tolerante porque Transbank controla el payload.
// Flujo normal (pago completado): Transbank envía token_ws
// Flujo abortado/cancelado: Transbank envía TBK_TOKEN + TBK_ORDEN_COMPRA + TBK_ID_SESION (sin token_ws)
// Flujo timeout (usuario no completó): puede llegar sin ningún token
// Validación mínima: al menos uno de los tokens debe estar presente.
export const webpayReturnSchema = z.object({
  body: z.object({
    token_ws: z.string().optional(),
    TBK_TOKEN: z.string().optional(),
    TBK_ORDEN_COMPRA: z.string().optional(),
    TBK_ID_SESION: z.string().optional(),
  }).optional().default({}),
  query: z.object({
    token_ws: z.string().optional(),
    TBK_TOKEN: z.string().optional(),
    slug: z.string().optional(),
  }).optional().default({}),
}).refine(
  (data) => {
    const hasToken = data.body?.token_ws || data.query?.token_ws;
    const hasTbk = data.body?.TBK_TOKEN || data.query?.TBK_TOKEN;
    return hasToken || hasTbk;
  },
  { message: "Se requiere al menos token_ws o TBK_TOKEN en body o query" }
);

// --- Superadmin ---
export const createBusinessSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "El nombre del negocio es obligatorio" })
      .min(2, "El nombre debe tener al menos 2 caracteres")
      .max(100, "El nombre no debe exceder 100 caracteres"),
    slug: z.string({ required_error: "El slug es obligatorio" })
      .min(2, "El slug debe tener al menos 2 caracteres")
      .max(50, "El slug no debe exceder 50 caracteres")
      .regex(/^[a-z0-9-]+$/, "El slug solo puede contener letras minúsculas, números y guiones"),
    ownerEmail: z.string({ required_error: "El correo del administrador es obligatorio" })
      .email("Formato de correo inválido"),
    ownerPassword: z.string({ required_error: "La contraseña del administrador es obligatoria" })
      .min(6, "La contraseña debe tener al menos 6 caracteres"),
    ownerFirstName: z.string().optional(),
    ownerLastName: z.string().optional(),
    ownerPhone: z.string().optional(),
  }),
});

// --- User / Workers ---
export const createWorkerSchema = z.object({
  body: z.object({
    firstName: z.string({ required_error: "El nombre es obligatorio" })
      .min(1, "El nombre no puede estar vacío"),
    lastName: z.string({ required_error: "El apellido es obligatorio" })
      .min(1, "El apellido no puede estar vacío"),
    email: z.string({ required_error: "El correo es obligatorio" })
      .email("Formato de correo inválido"),
    password: z.string({ required_error: "La contraseña es obligatoria" })
      .min(6, "La contraseña debe tener al menos 6 caracteres"),
    phone: z.string().optional(),
  }),
});

// --- Auth extras ---
// Verificado: el controller (auth.controller.js:81) desestructura { idToken } de req.body.
// El frontend no tiene componente de Google Login aún; la ruta existe solo en el backend.
export const googleLoginSchema = z.object({
  body: z.object({
    idToken: z.string({ required_error: "El token de Google es obligatorio" })
      .min(1, "El token no puede estar vacío"),
  }),
});

export const selectMembershipSchema = z.object({
  body: z.object({
    membershipId: objectId.describe("ID de la membresía a seleccionar"),
  }),
});

export const switchBusinessSchema = z.object({
  body: z.object({
    businessId: objectId.describe("ID del negocio al que cambiar"),
  }),
});

// --- Availability: Shifts ---
// Verificado: availability.controller.js:54 desestructura { workerId, dayOfWeek, isOpen, startTime, endTime, breaks }
export const saveShiftSchema = z.object({
  body: z.object({
    workerId: objectId.describe("ID del trabajador"),
    dayOfWeek: z.number({ required_error: "El día de la semana es obligatorio" })
      .int()
      .min(0, "El día debe ser entre 0 (Domingo) y 6 (Sábado)")
      .max(6, "El día debe ser entre 0 (Domingo) y 6 (Sábado)"),
    isOpen: z.boolean().optional(),
    startTime: timeHHMM.optional(),
    endTime: timeHHMM.optional(),
    breaks: z.array(z.object({
      startTime: timeHHMM,
      endTime: timeHHMM,
    })).optional(),
  }),
});

// --- BusinessConfig (PUT /business-settings) ---
// Basado en el modelo Mongoose BusinessConfig. Usa strict() para rechazar propiedades desconocidas.
// Todos los campos son opcionales porque es una actualización parcial.
const workingHourEntry = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean().optional(),
  startTime: timeHHMM.optional(),
  endTime: timeHHMM.optional(),
  breaks: z.array(z.object({
    startTime: timeHHMM,
    endTime: timeHHMM,
  })).optional(),
}).strict();

export const updateBusinessConfigSchema = z.object({
  body: z.object({
    businessName: z.string()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no debe exceder 100 caracteres")
      .optional(),
    workingHours: z.array(workingHourEntry)
      .max(7, "No puede haber más de 7 entradas de horario")
      .optional(),
    appointmentSettings: z.object({
      slotDuration: z.number().int().min(5).max(480).optional(),
      bufferTime: z.number().int().min(0).max(120).optional(),
      minAdvanceHours: z.number().int().min(0).max(168).optional(),
      maxAdvanceDays: z.number().int().min(1).max(365).optional(),
      autoConfirmLocalBookings: z.boolean().optional(),
    }).strict().optional(),
    cancellationSettings: z.object({
      allowCancellation: z.boolean().optional(),
      limitHours: z.number().int().min(0).max(168).optional(),
    }).strict().optional(),
    paymentSettings: z.object({
      requireDeposit: z.boolean().optional(),
      depositType: z.enum(["percentage", "fixed"]).optional(),
      depositValue: z.number().min(0).max(100000).optional(),
    }).strict().optional(),
    emailSettings: z.object({
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color debe ser hexadecimal (#RRGGBB)").optional(),
      logoUrl: z.string().url("URL de logo inválida").or(z.literal("")).optional(),
      customFooter: z.string().max(500, "El footer no debe exceder 500 caracteres").optional(),
    }).strict().optional(),
  }).strict(),
});
