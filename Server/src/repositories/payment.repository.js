import Payment from "../db/models/payment.model.js";

export const findByAppointmentAndStatus = async (appointmentId, status) => {
  return await Payment.findOne({ appointment: appointmentId, status });
};

export const findByTransactionId = async (transactionId, { session = null } = {}) => {
  return await Payment.findOne({ transactionId }).session(session || null);
};

export const create = async (data) => {
  return await Payment.create(data);
};

export const updateByTransactionId = async (transactionId, updateData, { session = null } = {}) => {
  return await Payment.findOneAndUpdate(
    { transactionId },
    updateData,
    { new: true, session }
  );
};

export const updatePendingByTransactionId = async (
  transactionId,
  updateData,
  { session = null } = {},
) => {
  return await Payment.findOneAndUpdate(
    { transactionId, status: "pending" },
    updateData,
    { new: true, runValidators: true, session },
  );
};

export const aggregateFinancialMetrics = async (matchFilter = {}) => {
  return await Payment.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$amount" },
        totalTransactions: { $sum: 1 },
        averageTicket: { $avg: "$amount" },
      },
    },
  ]);
};
