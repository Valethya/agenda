import Holiday from "../db/models/holiday.model.js";

export const findByDate = async (date) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  return await Holiday.findOne({
    date: { $gte: start, $lte: end },
  });
};

export const findAll = async () => {
  return await Holiday.find();
};

export const create = async (data) => {
  return await Holiday.create(data);
};

export const deleteById = async (id) => {
  return await Holiday.findByIdAndDelete(id);
};
