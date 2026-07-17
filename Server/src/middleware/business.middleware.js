import * as businessRepository from "../repositories/business.repository.js";
import { NotFoundError, UnauthorizedError } from "../utils/appError.js";

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
    const businessId = req.query.businessId || (req.body && req.body.businessId) || req.headers["x-business-id"];
    const slug = req.query.slug || (req.body && req.body.slug) || req.headers["x-business-slug"];

    if (!businessId && !slug) {
      // Como fallback de desarrollo y pruebas, si no se especifica, se toma el primer negocio activo
      const defaultBusiness = await businessRepository.findFirstActive();
      if (!defaultBusiness) {
        throw new NotFoundError("No hay ningún negocio activo registrado en la plataforma.");
      }
      req.business = defaultBusiness;
      req.businessId = defaultBusiness._id;
      return next();
    }

    let business;
    if (businessId) {
      business = await businessRepository.findById(businessId);
    } else if (slug) {
      business = await businessRepository.findBySlug(slug);
    }

    if (!business) {
      // Si el usuario es superadmin, usamos el primer negocio activo como fallback en lugar de lanzar error 404
      if (req.session?.user?.role === "superadmin") {
        const fallbackBiz = await businessRepository.findFirstActive();
        if (fallbackBiz) {
          req.business = fallbackBiz;
          req.businessId = fallbackBiz._id;
          return next();
        }
      }
      throw new NotFoundError("El negocio especificado no existe o no pudo ser encontrado.");
    }

    if (!business.isActive) {
      return res.status(403).json({
        status: "fail",
        message: `El negocio '${business.name}' está actualmente inactivo en la plataforma.`,
      });
    }

    req.business = business;
    req.businessId = business._id;
    next();
  } catch (error) {
    next(error);
  }
};

