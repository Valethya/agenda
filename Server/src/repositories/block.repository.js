import Block from "../db/models/block.model.js";

export const findByWorkerAndDateRange = async (workerId, startDate, endDate) => {
  return await Block.find({
    worker: workerId,
    date: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  });
};

export const create = async (data) => {
  return await Block.create(data);
};

export const deleteById = async (id) => {
  return await Block.findByIdAndDelete(id);
};

export const findAll = async (query = {}) => {
  return await Block.find(query).populate("worker", "firstName lastName email");
};
