import mongoose from "mongoose";
import * as businessRepository from "../repositories/business.repository.js";
import { findTenantAuthority } from "../services/tenantAuthority.service.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";

const BUSINESS_NOT_AVAILABLE_MESSAGE = "El negocio especificado no está disponible";

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

export const scopeBusiness = async (req, res, next) => {
  try {
    const sessionUser = req.session?.user;
    let business = null;

    // Un negocio almacenado en sesión representa sólo contexto seleccionado.
    // No se interpreta el rol copiado en sesión como prueba de autoridad.
    if (sessionUser?.businessId) {
      business = await businessRepository.findById(sessionUser.businessId);
      if (!business) {
        throw new NotFoundError("El negocio asociado a tu sesión no existe");
      }

      if (!business.isActive) {
        return res.status(403).json({
          status: "fail",
          message: "El negocio seleccionado no está disponible",
        });
      }
    } else {
      // Ruta pública o sesión sin tenant seleccionado: exige contexto explícito.
      const businessId = collectIdentifier("businessId", [
        req.query.businessId,
        req.body?.businessId,
        req.headers["x-business-id"],
      ], (value) => value.trim());
      const slug = collectIdentifier("slug", [
        req.query.slug,
        req.body?.slug,
        req.headers["x-business-slug"],
      ], (value) => value.toLowerCase().trim());

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

      business = businessById || businessBySlug;
      if (!business.isActive) {
        throw new NotFoundError(BUSINESS_NOT_AVAILABLE_MESSAGE);
      }
    }

    req.business = business;
    req.businessId = business._id;

    // Resolver de forma oportunista la autoridad vigente. Las rutas públicas
    // pueden continuar sin Membership; las políticas protegidas exigirán
    // req.tenantAuthority explícitamente.
    req.tenantAuthority = sessionUser?.id
      ? await findTenantAuthority(sessionUser.id, business._id, { business })
      : null;

    next();
  } catch (error) {
    next(error);
  }
};
