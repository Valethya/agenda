import * as userRepository from "../repositories/user.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { ForbiddenError } from "../utils/appError.js";

export const TENANT_ROLES = Object.freeze(["admin", "worker"]);

const isTenantRole = (role) => TENANT_ROLES.includes(role);

/**
 * Resuelve la autoridad tenant vigente desde persistencia.
 *
 * `User.role`, `User.business` y cualquier copia de rol en sesión quedan fuera
 * de esta decisión. La sesión sólo aporta userId/businessId como contexto.
 *
 * Retorna null cuando el par usuario-negocio no posee autoridad tenant activa.
 */
export const findTenantAuthority = async (userId, businessId, options = {}) => {
  if (!userId || !businessId) return null;

  const preloadedBusiness = options.business || null;
  const [user, membership] = await Promise.all([
    options.user ? Promise.resolve(options.user) : userRepository.findById(userId),
    membershipRepository.findActiveByUserAndBusiness(userId, businessId),
  ]);

  if (!user || user.isActive !== true || !membership || !isTenantRole(membership.role)) {
    return null;
  }

  const business = preloadedBusiness || membership.business;
  if (!business || business.isActive !== true) {
    return null;
  }

  return {
    user,
    business,
    membership,
    userId: user._id,
    businessId: business._id,
    membershipId: membership._id,
    role: membership.role,
  };
};

export const resolveTenantAuthority = async (userId, businessId, options = {}) => {
  const authority = await findTenantAuthority(userId, businessId, options);
  if (!authority) {
    throw new ForbiddenError("No tienes una membresía activa con permisos para este negocio");
  }
  return authority;
};

export const hasTenantRole = (authority, ...roles) =>
  Boolean(authority && roles.includes(authority.role));
