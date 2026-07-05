import * as availabilityService from "../services/availability.service.js";
import * as shiftRepository from "../repositories/shift.repository.js";
import * as blockRepository from "../repositories/block.repository.js";
import { ValidationError } from "../utils/appError.js";
import { emitAvailabilityChange } from "../config/socket.js";

// Obtener franjas horarias disponibles para agendamiento público
export const getSlots = async (req, res, next) => {
  try {
    const { workerId, date, serviceId } = req.query;

    if (!workerId || !date || !serviceId) {
      throw new ValidationError(
        "Faltan parámetros obligatorios en la consulta (workerId, date, serviceId)"
      );
    }

    // Validar formato de fecha YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new ValidationError("El formato de fecha debe ser YYYY-MM-DD");
    }

    const slots = await availabilityService.getAvailableSlots(workerId, date, serviceId, req.businessId);

    res.status(200).json({
      status: "success",
      results: slots.length,
      payload: slots,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener la configuración de turnos semanales de un trabajador
export const getWorkerShifts = async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const shifts = await shiftRepository.findByWorker(workerId);

    res.status(200).json({
      status: "success",
      payload: shifts,
    });
  } catch (error) {
    next(error);
  }
};

// Guardar o actualizar la configuración de un turno para un día específico (Mon-Sun)
export const saveShift = async (req, res, next) => {
  try {
    const { workerId, dayOfWeek, isOpen, startTime, endTime, breaks } = req.body;

    if (workerId === undefined || dayOfWeek === undefined) {
      throw new ValidationError("workerId y dayOfWeek son obligatorios");
    }

    // Solo el propio trabajador o un administrador pueden modificar los turnos
    const sessionUser = req.session.user;
    if (sessionUser.role !== "admin" && sessionUser.id !== workerId) {
      return res.status(403).json({
        status: "fail",
        message: "No tiene permisos para modificar turnos de otro trabajador",
      });
    }

    const updatedShift = await shiftRepository.upsert(workerId, dayOfWeek, {
      isOpen,
      startTime,
      endTime,
      breaks,
    });

    res.status(200).json({
      status: "success",
      message: "Configuración de turno guardada correctamente",
      payload: updatedShift,
    });
  } catch (error) {
    next(error);
  }
};

// Crear un bloqueo administrativo puntual
export const createBlock = async (req, res, next) => {
  try {
    const { workerId, date, startTime, endTime, reason } = req.body;

    if (!workerId || !date || !startTime || !endTime) {
      throw new ValidationError("workerId, date, startTime y endTime son requeridos");
    }

    // Solo el propio trabajador o un administrador pueden crear bloqueos
    const sessionUser = req.session.user;
    if (sessionUser.role !== "admin" && sessionUser.id !== workerId) {
      return res.status(403).json({
        status: "fail",
        message: "No tiene permisos para bloquear el horario de otro trabajador",
      });
    }

    const newBlock = await blockRepository.create({
      worker: workerId,
      date: new Date(date),
      startTime,
      endTime,
      reason,
    });

    // Emitir cambio de disponibilidad en tiempo real mediante WebSockets
    const dateStr = new Date(date).toISOString().split("T")[0];
    emitAvailabilityChange(workerId, dateStr);

    res.status(201).json({
      status: "success",
      message: "Horario bloqueado administrativamente con éxito",
      payload: newBlock,
    });
  } catch (error) {
    next(error);
  }
};

// Eliminar un bloqueo puntual
export const deleteBlock = async (req, res, next) => {
  try {
    const { id } = req.params;

    const block = await blockRepository.findAll({ _id: id });
    if (!block || block.length === 0) {
      return res.status(404).json({
        status: "fail",
        message: "El bloqueo especificado no existe",
      });
    }

    // Solo el propio trabajador del bloqueo o un administrador pueden eliminarlo
    const sessionUser = req.session.user;
    const blockOwnerId = block[0].worker._id.toString();
    if (sessionUser.role !== "admin" && sessionUser.id !== blockOwnerId) {
      return res.status(403).json({
        status: "fail",
        message: "No tiene permisos para eliminar bloqueos de otro trabajador",
      });
    }

    await blockRepository.deleteById(id);

    // Emitir cambio de disponibilidad en tiempo real mediante WebSockets
    const dateStr = new Date(block[0].date).toISOString().split("T")[0];
    emitAvailabilityChange(blockOwnerId, dateStr);

    res.status(200).json({
      status: "success",
      message: "Horario desbloqueado correctamente",
    });
  } catch (error) {
    next(error);
  }
};
