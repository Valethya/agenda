import * as userService from "../services/user.service.js";

export const createWorker = async (req, res, next) => {
  try {
    const newWorker = await userService.createWorker(req.body, req.businessId);
    res.status(201).json({
      status: "success",
      message: "Cuenta de trabajador creada e inicializada exitosamente",
      payload: newWorker,
    });
  } catch (error) { next(error); }
};

export const deleteWorker = async (req, res, next) => {
  try {
    const hardDelete = req.query.hard === "true";
    await userService.deleteWorker(req.params.id, req.businessId, !hardDelete);
    res.status(200).json({
      status: "success",
      message: hardDelete
        ? "Cuenta de trabajador eliminada físicamente de la base de datos"
        : "Cuenta de trabajador desactivada correctamente (Soft Delete)",
    });
  } catch (error) { next(error); }
};

export const getWorkers = async (req, res, next) => {
  try {
    const onlyActive = req.tenantAuthority?.role !== "admin";
    const workers = await userService.getWorkersList(req.businessId, onlyActive);
    res.status(200).json({ status: "success", results: workers.length, payload: workers });
  } catch (error) { next(error); }
};
