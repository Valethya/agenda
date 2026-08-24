import * as membershipRepository from "../repositories/membership.repository.js";
import { ConflictError } from "../utils/appError.js";

const LEGACY_TEAM_MUTATION_UNAVAILABLE =
  "La administración legacy de profesionales no está disponible";

/**
 * A2: cierre fail-closed de la incorporación legacy. Deliberadamente ignora el
 * body y no consulta email, User, Membership ni Shift. C1/C2/C3 proveerán el
 * onboarding canónico en una fase posterior.
 */
export const createWorker = async () => {
  throw new ConflictError(LEGACY_TEAM_MUTATION_UNAVAILABLE);
};

/**
 * A2: el lifecycle de baja se trasladará a la superficie Team de B. Mantener
 * esta ruta como no-mutating evita tanto hard delete como una transición parcial
 * que pueda mezclar responsabilidades tenant/globales.
 */
export const deleteWorker = async () => {
  throw new ConflictError(LEGACY_TEAM_MUTATION_UNAVAILABLE);
};

/**
 * Superficie operacional interna, no administrativa. Incluye únicamente
 * participantes activos del Business con User activo y proyecta sólo campos
 * necesarios por Calendar/Appointment. No usa role ni isBookable como grant.
 * Esto permite seguir mostrando actores de Appointments existentes aunque hayan
 * dejado de aceptar nuevas reservas.
 */
export const getWorkersList = async (businessId) => {
  const memberships = await membershipRepository.findAll({
    business: businessId,
    isActive: true,
  });

  return memberships
    .filter((membership) => membership.user?.isActive === true)
    .map((membership) => ({
      _id: membership.user._id,
      id: membership.user._id,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
    }));
};
