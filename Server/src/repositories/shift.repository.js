import Shift from "../db/models/shift.model.js";

export const findByWorker = async (workerId) => {
  return await Shift.find({ worker: workerId }).sort({ dayOfWeek: 1 });
};

export const findByWorkerAndDay = async (workerId, dayOfWeek) => {
  return await Shift.findOne({ worker: workerId, dayOfWeek });
};

export const upsert = async (workerId, dayOfWeek, shiftData) => {
  return await Shift.findOneAndUpdate(
    { worker: workerId, dayOfWeek },
    { ...shiftData, worker: workerId, dayOfWeek },
    { new: true, upsert: true, runValidators: true }
  );
};

export const deleteByWorker = async (workerId) => {
  return await Shift.deleteMany({ worker: workerId });
};
