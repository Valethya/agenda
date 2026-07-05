import * as appointmentService from "../services/appointment.service.js";
import * as authService from "../services/auth.service.js";
import { ValidationError } from "../utils/appError.js";

// 1. Reservar una cita
export const createAppointment = async (req, res, next) => {
  try {
    const { worker, service, date, startTime, notes, clientInfo, paymentOption, isSuggestion } = req.body;
    let clientId;

    if (clientInfo) {
      const clientUser = await authService.getOrCreateGuestUser(clientInfo);
      clientId = clientUser._id.toString();
    } else if (req.session && req.session.user) {
      clientId = req.session.user.id;
    } else {
      throw new ValidationError("Debe proporcionar la información del cliente (clientInfo) para reservar sin login");
    }

    const appointment = await appointmentService.bookAppointment({
      client: clientId,
      worker,
      service,
      date,
      startTime,
      notes,
      paymentOption,
      isSuggestion,
    });

    res.status(201).json({
      status: "success",
      message: "Cita reservada exitosamente",
      payload: appointment,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Confirmar una cita (Solo trabajadores o admin)
export const confirmAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const userRole = req.session.user.role;

    const updatedAppointment = await appointmentService.confirmAppointment(
      id,
      userId,
      userRole
    );

    res.status(200).json({
      status: "success",
      message: "Cita confirmada correctamente",
      payload: updatedAppointment,
    });
  } catch (error) {
    next(error);
  }
};

// 2b. Completar una cita (Solo trabajadores o admin)
export const completeAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const userRole = req.session.user.role;

    const updatedAppointment = await appointmentService.completeAppointment(
      id,
      userId,
      userRole
    );

    res.status(200).json({
      status: "success",
      message: "Cita completada correctamente",
      payload: updatedAppointment,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Cancelar una cita (Clientes, trabajadores o admin)
export const cancelAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const userRole = req.session.user.role;

    const updatedAppointment = await appointmentService.cancelAppointment(
      id,
      userId,
      userRole
    );

    res.status(200).json({
      status: "success",
      message: "Cita cancelada correctamente",
      payload: updatedAppointment,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Obtener detalles de una cita
export const getAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const userRole = req.session.user.role;

    const appointment = await appointmentService.getAppointmentDetails(
      id,
      userId,
      userRole
    );

    res.status(200).json({
      status: "success",
      payload: appointment,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Listar mis citas (se filtra automáticamente según si es cliente o trabajador)
export const getMyAppointments = async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const userRole = req.session.user.role;

    const appointments = await appointmentService.getMyAppointments(userId, userRole, req.businessId);

    res.status(200).json({
      status: "success",
      results: appointments.length,
      payload: appointments,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Obtener timeline (auditoría) de una cita
export const getAppointmentTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const userRole = req.session.user.role;

    // Validar acceso usando getAppointmentDetails
    await appointmentService.getAppointmentDetails(id, userId, userRole);

    // Buscar logs de auditoría ordenados cronológicamente
    const AuditLog = (await import("../db/models/auditLog.model.js")).default;
    const timeline = await AuditLog.find({ appointmentId: id }).sort({ createdAt: 1 });

    res.status(200).json({
      status: "success",
      results: timeline.length,
      payload: timeline,
    });
  } catch (error) {
    next(error);
  }
};
