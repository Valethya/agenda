import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import {
  findByEmail,
  createUser,
  findByEmailPassword,
  findByIdWithPassword,
  updateUser,
  findByResetToken,
  findByPhone,
} from "../repositories/user.repository.js";
import { isValidPassword, createHash } from "../utils/password.js";
import { ConflictError, UnauthorizedError, NotFoundError, ValidationError } from "../utils/appError.js";
import * as mailer from "./email/emailService.js";
import * as membershipRepository from "../repositories/membership.repository.js";

import { googleClientId } from "../config/env.js";

const googleClient = new OAuth2Client(googleClientId);

export const register = async (data) => {
  const { firstName, lastName, email, password, role, phone } = data;

  const userExists = await findByEmail(email);

  if (userExists) {
    throw new ConflictError("El usuario ya existe");
  }
  const hashedPassword = await createHash(password);

  const newUser = await createUser({
    firstName,
    lastName,
    email: [email],
    password: hashedPassword,
    phone: phone ? [phone] : [],
    role: role || "user",
  });

  return {
    id: newUser._id,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    email: Array.isArray(newUser.email) ? newUser.email[0] : newUser.email,
    role: newUser.role,
  };
};

export const login = async (email, password) => {
  const user = await findByEmailPassword(email);

  if (!user) {
    throw new UnauthorizedError("Credenciales inválidas");
  }

  const validPassword = await isValidPassword(password, user.password);

  if (!validPassword) {
    throw new UnauthorizedError("Credenciales inválidas");
  }

  // Buscar membresías asociadas al usuario
  const memberships = await membershipRepository.findActiveByUser(user._id);

  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: Array.isArray(user.email) ? user.email[0] : user.email,
    role: user.role,
    memberships: memberships.map((m) => ({
      id: m._id,
      businessId: m.business?._id,
      businessName: m.business?.name,
      businessSlug: m.business?.slug,
      role: m.role,
    })),
  };
};

export const loginWithGoogle = async (idToken) => {
  const ticket = await googleClient.verifyIdToken({
    idToken: idToken,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();
  const { email, given_name, family_name, picture } = payload;
  let user = await findByEmail(email);
  if (!user) {
    user = await createUser({
      firstName: given_name,
      lastName: family_name || "",
      email: [email],
      password: "OAUTH_USER_NO_PASSWORD",
      role: "user",
      avatar: picture || "",
    });
  }

  const memberships = await membershipRepository.findActiveByUser(user._id);

  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: Array.isArray(user.email) ? user.email[0] : user.email,
    role: user.role,
    memberships: memberships.map((m) => ({
      id: m._id,
      businessId: m.business?._id,
      businessName: m.business?.name,
      businessSlug: m.business?.slug,
      role: m.role,
    })),
  };
};

export const updatePassword = async (userId, currentPassword, newPassword) => {
  const user = await findByIdWithPassword(userId);
  if (!user) {
    throw new NotFoundError("Usuario no encontrado");
  }

  const valid = await isValidPassword(currentPassword, user.password);
  if (!valid) {
    throw new UnauthorizedError("La contraseña actual es incorrecta");
  }

  const newHashed = await createHash(newPassword);
  await updateUser(userId, { password: newHashed });
};

export const sendResetPasswordEmail = async (email) => {
  const user = await findByEmail(email);
  if (!user) {
    // Retorna silenciosamente sin revelar si el correo existe o no en la base de datos (seguridad)
    return;
  }

  const resetToken = crypto.randomBytes(20).toString("hex");
  const expireDate = Date.now() + 3600000; // 1 hora de validez

  await updateUser(user._id, {
    resetPasswordToken: resetToken,
    resetPasswordExpires: expireDate,
  });

  // Enviar correo real de recuperación
  await mailer.sendResetPasswordEmail(email, resetToken);
};

export const resetPassword = async (token, newPassword) => {
  const user = await findByResetToken(token);
  if (!user) {
    throw new ValidationError("El enlace de recuperación es inválido o ha expirado");
  }
  const newHashed = await createHash(newPassword);

  await updateUser(user._id, {
    password: newHashed,
    resetPasswordToken: null,
    resetPasswordExpires: null,
  });
};

export const getOrCreateGuestUser = async (clientInfo) => {
  const { email, firstName, lastName, phone } = clientInfo;
  const lowercaseEmail = email.toLowerCase().trim();
  const trimmedPhone = phone ? phone.trim() : "";

  // 1. Detección de duplicados: buscar primero por email
  let user = await findByEmail(lowercaseEmail);

  // 2. Si no se encuentra por email, buscar por teléfono
  if (!user && trimmedPhone) {
    user = await findByPhone(trimmedPhone);
  }

  if (user) {
    // 3. Identificación Progresiva: actualizar progresivamente campos vacíos o nuevos
    let hasChanges = false;
    const updateData = {};

    // Si el email provisto no está registrado, se añade al arreglo de correos del usuario
    if (!user.email.includes(lowercaseEmail)) {
      user.email.push(lowercaseEmail);
      updateData.email = user.email;
      hasChanges = true;
    }

    // Si el teléfono provisto no está registrado, se añade al arreglo de teléfonos del usuario
    if (trimmedPhone && !user.phone.includes(trimmedPhone)) {
      user.phone.push(trimmedPhone);
      updateData.phone = user.phone;
      hasChanges = true;
    }

    // Completar nombre solo si está vacío o no asignado
    const trimmedFirstName = firstName.trim();
    if (!user.firstName || user.firstName.trim() === "") {
      updateData.firstName = trimmedFirstName;
      user.firstName = trimmedFirstName;
      hasChanges = true;
    }

    // Completar apellido solo si está vacío o no asignado
    const trimmedLastName = lastName.trim();
    if (!user.lastName || user.lastName.trim() === "") {
      updateData.lastName = trimmedLastName;
      user.lastName = trimmedLastName;
      hasChanges = true;
    }

    if (hasChanges) {
      await updateUser(user._id, updateData);
    }
  } else {
    // 4. Crear nuevo usuario cliente si no coincide ninguno
    const randomPassword = crypto.randomBytes(16).toString("hex");
    const hashedPassword = await createHash(randomPassword);

    user = await createUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: [lowercaseEmail],
      password: hashedPassword,
      phone: trimmedPhone ? [trimmedPhone] : [],
      role: "user",
    });
  }

  return user;
};

