import * as businessConfigService from "../services/businessConfig.service.js";
import * as superadminService from "../services/superadmin.service.js";

// Obtener la configuración actual del negocio (Público)
export const getBusinessConfig = async (req, res, next) => {
  try {
    const config = await businessConfigService.getOrInitializeConfig(req.businessId);

    res.status(200).json({
      status: "success",
      payload: config,
    });
  } catch (error) {
    next(error);
  }
};

// Actualizar la configuración del negocio (Solo Admin)
export const updateBusinessConfig = async (req, res, next) => {
  try {
    const updatedConfig = await businessConfigService.updateConfig(req.businessId, req.body);

    res.status(200).json({
      status: "success",
      message: "Configuración del negocio actualizada exitosamente",
      payload: updatedConfig,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener métricas financieras y de negocio (Solo Admin del Negocio)
export const getBusinessMetrics = async (req, res, next) => {
  try {
    const metrics = await superadminService.getGlobalMetrics(req.businessId);

    res.status(200).json({
      status: "success",
      payload: metrics,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener analíticas avanzadas de concurrencia y tendencias (Solo Admin del Negocio)
export const getBusinessAnalytics = async (req, res, next) => {
  try {
    const analytics = await superadminService.getAdvancedAnalytics(req.businessId);

    res.status(200).json({
      status: "success",
      payload: analytics,
    });
  } catch (error) {
    next(error);
  }
};
