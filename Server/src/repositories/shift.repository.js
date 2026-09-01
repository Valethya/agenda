import Shift from "../db/models/shift.model.js";

export const findByBusinessAndWorker = async (businessId, workerId) => {
  return await Shift.find({ business: businessId, worker: workerId }).sort({ dayOfWeek: 1 });
};

export const findByBusinessWorkerAndDay = async (businessId, workerId, dayOfWeek) => {
  return await Shift.findOne({ business: businessId, worker: workerId, dayOfWeek });
};

export const upsertByBusinessWorkerAndDay = async (businessId, workerId, dayOfWeek, shiftData) => {
  return await Shift.findOneAndUpdate(
    { business: businessId, worker: workerId, dayOfWeek },
    {
      $set: {
        ...shiftData,
        business: businessId,
        worker: workerId,
        dayOfWeek,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

export const deleteByBusinessAndWorker = async (businessId, workerId) => {
  return await Shift.deleteMany({ business: businessId, worker: workerId });
};
