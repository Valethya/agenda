import * as userRepository from "../repositories/user.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { getOrInitializeConfig } from "./businessConfig.service.js";
import { createHash } from "../utils/password.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";

export { getGlobalMetrics, getAdvancedAnalytics } from "./analytics.service.js";

export const createBusiness = async (businessData) => {
  const { name, slug, ownerEmail, ownerPassword, ownerFirstName, ownerLastName, ownerPhone } = businessData;
  const normalizedSlug = slug.toLowerCase().trim();

  if (await businessRepository.findOne({ slug: normalizedSlug })) {
    throw new ConflictError("Ya existe un negocio registrado con este slug");
  }
  if (await userRepository.findOne({ email: ownerEmail })) {
    throw new ConflictError("El correo electrónico del administrador ya está registrado");
  }

  const business = await businessRepository.create({ name, slug: normalizedSlug, isActive: true });
  const owner = await userRepository.createUser({
    firstName: ownerFirstName || "Administrador",
    lastName: ownerLastName || "Negocio",
    email: ownerEmail,
    password: await createHash(ownerPassword),
    role: "admin",
    phone: ownerPhone || "",
    business: business._id,
  });

  await membershipRepository.create({
    user: owner._id,
    business: business._id,
    role: "admin",
    isActive: true,
  });

  business.owner = owner._id;
  await businessRepository.save(business);
  await getOrInitializeConfig(business._id);

  return {
    business,
    owner: {
      id: owner._id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
    },
  };
};

export const listBusinesses = async () => await businessRepository.findAll();

export const toggleBusinessStatus = async (id) => {
  const business = await businessRepository.findById(id);
  if (!business) throw new NotFoundError("El negocio especificado no existe");
  business.isActive = !business.isActive;
  await businessRepository.save(business);
  return business;
};

/**
 * Impersonación transitoria: el sujeto debe derivar de una Membership admin
 * activa. Business.owner expresa propiedad, pero no concede autoridad.
 */
export const impersonate = async (businessId) => {
  const business = await businessRepository.findById(businessId);
  if (!business || business.isActive !== true) {
    throw new NotFoundError("El negocio especificado no existe o no está disponible");
  }

  let membership = null;
  if (business.owner) {
    const ownerMembership = await membershipRepository.findActiveByUserAndBusiness(
      business.owner,
      business._id,
    );
    if (ownerMembership?.role === "admin") {
      const owner = await userRepository.findById(business.owner);
      if (owner?.isActive === true) {
        return { user: owner, business, membership: ownerMembership };
      }
    }
  }

  membership = await membershipRepository.findActiveByBusinessAndRole(business._id, "admin");
  if (!membership?.user || membership.user.isActive !== true) {
    throw new NotFoundError("No se encontró ningún administrador activo para este negocio");
  }

  return { user: membership.user, business, membership };
};
