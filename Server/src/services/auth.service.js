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
import * as userRepository from "../repositories/user.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { isValidPassword, createHash } from "../utils/password.js";
import { ConflictError, UnauthorizedError, NotFoundError, ValidationError } from "../utils/appError.js";
import * as mailer from "./email/emailService.js";
import { googleClientId } from "../config/env.js";

const googleClient = new OAuth2Client(googleClientId);

const membershipPayload = (membership) => ({
  id: membership._id,
  businessId: membership.business?._id,
  businessName: membership.business?.name,
  businessSlug: membership.business?.slug,
  role: membership.role,
});

const activeMembershipsForUser = async (userId) => {
  const memberships = await membershipRepository.findActiveByUser(userId);
  return memberships.filter((membership) => membership.business?.isActive === true);
};

export const register = async (data) => {
  const { firstName, lastName, email, password, role, phone } = data;
  const userExists = await findByEmail(email);
  if (userExists) throw new ConflictError("El usuario ya existe");

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
  if (!user || user.isActive !== true) throw new UnauthorizedError("Credenciales inválidas");

  const validPassword = await isValidPassword(password, user.password);
  if (!validPassword) throw new UnauthorizedError("Credenciales inválidas");

  const memberships = await activeMembershipsForUser(user._id);
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: Array.isArray(user.email) ? user.email[0] : user.email,
    role: user.role,
    memberships: memberships.map(membershipPayload),
  };
};

export const loginWithGoogle = async (idToken) => {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: googleClientId });
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
  if (user.isActive !== true) throw new UnauthorizedError("Cuenta no disponible");

  const memberships = await activeMembershipsForUser(user._id);
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: Array.isArray(user.email) ? user.email[0] : user.email,
    role: user.role,
    memberships: memberships.map(membershipPayload),
  };
};

export const updatePassword = async (userId, currentPassword, newPassword) => {
  const user = await findByIdWithPassword(userId);
  if (!user) throw new NotFoundError("Usuario no encontrado");
  const valid = await isValidPassword(currentPassword, user.password);
  if (!valid) throw new UnauthorizedError("La contraseña actual es incorrecta");
  await updateUser(userId, { password: await createHash(newPassword) });
};

export const sendResetPasswordEmail = async (email) => {
  const user = await findByEmail(email);
  if (!user) return;
  const resetToken = crypto.randomBytes(20).toString("hex");
  await updateUser(user._id, {
    resetPasswordToken: resetToken,
    resetPasswordExpires: Date.now() + 3600000,
  });
  await mailer.sendResetPasswordEmail(email, resetToken);
};

export const resetPassword = async (token, newPassword) => {
  const user = await findByResetToken(token);
  if (!user) throw new ValidationError("El enlace de recuperación es inválido o ha expirado");
  await updateUser(user._id, {
    password: await createHash(newPassword),
    resetPasswordToken: null,
    resetPasswordExpires: null,
  });
};

export const getOrCreateGuestUser = async (clientInfo) => {
  const { email, firstName, lastName, phone } = clientInfo;
  const lowercaseEmail = email.toLowerCase().trim();
  const trimmedPhone = phone ? phone.trim() : "";
  let user = await findByEmail(lowercaseEmail);
  if (!user && trimmedPhone) user = await findByPhone(trimmedPhone);

  if (user) {
    let hasChanges = false;
    const updateData = {};
    if (!user.email.includes(lowercaseEmail)) {
      user.email.push(lowercaseEmail);
      updateData.email = user.email;
      hasChanges = true;
    }
    if (trimmedPhone && !user.phone.includes(trimmedPhone)) {
      user.phone.push(trimmedPhone);
      updateData.phone = user.phone;
      hasChanges = true;
    }
    const trimmedFirstName = firstName.trim();
    if (!user.firstName || user.firstName.trim() === "") {
      updateData.firstName = trimmedFirstName;
      user.firstName = trimmedFirstName;
      hasChanges = true;
    }
    const trimmedLastName = lastName.trim();
    if (!user.lastName || user.lastName.trim() === "") {
      updateData.lastName = trimmedLastName;
      user.lastName = trimmedLastName;
      hasChanges = true;
    }
    if (hasChanges) await updateUser(user._id, updateData);
  } else {
    user = await createUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: [lowercaseEmail],
      password: await createHash(crypto.randomBytes(16).toString("hex")),
      phone: trimmedPhone ? [trimmedPhone] : [],
      role: "user",
    });
  }
  return user;
};

