import Payment from "../db/models/payment.model.js";

export const findByAppointmentAndStatus = async (appointmentId, status) => {
  return await Payment.findOne({ appointment: appointmentId, status });
};

export const findByTransactionId = async (transactionId) => {
  return await Payment.findOne({ transactionId });
};

export const create = async (data) => {
  return await Payment.create(data);
};

export const updateByTransactionId = async (transactionId, updateData) => {
  return await Payment.findOneAndUpdate(
    { transactionId },
    updateData,
    { new: true }
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
