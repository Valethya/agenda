import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/u, "onboardingId inválido");
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Challenge no válido");

export const issueTenantOnboardingSchema = z.object({
  body: z.object({
    // La semántica canónica trim+lowercase pertenece al servicio/modelo C1. La
    // validación HTTP sólo comprueba formato después del trim y no rechaza casing.
    email: z
      .string({ required_error: "El correo electrónico es obligatorio" })
      .trim()
      .email("Debe ingresar un formato de correo válido"),
  }).strict(),
}).passthrough();

const existingAccount = z.object({
  mode: z.literal("existing"),
  password: z.string().min(1, "Debe ingresar la contraseña"),
}).strict();

const newAccount = z.object({
  mode: z.literal("new"),
  firstName: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres"),
  lastName: z.string().trim().min(2, "El apellido debe tener al menos 2 caracteres"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
}).strict();

export const bindTenantOnboardingSchema = z.object({
  params: z.object({ onboardingId: objectId }).strict(),
  body: z.object({
    secret,
    account: z.discriminatedUnion("mode", [existingAccount, newAccount]),
  }).strict(),
}).passthrough();
