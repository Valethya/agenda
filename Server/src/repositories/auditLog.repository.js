import AuditLog from "../db/models/auditLog.model.js";

export const create = async (data) => {
  return await AuditLog.create(data);
};

export const findByAppointment = async (appointmentId) => {
  return await AuditLog.find({ appointmentId }).sort({ createdAt: 1 });
};

export const updateMany = async (filter, updateData) => {
  return await AuditLog.updateMany(filter, updateData);
};

export const associateOrphanedLogs = async (userId, appointmentId) => {
  return await AuditLog.updateMany(
    { userId, appointmentId: { $exists: false } },
    { appointmentId }
  );
};
