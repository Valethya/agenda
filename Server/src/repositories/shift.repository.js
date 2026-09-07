import Shift from "../db/models/shift.model.js";
import {
  shiftAvailabilityFenceId,
  withAvailabilityMutationFences,
} from "./availabilityFence.repository.js";

export const findByBusinessAndWorker = async (businessId, workerId, { session = null } = {}) => {
  return await Shift.find({ business: businessId, worker: workerId })
    .sort({ dayOfWeek: 1 })
    .session(session || null);
};

export const findByBusinessWorkerAndDay = async (businessId, workerId, dayOfWeek, { session = null } = {}) => {
  return await Shift.findOne({ business: businessId, worker: workerId, dayOfWeek }).session(session || null);
};

const upsertInSession = async (businessId, workerId, dayOfWeek, shiftData, session) => Shift.findOneAndUpdate(
  { business: businessId, worker: workerId, dayOfWeek },
  {
    $set: {
      ...shiftData,
      business: businessId,
      worker: workerId,
      dayOfWeek,
    },
  },
  { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session },
);

export const upsertByBusinessWorkerAndDay = async (
  businessId,
  workerId,
  dayOfWeek,
  shiftData,
  { session = null } = {},
) => {
  if (session) return upsertInSession(businessId, workerId, dayOfWeek, shiftData, session);
  return withAvailabilityMutationFences(
    [shiftAvailabilityFenceId(businessId, workerId, dayOfWeek)],
    (transactionSession) => upsertInSession(businessId, workerId, dayOfWeek, shiftData, transactionSession),
  );
};

export const deleteByBusinessAndWorker = async (businessId, workerId, { session = null } = {}) => {
  if (session) return Shift.deleteMany({ business: businessId, worker: workerId }, { session });
  const fenceIds = Array.from({ length: 7 }, (_, dayOfWeek) =>
    shiftAvailabilityFenceId(businessId, workerId, dayOfWeek));
  return withAvailabilityMutationFences(
    fenceIds,
    (transactionSession) => Shift.deleteMany(
      { business: businessId, worker: workerId },
      { session: transactionSession },
    ),
  );
};
