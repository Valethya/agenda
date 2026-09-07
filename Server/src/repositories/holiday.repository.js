import Holiday from "../db/models/holiday.model.js";
import {
  holidayAvailabilityFenceId,
  withAvailabilityMutationFences,
} from "./availabilityFence.repository.js";

export const findByDate = async (date, { session = null } = {}) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return await Holiday.findOne({ date: { $gte: start, $lte: end } }).session(session || null);
};

export const findAll = async ({ session = null } = {}) => {
  return await Holiday.find().session(session || null);
};

const createInSession = async (data, session) => {
  const [created] = await Holiday.create([data], { session });
  return created;
};

export const create = async (data, { session = null } = {}) => {
  if (session) return createInSession(data, session);
  return withAvailabilityMutationFences(
    [holidayAvailabilityFenceId(data.date)],
    (transactionSession) => createInSession(data, transactionSession),
  );
};

export const deleteById = async (id, { session = null } = {}) => {
  if (session) return Holiday.findByIdAndDelete(id, { session });
  const current = await Holiday.findById(id).select("date");
  if (!current) return null;
  return withAvailabilityMutationFences(
    [holidayAvailabilityFenceId(current.date)],
    (transactionSession) => Holiday.findByIdAndDelete(id, { session: transactionSession }),
  );
};
