import * as serviceRepository from "../repositories/service.repository.js";
import { assertServiceBookingEligibility } from "./professionalEligibility.service.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";

/**
 * Lifecycle-neutral booking eligibility boundary shared by guest reschedule.
 * Deliberately has no dependency on app/socket runtime.
 */
export const validateBookingTenantScope = async ({ worker, service, businessId, session = null }) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para reservar");

  const serviceDetail = await serviceRepository.findByIdAndBusiness(
    service,
    businessId,
    { onlyActive: true, session },
  );
  if (!serviceDetail) throw new NotFoundError("El servicio solicitado no está disponible");

  const { user: workerDetail } = await assertServiceBookingEligibility({
    userId: worker,
    businessId,
    service: serviceDetail,
    requireActiveService: true,
    session,
  });

  return { serviceDetail, workerDetail };
};
