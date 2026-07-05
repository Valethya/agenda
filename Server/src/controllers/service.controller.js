import * as serviceService from "../services/service.service.js";

export const getServices = async (req, res, next) => {
  try {
    const isAdminUser = req.session?.user?.role === "admin";
    const onlyActive = !isAdminUser;

    const services = await serviceService.getAllServices(req.businessId, onlyActive);

    res.status(200).json({
      status: "success",
      results: services.length,
      payload: services,
    });
  } catch (error) {
    next(error);
  }
};

export const getService = async (req, res, next) => {
  try {
    const { id } = req.params;
    const service = await serviceService.getServiceById(id);

    res.status(200).json({
      status: "success",
      payload: service,
    });
  } catch (error) {
    next(error);
  }
};

export const createService = async (req, res, next) => {
  try {
    const newService = await serviceService.createService(req.body, req.businessId);

    res.status(201).json({
      status: "success",
      message: "Servicio creado exitosamente",
      payload: newService,
    });
  } catch (error) {
    next(error);
  }
};

export const updateService = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatedService = await serviceService.updateService(id, req.body, req.businessId);

    res.status(200).json({
      status: "success",
      message: "Servicio actualizado exitosamente",
      payload: updatedService,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteService = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hardDelete = req.query.hard === "true";

    await serviceService.deleteService(id, !hardDelete);

    res.status(200).json({
      status: "success",
      message: hardDelete
        ? "Servicio eliminado físicamente de la base de datos"
        : "Servicio desactivado correctamente (Soft Delete)",
    });
  } catch (error) {
    next(error);
  }
};
