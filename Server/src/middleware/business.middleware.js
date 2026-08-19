import mongoose from "mongoose";
import * as businessRepository from "../repositories/business.repository.js";
import { frontendUrl } from "../config/env.js";
import { resolveTenantAuthority } from "../services/tenantAuthority.service.js";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../utils/appError.js";

const BUSINESS_NOT_AVAILABLE_MESSAGE = "El negocio especificado no está disponible";
const INTERNAL_ORIGIN_MESSAGE = "Origen no autorizado para la superficie interna";

const trustedInternalOrigin = (() => {
  try {
    return new URL(frontendUrl).origin;
  } catch {
    return null;
  }
})();

const collectIdentifier = (name, values, normalize = (value) => value) => {
  const provided = values.filter((value) => value !== undefined && value !== null && value !== "");

  if (provided.some((value) => typeof value !== "string")) {
    throw new ValidationError(`${name} debe ser un texto válido`);
  }

  const normalized = [...new Set(provided.map((value) => normalize(value)))];
  if (normalized.length > 1) {
    throw new ValidationError(`Se recibieron valores contradictorios para ${name}`);
  }

  return normalized[0] || null;
};

const readExplicitTenantIdentifiers = (req) => ({
  businessId: collectIdentifier("businessId", [
    req.query.businessId,
    req.body?.businessId,
    req.headers["x-business-id"],
  ], (value) => value.trim()),
  slug: collectIdentifier("slug", [
    req.query.slug,
    req.body?.slug,
    req.headers["x-business-slug"],
  ], (value) => value.toLowerCase().trim()),
});

const resolveExplicitBusiness = async (req) => {
  const { businessId, slug } = readExplicitTenantIdentifiers(req);

  if (!businessId && !slug) {
    throw new ValidationError("Debe especificar el negocio mediante businessId o slug");
  }

  if (businessId && !mongoose.isValidObjectId(businessId)) {
    throw new ValidationError("businessId debe ser un ObjectId válido");
  }

  let businessById = null;
  let businessBySlug = null;
  if (businessId) businessById = await businessRepository.findById(businessId);
  if (slug) businessBySlug = await businessRepository.findBySlug(slug);

  if ((businessId && !businessById) || (slug && !businessBySlug)) {
    throw new NotFoundError(BUSINESS_NOT_AVAILABLE_MESSAGE);
  }

  if (businessById && businessBySlug && !businessById._id.equals(businessBySlug._id)) {
    throw new ValidationError("businessId y slug corresponden a negocios diferentes");
  }

  const business = businessById || businessBySlug;
  if (!business?.isActive) {
    throw new NotFoundError(BUSINESS_NOT_AVAILABLE_MESSAGE);
  }

  return business;
};

const assertTrustedInternalOrigin = (req) => {
  const rawOrigin = req.get("origin");
  if (!rawOrigin) return;

  let requestOrigin = null;
  try {
    requestOrigin = new URL(rawOrigin).origin;
  } catch {
    throw new ForbiddenError(INTERNAL_ORIGIN_MESSAGE);
  }

  if (!trustedInternalOrigin || requestOrigin !== trustedInternalOrigin) {
    throw new ForbiddenError(INTERNAL_ORIGIN_MESSAGE);
  }
};

const applyInternalBusinessScope = async (req) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    throw new UnauthorizedError("Debes iniciar sesión para usar la superficie interna");
  }

  // Esta comprobación acota la superficie administrativa del navegador al origen
  // configurado del panel. No sustituye el hardening CSRF general de una fase futura.
  assertTrustedInternalOrigin(req);

  if (!sessionUser.businessId) {
    throw new ForbiddenError("No tienes un negocio activo seleccionado");
  }

  const business = await businessRepository.findById(sessionUser.businessId);
  if (!business) {
    throw new NotFoundError("El negocio asociado a tu sesión no existe");
  }

  if (!business.isActive) {
    throw new ForbiddenError("El negocio seleccionado no está disponible");
  }

  // Toda request tenant-interna revalida autoridad vigente desde persistencia.
  // User.role/User.business y copias de sesión nunca sustituyen Membership activa.
  const tenantAuthority = await resolveTenantAuthority(sessionUser.id, business._id, { business });

  req.business = business;
  req.businessId = business._id;
  req.bookingSurface = "internal";
  req.tenantAuthority = tenantAuthority;
};

export const scopeBusiness = async (req, res, next) => {
  try {
    await applyInternalBusinessScope(req);
    next();
  } catch (error) {
    next(error);
  }
};

// Contrato headless: el tenant se resuelve exclusivamente desde identificadores
// explícitos del request. Una cookie existente no sustituye el Business solicitado
// ni convierte la respuesta en una proyección administrativa.
export const scopePublicBusiness = async (req, res, next) => {
  try {
    const business = await resolveExplicitBusiness(req);
    req.business = business;
    req.businessId = business._id;
    req.bookingSurface = "public";
    req.tenantAuthority = null;
    next();
  } catch (error) {
    next(error);
  }
};

// Compatibilidad defensiva para imports históricos: los paths compartidos dejan de
// aceptar una surface declarada por el cliente. Si algún caller antiguo conserva
// este middleware, sólo obtiene política pública; "x-agenda-surface" no es authority.
export const scopeHeadlessOrSessionBusiness = scopePublicBusiness;
