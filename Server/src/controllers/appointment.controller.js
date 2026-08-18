import * as appointmentService from "../services/appointment.service.js";
import { projectPublicAppointmentCreated } from "../services/publicBookingContract.service.js";
import {
  projectInternalAppointment,
  projectInternalAppointments,
} from "../services/internalAppointmentProjection.service.js";
import { ValidationError } from "../utils/appError.js";

export const createAppointment = async (req, res, next) => {
  try {
    const input = req.bookingInput || {};
    const {
      worker,
      service,
      date,
      startTime,
      notes,
      clientInfo,
      paymentOption,
      isSuggestion,
    } = input;
    const publicBooking = req.bookingSurface === "public";
    let clientId = null;
    let guestContact = null;

    const tenantScope = await appointmentService.validateBookingTenantScope({
      worker,
      service,
      businessId: req.businessId,
    });

    if (clientInfo) {
      guestContact = {
        ...appointmentService.buildGuestBookingContactSnapshot(clientInfo),
        firstName: clientInfo.firstName,
        lastName: clientInfo.lastName,
        phone: clientInfo.phone,
      };
    } else if (publicBooking) {
      throw new ValidationError("Debe proporcionar la información del cliente (clientInfo) para reservar sin login");
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
      guestContact,
    });

    const payload = publicBooking
      ? projectPublicAppointmentCreated(appointment)
      : appointment;

    res.status(201).json({ status: "success", message: "Cita reservada exitosamente", payload });
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
    res.status(200).json({ status: "success", payload: projectInternalAppointment(appointment) });
  } catch (error) { next(error); }
};

export const getMyAppointments = async (req, res, next) => {
  try {
    const appointments = await appointmentService.getMyAppointments(
      req.session.user.id,
      req.tenantAuthority,
      req.businessId,
    );
    const payload = projectInternalAppointments(appointments);
    res.status(200).json({ status: "success", results: payload.length, payload });
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
