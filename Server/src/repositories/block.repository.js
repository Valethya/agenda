import Block from "../db/models/block.model.js";
import {
  blockAvailabilityFenceId,
  withAvailabilityMutationFences,
} from "./availabilityFence.repository.js";

export const findByBusinessWorkerAndDateRange = async (
  businessId,
  workerId,
  startDate,
  endDate,
  { session = null } = {},
) => {
  return await Block.find({
    business: businessId,
    worker: workerId,
    date: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  }).session(session || null);
};

export const findByIdAndBusiness = async (id, businessId, { session = null } = {}) => {
  return await Block.findOne({ _id: id, business: businessId }).session(session || null);
};

const createInSession = async (businessId, workerId, data, session) => {
  const [created] = await Block.create([{ ...data, business: businessId, worker: workerId }], { session });
  return created;
};

export const createForBusinessWorker = async (businessId, workerId, data, { session = null } = {}) => {
  if (session) return createInSession(businessId, workerId, data, session);
  return withAvailabilityMutationFences(
    [blockAvailabilityFenceId(businessId, workerId, data.date)],
    (transactionSession) => createInSession(businessId, workerId, data, transactionSession),
  );
};

export const deleteByIdBusinessAndWorker = async (
  id,
  businessId,
  workerId,
  { session = null, date = null } = {},
) => {
  if (session) {
    return Block.findOneAndDelete({ _id: id, business: businessId, worker: workerId }, { session });
  }
  const current = date ? { date } : await Block.findOne({ _id: id, business: businessId, worker: workerId }).select("date");
  if (!current) return null;
  return withAvailabilityMutationFences(
    [blockAvailabilityFenceId(businessId, workerId, current.date)],
    (transactionSession) => Block.findOneAndDelete(
      { _id: id, business: businessId, worker: workerId },
      { session: transactionSession },
    ),
  );
};

export const deleteByBusinessAndWorker = async (businessId, workerId, { session = null } = {}) => {
  if (session) return Block.deleteMany({ business: businessId, worker: workerId }, { session });
  const dates = await Block.find({ business: businessId, worker: workerId }).distinct("date");
  const fenceIds = dates.map((date) => blockAvailabilityFenceId(businessId, workerId, date));
  if (fenceIds.length === 0) return Block.deleteMany({ business: businessId, worker: workerId });
  return withAvailabilityMutationFences(
    fenceIds,
    (transactionSession) => Block.deleteMany(
      { business: businessId, worker: workerId },
      { session: transactionSession },
    ),
  );
};
