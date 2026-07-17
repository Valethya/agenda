/**
 * Servicio de administración de negocios (superadmin).
 * Gestión de negocios, creación, activación/desactivación e impersonación.
 * Las funciones de analytics fueron extraídas a analytics.service.js.
 */
import * as userRepository from "../repositories/user.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { getOrInitializeConfig } from "./businessConfig.service.js";
import { createHash } from "../utils/password.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";

// Re-exportar analytics para mantener compatibilidad con los consumers existentes
export { getGlobalMetrics, getAdvancedAnalytics } from "./analytics.service.js";

// 1. Crear un negocio (con su respectiva cuenta de dueño Admin y BusinessConfig semilla)
export const createBusiness = async (businessData) => {
  const { name, slug, ownerEmail, ownerPassword, ownerFirstName, ownerLastName, ownerPhone } = businessData;

  const normalizedSlug = slug.toLowerCase().trim();

  const existingBusiness = await businessRepository.findOne({ slug: normalizedSlug });
  if (existingBusiness) {
    throw new ConflictError("Ya existe un negocio registrado con este slug");
  }

  const existingUser = await userRepository.findOne({ email: ownerEmail });
  if (existingUser) {
    throw new ConflictError("El correo electrónico del administrador ya está registrado");
  }

  // A. Crear el negocio
  const business = await businessRepository.create({
    name,
    slug: normalizedSlug,
    isActive: true,
  });

  // B. Encriptar contraseña y crear usuario Admin
  const hashedPassword = await createHash(ownerPassword);
  const owner = await userRepository.createUser({
    firstName: ownerFirstName || "Administrador",
    lastName: ownerLastName || "Negocio",
    email: ownerEmail,
    password: hashedPassword,
    role: "admin",
    phone: ownerPhone || "",
    business: business._id,
  });

  // Crear membresía de administrador para habilitar el multi-workspace
  await membershipRepository.create({
    user: owner._id,
    business: business._id,
    role: "admin",
    isActive: true,
  });

  // C. Vincular dueño en el negocio
  business.owner = owner._id;
  await businessRepository.save(business);

  // D. Inicializar BusinessConfig semilla para el negocio
  await getOrInitializeConfig(business._id);

  return {
    business,
    owner: {
      id: owner._id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
    }
  };
};

// 2. Listar todos los negocios
export const listBusinesses = async () => {
  return await businessRepository.findAll();
};

// 3. Activar/Desactivar un negocio
export const toggleBusinessStatus = async (id) => {
  const business = await businessRepository.findById(id);
  if (!business) {
    throw new NotFoundError("El negocio especificado no existe");
  }

  business.isActive = !business.isActive;
  await businessRepository.save(business);

  return business;
};

// 4. Obtener dueño o administrador de un negocio para impersonar
export const impersonate = async (businessId) => {
  const business = await businessRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError("El negocio especificado no existe");
  }

  const owner = await userRepository.findById(business.owner);
  if (!owner) {
    const anyAdmin = await userRepository.findOne({ business: businessId, role: "admin" });
    if (!anyAdmin) {
      throw new NotFoundError("No se encontró ningún administrador para este negocio");
    }
    return { user: anyAdmin, business };
  }

  return { user: owner, business };
};
