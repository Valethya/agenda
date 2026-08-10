import Block from "../db/models/block.model.js";

export const findByBusinessWorkerAndDateRange = async (businessId, workerId, startDate, endDate) => {
  return await Block.find({
    business: businessId,
    worker: workerId,
    date: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  });
};

export const findByIdAndBusiness = async (id, businessId) => {
  return await Block.findOne({ _id: id, business: businessId });
};

export const createForBusinessWorker = async (businessId, workerId, data) => {
  return await Block.create({ ...data, business: businessId, worker: workerId });
};

export const deleteByIdBusinessAndWorker = async (id, businessId, workerId) => {
  return await Block.findOneAndDelete({
    _id: id,
    business: businessId,
    worker: workerId,
  });
};

export const deleteByBusinessAndWorker = async (businessId, workerId) => {
  return await Block.deleteMany({ business: businessId, worker: workerId });
};