/**
 * Construye contexto inicial. Las copias de role/business en sesión son sólo
 * contexto de presentación; toda autorización tenant se revalida en runtime.
 */
export const resolveSessionFromUser = (user) => {
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

  return {
    type: "needs_selection",
    tempUser: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      memberships: user.memberships,
    },
    memberships: user.memberships,
  };
};

export const selectMembership = async (userId, membershipId) => {
  const [user, membership] = await Promise.all([
    userRepository.findById(userId),
    membershipRepository.findActiveByIdAndUser(membershipId, userId),
  ]);

  if (!user || user.isActive !== true || user.role === "superadmin") {
    throw new UnauthorizedError("La sesión temporal ya no es válida");
  }
  if (!membership || !membership.business || membership.business.isActive !== true) {
    throw new UnauthorizedError("La membresía seleccionada ya no está activa");
  }

  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: Array.isArray(user.email) ? user.email[0] : user.email,
    role: membership.role,
    businessId: membership.business._id,
    businessSlug: membership.business.slug,
  };
};

/**
 * Cambiar negocio sólo cambia contexto. Para usuarios tenant exige Membership
 * activa; para superadmin sólo valida el Business y conserva su rol global.
 */
export const switchBusiness = async (userId, businessId) => {
  const user = await userRepository.findById(userId);
  if (!user || user.isActive !== true) throw new UnauthorizedError("Sesión no válida");

  if (user.role === "superadmin") {
    const targetBusiness = await businessRepository.findById(businessId);
    if (!targetBusiness || targetBusiness.isActive !== true) {
      throw new ValidationError("El negocio especificado no está disponible");
    }
    return {
      businessId: targetBusiness._id,
      businessSlug: targetBusiness.slug,
      globalRole: "superadmin",
    };
  }

  const membership = await membershipRepository.findActiveByUserAndBusiness(userId, businessId);
  if (!membership || !membership.business || membership.business.isActive !== true) {
    throw new UnauthorizedError("No tienes acceso a este negocio");
  }

  return {
    businessId: membership.business._id,
    businessSlug: membership.business.slug,
    tenantRole: membership.role,
  };
};

/**
 * Revalida identidad y contexto tenant para /me. Una Membership revocada no
 * mantiene una sesión tenant válida. Los superadmin pueden conservar contexto
 * sin adquirir por ello un rol tenant.
 */
export const getCurrentUser = async (sessionUser) => {
  const user = await userRepository.findById(sessionUser.id);
  if (!user || user.isActive !== true) return { type: "invalid_identity" };

  const memberships = await activeMembershipsForUser(user._id);
  const membershipsPayload = memberships.map(membershipPayload);
  const isGlobalSuperadmin = user.role === "superadmin";

  if (sessionUser.businessId) {
    const business = await businessRepository.findById(sessionUser.businessId);
    if (!business || business.isActive !== true) {
      if (!isGlobalSuperadmin) return { type: "invalid_tenant" };
      return {
        type: "valid",
        payload: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: Array.isArray(user.email) ? user.email[0] : user.email,
          role: "superadmin",
          memberships: membershipsPayload,
        },
      };
    }

    const activeMembership = memberships.find(
      (membership) => membership.business?._id?.toString() === business._id.toString(),
    );

    if (!isGlobalSuperadmin && !activeMembership) {
      return { type: "invalid_tenant" };
    }

    return {
      type: "valid",
      payload: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: Array.isArray(user.email) ? user.email[0] : user.email,
        role: isGlobalSuperadmin ? "superadmin" : activeMembership.role,
        businessId: business._id,
        businessSlug: business.slug,
        tenantRole: activeMembership?.role || null,
        memberships: membershipsPayload,
      },
    };
  }

  if (!isGlobalSuperadmin) return { type: "invalid_tenant" };

  return {
    type: "valid",
    payload: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: Array.isArray(user.email) ? user.email[0] : user.email,
      role: "superadmin",
      memberships: membershipsPayload,
    },
  };
};
