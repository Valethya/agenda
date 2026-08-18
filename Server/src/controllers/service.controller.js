import * as serviceService from "../services/service.service.js";
import { projectPublicService } from "../services/publicBookingContract.service.js";

const isPublicBookingRead = (req) => !req.tenantAuthority;

export const getServices = async (req, res, next) => {
  try {
    const publicRead = isPublicBookingRead(req);
    const onlyActive = publicRead || req.tenantAuthority?.role !== "admin";
    const services = await serviceService.getAllServices(req.businessId, onlyActive);
    const payload = publicRead ? services.map(projectPublicService) : services;
    res.status(200).json({ status: "success", results: payload.length, payload });
  } catch (error) { next(error); }
};

export const getService = async (req, res, next) => {
  try {
    const publicRead = isPublicBookingRead(req);
    const onlyActive = publicRead || req.tenantAuthority?.role !== "admin";
    const service = await serviceService.getServiceById(req.params.id, req.businessId, onlyActive);
    const payload = publicRead ? projectPublicService(service) : service;
    res.status(200).json({ status: "success", payload });
  } catch (error) { next(error); }
};

export const createService = async (req, res, next) => {
  try {
    const newService = await serviceService.createService(req.body, req.businessId);
    res.status(201).json({ status: "success", message: "Servicio creado exitosamente", payload: newService });
  } catch (error) { next(error); }
};

export const updateService = async (req, res, next) => {
  try {
    const updatedService = await serviceService.updateService(req.params.id, req.body, req.businessId);
    res.status(200).json({ status: "success", message: "Servicio actualizado exitosamente", payload: updatedService });
  } catch (error) { next(error); }
};

export const deleteService = async (req, res, next) => {
  try {
    const hardDelete = req.query.hard === "true";
    await serviceService.deleteService(req.params.id, req.businessId, !hardDelete);
    res.status(200).json({
      status: "success",
      message: hardDelete ? "Servicio eliminado físicamente de la base de datos" : "Servicio desactivado correctamente (Soft Delete)",
    });
  } catch (error) { next(error); }
};
