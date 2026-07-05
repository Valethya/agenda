import * as userService from "../services/user.service.js";

// 1. Registrar un nuevo trabajador (Solo Admin)
export const createWorker = async (req, res, next) => {
  try {
    const newWorker = await userService.createWorker(req.body, req.businessId);

    res.status(201).json({
      status: "success",
      message: "Cuenta de trabajador creada e inicializada exitosamente",
      payload: newWorker,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Dar de baja a un trabajador (Solo Admin)
export const deleteWorker = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hardDelete = req.query.hard === "true"; // ?hard=true para eliminación física (no recomendado)

    await userService.deleteWorker(id, !hardDelete);

    res.status(200).json({
      status: "success",
      message: hardDelete
        ? "Cuenta de trabajador eliminada físicamente de la base de datos"
        : "Cuenta de trabajador desactivada correctamente (Soft Delete)",
    });
  } catch (error) {
    next(error);
  }
};

// 3. Listar trabajadores (Público/Admin)
export const getWorkers = async (req, res, next) => {
  try {
    // Si no es administrador, solo mostramos los trabajadores activos
    const isAdminUser = req.session?.user?.role === "admin";
    const onlyActive = !isAdminUser;

    const workers = await userService.getWorkersList(req.businessId, onlyActive);

    res.status(200).json({
      status: "success",
      results: workers.length,
      payload: workers,
    });
  } catch (error) {
    next(error);
  }
};