// --- Funciones de sesión y negocio (movidas desde auth.controller.js) ---

import * as userRepository from "../repositories/user.repository.js";
import * as businessRepository from "../repositories/business.repository.js";

/**
 * Resuelve los datos de sesión a partir de un usuario autenticado.
 * Centraliza la lógica duplicada entre login y googleLogin.
 *
 * Retorna un objeto con:
 * - type: "superadmin" | "single" | "needs_selection"
 * - sessionUser: datos para req.session.user (si type !== "needs_selection")
 * - tempUser: datos para req.session.tempUser (si type === "needs_selection")
 * - memberships: lista de membresías (si type === "needs_selection")
 */
export const resolveSessionFromUser = (user) => {
  // Superadmin: no necesita membresías
  if (user.role === "superadmin") {
    return {
      type: "superadmin",
      sessionUser: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: "superadmin",
      },
    };
  }

  if (!user.memberships || user.memberships.length === 0) {
    throw new UnauthorizedError("Tu cuenta no tiene ningún negocio asociado");
  }

  // Un solo negocio: sesión directa
  if (user.memberships.length === 1) {
    const active = user.memberships[0];
    return {
      type: "single",
      sessionUser: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: active.role,
        businessId: active.businessId,
        businessSlug: active.businessSlug,
      },
    };
  }

  // Múltiples negocios: requiere selección
  return {
    type: "needs_selection",
    tempUser: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      memberships: user.memberships,
    },
    memberships: user.memberships,
  };
};

/**
 * Resuelve el cambio de negocio para un usuario autenticado.
 * Retorna los campos a actualizar en req.session.user.
 */
export const switchBusiness = async (userId, userRole, businessId) => {
  // Superadmin: acceso directo a cualquier negocio
  if (userRole === "superadmin") {
    const targetBusiness = await businessRepository.findById(businessId);
    if (!targetBusiness) {
      throw new ValidationError("El negocio especificado no existe");
    }
    return {
      businessId: targetBusiness._id,
      businessSlug: targetBusiness.slug,
    };
  }

  // Usuario normal: verificar membresía activa
  const membership = await membershipRepository.findActiveByUserAndBusiness(userId, businessId);
  if (!membership) {
    throw new UnauthorizedError("No tienes acceso a este negocio");
  }

  return {
    businessId: membership.business._id,
    businessSlug: membership.business.slug,
    role: membership.role,
  };
};

/**
 * Obtiene el payload del usuario actual con sus membresías.
 * Retorna null si el usuario ya no existe en la BD (sesión huérfana).
 */
export const getCurrentUser = async (sessionUser) => {
  // Verificar que el usuario exista en la base de datos para prevenir sesiones huérfanas
  const userExists = await userRepository.findById(sessionUser.id);
  if (!userExists) {
    return null;
  }

  // Buscar membresías para inyectarlas al frontend (para el switch de negocio)
  let membershipsPayload = [];
  if (sessionUser.role !== "superadmin") {
    const memberships = await membershipRepository.findActiveByUser(sessionUser.id);
    membershipsPayload = memberships.map((m) => ({
      id: m._id,
      businessId: m.business?._id,
      businessName: m.business?.name,
      businessSlug: m.business?.slug,
      role: m.role,
    }));
  }

  return {
    ...sessionUser,
    memberships: membershipsPayload,
  };
};
