import mongoose from "mongoose";
import Appointment from "../db/models/appointment.model.js";
import AppointmentBookingMutex from "../db/models/appointmentBookingMutex.model.js";
import { ConflictError } from "../utils/appError.js";

const PAYMENT_SETTLEMENT_STATUSES = new Set(["partially_paid", "fully_paid"]);
const ACTIVE_BOOKING_STATUSES = Object.freeze(["pending_payment", "pending", "confirmed", "completed"]);

const populateProtectedTenantRelations = (query, businessId) => query
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
    if (error?.code !== 11000) throw error;
  }
};

/**
 * G2/H3 shared serialization primitive. Every affected worker/day mutex is
 * canonicalized, de-duplicated and acquired in lexical order inside one
 * transaction. The ordering prevents A→B/B→A lock inversion, while one-day
 * reschedules acquire the mutex exactly once.
 */
export const withSerializedBookingIntervals = async (scopes, work) => {
  if (!Array.isArray(scopes) || scopes.length === 0) throw new TypeError("Se requiere al menos un dominio de booking");
  const lockIds = [...new Set(scopes.map(({ businessId, workerId, date }) => bookingMutexId(businessId, workerId, date)))].sort();
  await Promise.all(lockIds.map(ensureBookingMutex));

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      for (const lockId of lockIds) {
        const lock = await AppointmentBookingMutex.findOneAndUpdate(
          { _id: lockId },
          { $inc: { version: 1 } },
          { new: true, session },
        );
        if (!lock) throw new Error("No se pudo adquirir la serialización de booking");
      }
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

export const withSerializedBookingInterval = async ({ businessId, workerId, date }, work) =>
  withSerializedBookingIntervals([{ businessId, workerId, date }], work);

export const findByBusinessWorkerAndDate = async (businessId, workerId, date) => {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  return await Appointment.find({
    business: businessId,
    worker: workerId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $ne: "cancelled" },
  });
};

export const findActiveOverlapForBusinessWorkerAndDate = async ({
  businessId,
  workerId,
  date,
  startTime,
  endTime,
  excludeAppointmentId = null,
  session,
}) => {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const filter = {
    business: businessId,
    worker: workerId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  };
  if (excludeAppointmentId) filter._id = { $ne: excludeAppointmentId };
  return await Appointment.findOne(filter).session(session || null);
};

const createWithSession = async (data, session) => {
  const [created] = await Appointment.create([data], { session });
  return created;
};

export const create = async (data, { session = null, prepareCommit = null } = {}) => {
  if (session) return await createWithSession(data, session);
  return await withSerializedBookingInterval(
    { businessId: data.business, workerId: data.worker, date: data.date },
    async (transactionSession) => {
      const commitData = prepareCommit ? await prepareCommit(transactionSession, data) : data;
      const overlap = await findActiveOverlapForBusinessWorkerAndDate({
        businessId: commitData.business,
        workerId: commitData.worker,
        date: commitData.date,
        startTime: commitData.startTime,
        endTime: commitData.endTime,
        session: transactionSession,
      });
      if (overlap) throw new ConflictError("El horario seleccionado ya no se encuentra disponible");
      try {
        return await createWithSession(commitData, transactionSession);
      } catch (error) {
        if (error?.code === 11000) throw new ConflictError("El horario seleccionado ya no se encuentra disponible");
        throw error;
      }
    },
  );
};

export const findGuestRescheduleSnapshotByIdAndBusiness = async (id, businessId, { session = null } = {}) =>
  Appointment.findOne({ _id: id, business: businessId })
    .select("business worker service date startTime endTime status paymentStatus")
    .session(session || null);

export const moveGuestAppointmentWindow = async ({
  appointmentId,
  businessId,
  expectedDate,
  expectedStartTime,
  expectedEndTime,
  expectedStatuses,
  date,
  startTime,
  endTime,
  session,
}) => Appointment.findOneAndUpdate(
  {
    _id: appointmentId,
    business: businessId,
    date: expectedDate,
    startTime: expectedStartTime,
    endTime: expectedEndTime,
    status: { $in: expectedStatuses },
  },
  { $set: { date, startTime, endTime } },
  { new: true, runValidators: true, session },
);

export const markPendingPaymentFromLegacyPayment = async (id) => Appointment.findByIdAndUpdate(
  id,
  { $set: { status: "pending_payment" } },
  { new: true, runValidators: true },
);

export const findBookingTransitionById = async (id, { session = null } = {}) => Appointment.findById(id).session(session || null);

export const confirmPendingPaymentFromLegacyPayment = async (id, paymentStatus, { session = null } = {}) => {
  if (!PAYMENT_SETTLEMENT_STATUSES.has(paymentStatus)) throw new TypeError("Estado de pago de Appointment inválido");
  return await Appointment.findOneAndUpdate(
    { _id: id, status: "pending_payment" },
    { $set: { status: "confirmed", paymentStatus } },
    { new: true, runValidators: true, session },
  );
};

export const cancelPendingPaymentForLegacyConflict = async (id, { session = null } = {}) => Appointment.findOneAndUpdate(
  { _id: id, status: "pending_payment" },
  { $set: { status: "cancelled" } },
  { new: true, runValidators: true, session },
);

export const cancelFromRejectedLegacyPayment = async (id) => Appointment.findByIdAndUpdate(
  id,
  { $set: { status: "cancelled" } },
  { new: true, runValidators: true },
);

export const transitionStatusByBusiness = async (id, businessId, expectedStatuses, nextStatus) => {
  const allowedOrigins = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  return await Appointment.findOneAndUpdate(
    { _id: id, business: businessId, status: { $in: allowedOrigins } },
    { $set: { status: nextStatus } },
    { new: true },
  );
};

export const findById = async (id) => Appointment.findById(id)
  .populate("client", "firstName lastName email phone")
  .populate("worker", "firstName lastName email phone")
  .populate("service", "name duration price depositAmount")
  .populate("business", "name slug");

export const findByIdAndBusiness = async (id, businessId) => populateProtectedTenantRelations(
  Appointment.findOne({ _id: id, business: businessId }),
  businessId,
);

export const findGuestCapabilityBootstrapByIdAndBusiness = async (id, businessId) => Appointment.findOne({ _id: id, business: businessId })
  .select("business service +guestContact")
  .populate({ path: "service", match: { business: businessId }, select: "business" });

export const findGuestReadableByIdAndBusiness = async (id, businessId) => Appointment.findOne({ _id: id, business: businessId })
  .select("business worker service date startTime endTime status paymentStatus")
  .populate("worker", "firstName lastName")
  .populate({ path: "service", match: { business: businessId }, select: "name duration business" })
  .populate("business", "name slug");

export const findCoherentAllByBusiness = async (businessId, query = {}) => {
  const appointments = await populateProtectedTenantRelations(
    Appointment.find({ ...query, business: businessId }),
    businessId,
  ).sort({ date: 1, startTime: 1 });
  return appointments.filter((appointment) => Boolean(appointment.service));
};

export const findAll = async (query = {}) => Appointment.find(query)
  .populate("client", "firstName lastName email phone")
  .populate("worker", "firstName lastName email phone")
  .populate("service", "name duration price depositAmount")
  .populate("business", "name slug")
  .sort({ date: 1, startTime: 1 });

export const aggregate = async (pipeline) => Appointment.aggregate(pipeline);
