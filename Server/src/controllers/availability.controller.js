import * as availabilityService from "../services/availability.service.js";
import * as shiftRepository from "../repositories/shift.repository.js";
import * as blockRepository from "../repositories/block.repository.js";
import { ValidationError } from "../utils/appError.js";
import { emitAvailabilityChange } from "../config/socket.js";

export const getSlots = async (req, res, next) => {
  try {
    const { workerId, date, serviceId } = req.query;
    if (!workerId || !date || !serviceId) {
      throw new ValidationError("Faltan parámetros obligatorios en la consulta (workerId, date, serviceId)");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      throw new ValidationError("El formato de fecha debe ser YYYY-MM-DD");
    }
    const slots = await availabilityService.getAvailableSlots(workerId, date, serviceId, req.businessId);
    res.status(200).json({ status: "success", results: slots.length, payload: slots });
  } catch (error) { next(error); }
};

export const getWorkerShifts = async (req, res, next) => {
  try {
    const shifts = await shiftRepository.findByWorker(req.params.workerId);
    res.status(200).json({ status: "success", payload: shifts });
  } catch (error) { next(error); }
};

export const saveShift = async (req, res, next) => {
  try {
    const { workerId, dayOfWeek, isOpen, startTime, endTime, breaks } = req.body;
    if (workerId === undefined || dayOfWeek === undefined) {
      throw new ValidationError("workerId y dayOfWeek son obligatorios");
    }

    const { role, userId } = req.tenantAuthority;
    if (role !== "admin" && !(role === "worker" && userId.toString() === workerId)) {
      return res.status(403).json({ status: "fail", message: "No tiene permisos para modificar turnos de otro trabajador" });
    }

    const updatedShift = await shiftRepository.upsert(workerId, dayOfWeek, {
      isOpen, startTime, endTime, breaks,
    });
    res.status(200).json({ status: "success", message: "Configuración de turno guardada correctamente", payload: updatedShift });
  } catch (error) { next(error); }
};

export const createBlock = async (req, res, next) => {
  try {
    const { workerId, date, startTime, endTime, reason } = req.body;
    if (!workerId || !date || !startTime || !endTime) {
      throw new ValidationError("workerId, date, startTime y endTime son requeridos");
    }

    const { role, userId } = req.tenantAuthority;
    if (role !== "admin" && !(role === "worker" && userId.toString() === workerId)) {
      return res.status(403).json({ status: "fail", message: "No tiene permisos para bloquear el horario de otro trabajador" });
    }

    const newBlock = await blockRepository.create({
      worker: workerId,
      date: new Date(date),
      startTime,
      endTime,
      reason,
    });
    const dateStr = new Date(date).toISOString().split("T")[0];
    emitAvailabilityChange(workerId, dateStr, req.businessId);
    res.status(201).json({ status: "success", message: "Horario bloqueado administrativamente con éxito", payload: newBlock });
  } catch (error) { next(error); }
};

export const deleteBlock = async (req, res, next) => {
  try {
    const block = await blockRepository.findAll({ _id: req.params.id });
    if (!block || block.length === 0) {
      return res.status(404).json({ status: "fail", message: "El bloqueo especificado no existe" });
    }

    const blockOwnerId = block[0].worker._id.toString();
    const { role, userId } = req.tenantAuthority;
    if (role !== "admin" && !(role === "worker" && userId.toString() === blockOwnerId)) {
      return res.status(403).json({ status: "fail", message: "No tiene permisos para eliminar bloqueos de otro trabajador" });
    }

    await blockRepository.deleteById(req.params.id);
    const dateStr = new Date(block[0].date).toISOString().split("T")[0];
    emitAvailabilityChange(blockOwnerId, dateStr, req.businessId);
    res.status(200).json({ status: "success", message: "Horario desbloqueado correctamente" });
  } catch (error) { next(error); }
};
