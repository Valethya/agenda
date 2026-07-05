import * as superadminService from "../services/superadmin.service.js";

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

