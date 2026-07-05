import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    firstName: z
      .string({ required_error: "El nombre es obligatorio" })
      .min(2, "El nombre debe tener al menos 2 caracteres")
      .trim(),
    lastName: z
      .string({ required_error: "El apellido es obligatorio" })
      .min(2, "El apellido debe tener al menos 2 caracteres")
      .trim(),
    email: z
      .string({ required_error: "El correo electrónico es obligatorio" })
      .email("Debe ingresar un formato de correo válido")
      .trim()
      .lowercase(),
    password: z
      .string({ required_error: "La contraseña es obligatoria" })
      .min(6, "La contraseña debe tener al menos 6 caracteres"),
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{1,14}$/, "Formato de teléfono inválido (ej: +56912345678)")
      .optional()
      .or(z.literal("")),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: "El correo electrónico es obligatorio" })
      .email("Debe ingresar un formato de correo válido")
      .trim(),
    password: z
      .string({ required_error: "La contraseña es obligatoria" })
      .min(1, "Debe ingresar la contraseña"),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: "El correo electrónico es obligatorio" })
      .email("Debe ingresar un formato de correo válido")
      .trim(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z
      .string({ required_error: "El token de recuperación es obligatorio" })
      .min(1, "El token no puede estar vacío"),
    newPassword: z
      .string({ required_error: "La nueva contraseña es obligatoria" })
      .min(6, "La nueva contraseña debe tener al menos 6 caracteres"),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z
      .string({ required_error: "La contraseña actual es obligatoria" })
      .min(1, "Debe ingresar la contraseña actual"),
    newPassword: z
      .string({ required_error: "La nueva contraseña es obligatoria" })
      .min(6, "La nueva contraseña debe tener al menos 6 caracteres"),
  }),
});
