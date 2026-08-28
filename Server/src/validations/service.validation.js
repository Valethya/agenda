import { z } from "zod";

const workerIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID de trabajador inválido");
const workersSchema = z
  .array(workerIdSchema)
  .refine(
    (workerIds) => new Set(workerIds.map((workerId) => workerId.toLowerCase())).size === workerIds.length,
    "La lista de profesionales no puede contener duplicados",
  );

const assertDepositDoesNotExceedPrice = (body, ctx) => {
  if (
    body.price !== undefined
    && body.depositAmount !== undefined
    && body.depositAmount > body.price
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["depositAmount"],
      message: "El monto de abono no puede superar el precio del servicio",
    });
  }
};

export const createServiceSchema = z.object({
  body: z.object({
    name: z
      .string({ required_error: "El nombre del servicio es obligatorio" })
      .min(3, "El nombre debe tener al menos 3 caracteres")
      .trim(),
    description: z
      .string()
      .max(500, "La descripción no puede superar los 500 caracteres")
      .optional(),
    duration: z
      .number({ required_error: "La duración es obligatoria" })
      .int("La duración debe ser un número entero de minutos")
      .positive("La duración debe ser mayor que 0"),
    price: z
      .number({ required_error: "El precio es obligatorio" })
      .min(0, "El precio no puede ser negativo"),
    depositAmount: z
      .number()
      .min(0, "El monto de abono no puede ser negativo")
      .default(0),
    workers: workersSchema.default([]),
  }).strict().superRefine(assertDepositDoesNotExceedPrice),
});

export const updateServiceSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(3, "El nombre debe tener al menos 3 caracteres")
      .trim()
      .optional(),
    description: z
      .string()
      .max(500, "La descripción no puede superar los 500 caracteres")
      .optional(),
    duration: z
      .number()
      .int("La duración debe ser un número entero")
      .positive("La duración debe ser mayor que 0")
      .optional(),
    price: z
      .number()
      .min(0, "El precio no puede ser negativo")
      .optional(),
    depositAmount: z
      .number()
      .min(0, "El monto de abono no puede ser negativo")
      .optional(),
    workers: workersSchema.optional(),
    isActive: z.boolean().optional(),
  }).strict().superRefine(assertDepositDoesNotExceedPrice),
});
