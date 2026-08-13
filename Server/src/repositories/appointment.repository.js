import Appointment from "../db/models/appointment.model.js";

const PAYMENT_SETTLEMENT_STATUSES = new Set(["partially_paid", "fully_paid"]);

const populateProtectedTenantRelations = (query, businessId) => query
  .populate("client", "firstName lastName email phone")
  .populate("worker", "firstName lastName email phone")
  .populate({
    path: "service",
    match: { business: businessId },
    select: "name duration price depositAmount workers business isActive",
  })
  .populate("business", "name slug");

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

// Legacy Payment-only commands. Payment/Webpay remains deny-by-default; these
// commands deliberately expose only the fixed fields required by the disabled
// legacy flow and are not generic Appointment mutation APIs.
export const markPendingPaymentFromLegacyPayment = async (id) => {
  return await Appointment.findByIdAndUpdate(
    id,
    { $set: { status: "pending_payment" } },
    { new: true, runValidators: true },
  );
};

export const confirmFromLegacyPayment = async (id, paymentStatus) => {
  if (!PAYMENT_SETTLEMENT_STATUSES.has(paymentStatus)) {
    throw new TypeError("Estado de pago de Appointment inválido");
  }

  return await Appointment.findByIdAndUpdate(
    id,
    { $set: { status: "confirmed", paymentStatus } },
    { new: true, runValidators: true },
  );
};

export const cancelFromRejectedLegacyPayment = async (id) => {
  return await Appointment.findByIdAndUpdate(
    id,
    { $set: { status: "cancelled" } },
    { new: true, runValidators: true },
  );
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
  return await populateProtectedTenantRelations(
    Appointment.findOne({ _id: id, business: businessId }),
    businessId,
  );
};

export const findCoherentAllByBusiness = async (businessId, query = {}) => {
  const appointments = await populateProtectedTenantRelations(
    Appointment.find({ ...query, business: businessId }),
    businessId,
  ).sort({ date: 1, startTime: 1 });

  // populate(match) returns null for a missing or foreign-tenant Service.
  // Protected collections omit those structurally incoherent resources rather
  // than exposing any fields from the foreign Service.
  return appointments.filter((appointment) => Boolean(appointment.service));
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
