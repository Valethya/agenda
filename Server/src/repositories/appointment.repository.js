import Appointment from "../db/models/appointment.model.js";

export const findByWorkerAndDate = async (workerId, date) => {
  // Ajustar la fecha para buscar solo en ese día (ignorar horas/minutos/segundos al comparar)
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  return await Appointment.find({
    worker: workerId,
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
    // No restamos disponibilidad si la cita está cancelada
    status: { $ne: "cancelled" },
  });
};

export const create = async (data) => {
  return await Appointment.create(data);
};

export const update = async (id, data) => {
  return await Appointment.findByIdAndUpdate(id, data, { new: true });
};

export const findById = async (id) => {
  return await Appointment.findById(id)
    .populate("client", "firstName lastName email phone")
    .populate("worker", "firstName lastName email phone")
    .populate("service", "name duration price depositAmount")
    .populate("business", "name slug");
};

export const findAll = async (query = {}) => {
  return await Appointment.find(query)
    .populate("client", "firstName lastName email phone")
    .populate("worker", "firstName lastName email phone")
    .populate("service", "name duration price depositAmount")
    .populate("business", "name slug")
    .sort({ date: 1, startTime: 1 });
};

export const aggregate = async (pipeline) => {
  return await Appointment.aggregate(pipeline);
};
