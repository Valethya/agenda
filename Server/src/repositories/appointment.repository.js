import Appointment from "../db/models/appointment.model.js";

export const findByBusinessWorkerAndDate = async (businessId, workerId, date) => {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  return await Appointment.find({
    business: businessId,
    worker: workerId,
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
    status: { $ne: "cancelled" },
  });
};

export const create = async (data) => {
  return await Appointment.create(data);
};

// Legacy Payment-only mutation. Payment/Webpay is disabled deny-by-default in the
// MVP and its hardening remains outside 6.2.4-B.
export const update = async (id, data) => {
  return await Appointment.findByIdAndUpdate(id, data, { new: true });
};

export const transitionStatusByBusiness = async (
  id,
  businessId,
  expectedStatuses,
  nextStatus,
) => {
  const allowedOrigins = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  return await Appointment.findOneAndUpdate(
    {
      _id: id,
      business: businessId,
      status: { $in: allowedOrigins },
    },
    { $set: { status: nextStatus } },
    { new: true },
  );
};

export const findById = async (id) => {
  return await Appointment.findById(id)
    .populate("client", "firstName lastName email phone")
    .populate("worker", "firstName lastName email phone")
    .populate("service", "name duration price depositAmount")
    .populate("business", "name slug");
};

export const findByIdAndBusiness = async (id, businessId) => {
  return await Appointment.findOne({ _id: id, business: businessId })
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
