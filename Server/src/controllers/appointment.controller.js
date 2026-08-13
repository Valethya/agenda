import * as appointmentService from "../services/appointment.service.js";
import * as authService from "../services/auth.service.js";
import { ValidationError } from "../utils/appError.js";

export const createAppointment = async (req, res, next) => {
  try {
    const { worker, service, date, startTime, notes, clientInfo, paymentOption, isSuggestion } = req.body;
    let clientId;

    const tenantScope = await appointmentService.validateBookingTenantScope({
      worker,
      service,
      businessId: req.businessId,
    });

    if (clientInfo) {
      const clientUser = await authService.getOrCreateGuestUser(clientInfo);
      clientId = clientUser._id.toString();
    } else if (req.session?.user) {
      clientId = req.session.user.id;
    } else {
      throw new ValidationError("Debe proporcionar la información del cliente (clientInfo) para reservar sin login");
    }

    const appointment = await appointmentService.bookAppointment({
      client: clientId,
      worker,
      service,
      businessId: req.businessId,
      tenantScope,
      date,
      startTime,
      notes,
      paymentOption,
      isSuggestion,
    });

    res.status(201).json({ status: "success", message: "Cita reservada exitosamente", payload: appointment });
  } catch (error) { next(error); }
};

export const confirmAppointment = async (req, res, next) => {
  try {
    const updatedAppointment = await appointmentService.confirmAppointment(
      req.params.id,
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    res.status(200).json({ status: "success", message: "Cita confirmada correctamente", payload: updatedAppointment });
  } catch (error) { next(error); }
};

export const completeAppointment = async (req, res, next) => {
  try {
    const updatedAppointment = await appointmentService.completeAppointment(
      req.params.id,
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    res.status(200).json({ status: "success", message: "Cita completada correctamente", payload: updatedAppointment });
  } catch (error) { next(error); }
};

export const cancelAppointment = async (req, res, next) => {
  try {
    const updatedAppointment = await appointmentService.cancelAppointment(
      req.params.id,
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    res.status(200).json({ status: "success", message: "Cita cancelada correctamente", payload: updatedAppointment });
  } catch (error) { next(error); }
};

export const getAppointment = async (req, res, next) => {
  try {
    const appointment = await appointmentService.getAppointmentDetails(
      req.params.id,
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    res.status(200).json({ status: "success", payload: appointment });
  } catch (error) { next(error); }
};

export const getMyAppointments = async (req, res, next) => {
  try {
    const appointments = await appointmentService.getMyAppointments(
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    res.status(200).json({ status: "success", results: appointments.length, payload: appointments });
  } catch (error) { next(error); }
};

export const getAppointmentTimeline = async (req, res, next) => {
  try {
    const timeline = await appointmentService.getAppointmentTimeline(
      req.params.id,
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    res.status(200).json({ status: "success", results: timeline.length, payload: timeline });
  } catch (error) { next(error); }
};
