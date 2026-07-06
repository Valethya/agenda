import * as superadminService from "../services/superadmin.service.js";
import { UnauthorizedError } from "../utils/appError.js";

// 1. Obtener estadísticas y analíticas financieras/roles generales
export const getPlatformMetrics = async (req, res, next) => {
  try {
    const { businessId } = req.query;
    const metrics = await superadminService.getGlobalMetrics(businessId);

    res.status(200).json({
      status: "success",
      payload: metrics,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Obtener análisis avanzado de concurrencia y tendencias de negocio
export const getAdvancedPlatformAnalytics = async (req, res, next) => {
  try {
    const { businessId } = req.query;
    const advancedAnalytics = await superadminService.getAdvancedAnalytics(businessId);

    res.status(200).json({
      status: "success",
      payload: advancedAnalytics,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Listar todos los negocios
export const listBusinesses = async (req, res, next) => {
  try {
    const businesses = await superadminService.listBusinesses();
    res.status(200).json({
      status: "success",
      payload: businesses,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Crear un negocio nuevo (Superadmin)
export const createBusiness = async (req, res, next) => {
  try {
    const result = await superadminService.createBusiness(req.body);
    res.status(201).json({
      status: "success",
      payload: result,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Activar/Desactivar un negocio
export const toggleBusinessStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const business = await superadminService.toggleBusinessStatus(id);
    res.status(200).json({
      status: "success",
      payload: business,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Iniciar suplantación de un negocio cliente
export const impersonateBusiness = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Iniciar impersonación
    const { user, business } = await superadminService.impersonate(id);
    
    // Guardar los datos del superadmin original en originalUser
    req.session.originalUser = { ...req.session.user };
    
    // Sobrescribir sesión con las del administrador del negocio destino
    req.session.user = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: Array.isArray(user.email) ? user.email[0] : user.email,
      role: "admin", // Impersona como administrador
      businessId: business._id,
      businessSlug: business.slug,
      isImpersonating: true,
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: `Impersonación iniciada para ${business.name}`,
        user: req.session.user,
        payload: req.session.user,
      });
    });
  } catch (error) {
    next(error);
  }
};

// 7. Detener suplantación y restaurar sesión de superadmin
export const stopImpersonatingBusiness = async (req, res, next) => {
  try {
    if (!req.session.originalUser) {
      throw new UnauthorizedError("No estás impersonando ningún negocio");
    }

    // Restaurar original
    req.session.user = { ...req.session.originalUser };
    delete req.session.originalUser;

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: "Impersonación detenida con éxito",
        user: req.session.user,
        payload: req.session.user,
      });
    });
  } catch (error) {
    next(error);
  }
};

