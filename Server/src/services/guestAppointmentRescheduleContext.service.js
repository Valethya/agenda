import mongoose from "mongoose";
import * as appointmentRepository from "../repositories/appointment.repository.js";

const asId = (value) => (value?._id ?? value)?.toString?.() || "";

export const resolveGuestAppointmentRescheduleContext = async ({ businessId, appointmentId }) => {
  if (!mongoose.isValidObjectId(businessId) || !mongoose.isValidObjectId(appointmentId)) return null;
  const detail = await appointmentRepository.findGuestReadableByIdAndBusiness(appointmentId, businessId);
  if (!detail || asId(detail.business) !== asId(businessId) || !detail.service || !detail.worker) return null;
  return {
    businessId: asId(detail.business),
    appointmentId: asId(detail),
    business: { id: asId(detail.business), name: detail.business.name, slug: detail.business.slug },
    service: { id: asId(detail.service), name: detail.service.name },
    professional: {
      id: asId(detail.worker),
      firstName: detail.worker.firstName,
      lastName: detail.worker.lastName,
    },
    date: detail.date,
    startTime: detail.startTime,
    endTime: detail.endTime,
    status: detail.status,
  };
};
