import AuditLog from "../db/models/auditLog.model.js";

export const create = async (data) => {
  return await AuditLog.create(data);
};

export const findByAppointment = async (appointmentId) => {
  return await AuditLog.find({ appointmentId }).sort({ createdAt: 1 });
};

export const findFunctionalTimelineByAppointment = async (appointmentId) => {
  return await AuditLog.find({ appointmentId })
    .select("event level message createdAt -_id")
    .sort({ createdAt: 1 })
    .lean();
};

export const updateMany = async (filter, updateData) => {
  return await AuditLog.updateMany(filter, updateData);
};

export const associateOrphanedLogs = async (userId, appointmentId) => {
  // Los bookings guest no tienen User. Nunca correlacionar logs anónimos entre
  // solicitudes distintas por medio de userId=null/undefined.
  if (!userId) return null;

  return await AuditLog.updateMany(
    { userId, appointmentId: { $exists: false } },
    { appointmentId }
  );
};
