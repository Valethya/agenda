import mongoose from "mongoose";
import Appointment from "../db/models/appointment.model.js";
import AppointmentBookingMutex from "../db/models/appointmentBookingMutex.model.js";
import { ConflictError } from "../utils/appError.js";

const PAYMENT_SETTLEMENT_STATUSES = new Set(["partially_paid", "fully_paid"]);
const ACTIVE_BOOKING_STATUSES = Object.freeze(["pending_payment", "pending", "confirmed", "completed"]);

const populateProtectedTenantRelations = (query, businessId) => query
  // Sólo las lecturas internas protegidas necesitan guestContact para construir
  // el DTO operacional. Nunca se serializa este subdocumento raw.
  .select("+guestContact")
  .populate("client", "firstName lastName email phone")
  .populate("worker", "firstName lastName email phone")
  .populate({
    path: "service",
    match: { business: businessId },
    select: "name duration price depositAmount workers business isActive",
  })
  .populate("business", "name slug");

const bookingMutexId = (businessId, workerId, date) => {
  const dateKey = new Date(date).toISOString().slice(0, 10);
  return `${businessId.toString()}:${workerId.toString()}:${dateKey}`;
};

const ensureBookingMutex = async (lockId) => {
  try {
    await AppointmentBookingMutex.updateOne(
      { _id: lockId },
      { $setOnInsert: { version: 0 } },
      { upsert: true },
    );
  } catch (error) {
    // Dos procesos pueden intentar materializar por primera vez la misma fila.
    // La unicidad de _id resuelve la carrera; el perdedor puede continuar.
    if (error?.code !== 11000) throw error;
  }
};

export const withSerializedBookingInterval = async (
  { businessId, workerId, date },
  work,
) => {
  const lockId = bookingMutexId(businessId, workerId, date);
  await ensureBookingMutex(lockId);

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      // Este write es el punto de serialización cross-process para el worker/día.
      // No hay lease que pueda expirar: la exclusión existe sólo durante la txn.
      const lock = await AppointmentBookingMutex.findOneAndUpdate(
        { _id: lockId },
        { $inc: { version: 1 } },
        { new: true, session },
      );
      if (!lock) throw new Error("No se pudo adquirir la serialización de booking");

      result = await work(session);
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    return result;
  } finally {
    await session.endSession();
  }
};

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

export const findActiveOverlapForBusinessWorkerAndDate = async ({
  businessId,
  workerId,
  date,
  startTime,
  endTime,
  session,
}) => {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  return await Appointment.findOne({
    business: businessId,
    worker: workerId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  }).session(session || null);
};

const createWithSession = async (data, session) => {
  const [created] = await Appointment.create([data], { session });
  return created;
};

export const create = async (data, { session = null } = {}) => {
  if (session) return await createWithSession(data, session);

  return await withSerializedBookingInterval(
    {
      businessId: data.business,
      workerId: data.worker,
      date: data.date,
    },
    async (transactionSession) => {
      const overlap = await findActiveOverlapForBusinessWorkerAndDate({
        businessId: data.business,
        workerId: data.worker,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        session: transactionSession,
      });

      if (overlap) {
        throw new ConflictError("El horario seleccionado ya no se encuentra disponible");
      }

      try {
        return await createWithSession(data, transactionSession);
      } catch (error) {
        // Conserva el contrato estable si una fila legacy/no serializada colisiona
        // con el índice exacto de startTime durante la transición.
        if (error?.code === 11000) {
          throw new ConflictError("El horario seleccionado ya no se encuentra disponible");
        }
        throw error;
      }
    },
  );
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

// Dedicated C2 bootstrap query. It deliberately selects the immutable
// Appointment-scoped booking contact and tenant Service coherence, and it never
// populates Appointment.client/User, CustomerProfile, or historical contacts.
export const findGuestCapabilityBootstrapByIdAndBusiness = async (id, businessId) => (
  Appointment.findOne({ _id: id, business: businessId })
    .select("business service +guestContact")
    .populate({
      path: "service",
      match: { business: businessId },
      select: "business",
    })
);

// Dedicated C2 projection: tenant-scoped and deliberately excludes client/contact
// data, notes, User authority fields, history and audit timeline.
export const findGuestReadableByIdAndBusiness = async (id, businessId) => {
  return await Appointment.findOne({ _id: id, business: businessId })
    .select("business worker service date startTime endTime status paymentStatus")
    .populate("worker", "firstName lastName")
    .populate({
      path: "service",
      match: { business: businessId },
      select: "name duration business",
    })
    .populate("business", "name slug");
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
