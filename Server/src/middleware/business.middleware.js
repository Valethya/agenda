import mongoose from "mongoose";
import * as businessRepository from "../repositories/business.repository.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../utils/appError.js";

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
    // 1. Si el usuario está logueado como Admin o Trabajador (excluyendo Superadmin que es global)
    if (
      req.session &&
      req.session.user &&
      (req.session.user.role === "admin" || req.session.user.role === "worker") &&
      req.session.user.role !== "superadmin"
    ) {
      const userBusinessId = req.session.user.businessId;
      if (!userBusinessId) {
        throw new UnauthorizedError("El usuario administrador o trabajador no posee un negocio asociado");
      }

      const business = await businessRepository.findById(userBusinessId);
      if (!business) {
        throw new NotFoundError("El negocio asociado a tu cuenta no existe");
      }

      if (!business.isActive) {
        return res.status(403).json({
          status: "fail",
          message: `El negocio '${business.name}' se encuentra inactivo/suspendido.`,
        });
      }

      req.business = business;
      req.businessId = business._id;
      return next();
    }

    // 2. Ruta pública o cliente general (pueden agendar en distintos negocios)
    // Buscamos businessId o slug en query params, body o headers
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
    if (businessId) {
      businessById = await businessRepository.findById(businessId);
    }
    if (slug) {
      businessBySlug = await businessRepository.findBySlug(slug);
    }

    if ((businessId && !businessById) || (slug && !businessBySlug)) {
      throw new NotFoundError(BUSINESS_NOT_AVAILABLE_MESSAGE);
    }

    if (businessById && businessBySlug && !businessById._id.equals(businessBySlug._id)) {
      throw new ValidationError("businessId y slug corresponden a negocios diferentes");
    }

    const business = businessById || businessBySlug;

    if (!business.isActive) {
      throw new NotFoundError(BUSINESS_NOT_AVAILABLE_MESSAGE);
    }

    req.business = business;
    req.businessId = business._id;
    next();
  } catch (error) {
    next(error);
  }
};
