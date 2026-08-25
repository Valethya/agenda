import mongoose from "mongoose";
import Membership from "../db/models/membership.model.js";
import Business from "../db/models/business.model.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/appError.js";

const TEAM_NOT_FOUND = "La membresía especificada no existe";
const OWNER_GUARD = "La Membership del propietario debe permanecer activa con rol admin";
const LAST_ADMIN_GUARD = "El negocio debe conservar al menos una Membership admin activa";

const toId = (value) => value?.toString?.() || null;

const projectMembership = (membership, ownerId) => {
  const user = membership.user;
  const userId = user?._id || user;
  const firstName = user?.firstName || "";
  const lastName = user?.lastName || "";
  const name = `${firstName} ${lastName}`.trim() || null;

  return {
    membershipId: toId(membership._id),
    userId: toId(userId),
    name,
    role: membership.role,
    isBookable: membership.isBookable === true,
    isActive: membership.isActive === true,
    isOwner: Boolean(ownerId && userId && toId(ownerId) === toId(userId)),
  };
};

export const listTeam = async ({ businessId, ownerId }) => {
  const memberships = await Membership.find({ business: businessId })
    .select("user role isBookable isActive")
    .populate({ path: "user", select: "firstName lastName" })
    .sort({ createdAt: 1, _id: 1 });

  return memberships.map((membership) => projectMembership(membership, ownerId));
};

const assertCurrentAdminAuthority = async ({ actorUserId, businessId, session }) => {
  const actorMembership = await Membership.findOne({
    user: actorUserId,
    business: businessId,
    role: "admin",
    isActive: true,
  }).session(session);

  if (!actorMembership) {
    throw new ForbiddenError("Se requiere una Membership admin activa para administrar Team");
  }
};

export const updateExistingMembership = async ({
  businessId,
  actorUserId,
  membershipId,
  patch,
}) => {
  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      // Cada mutación Team del mismo Business escribe el mismo documento antes
      // de comprobar el último admin. Esto fuerza conflicto/retry transaccional
      // y elimina el write-skew de "contar admins -> actualizar docs distintos".
      const fencedBusiness = await Business.findOneAndUpdate(
        { _id: businessId, isActive: true },
        { $inc: { teamAdminRevision: 1 } },
        { new: true, session },
      ).select("owner isActive teamAdminRevision");

      if (!fencedBusiness) {
        throw new NotFoundError("El negocio seleccionado no está disponible");
      }

      // La autoridad se vuelve a leer dentro de la misma transacción; una copia
      // previa de rol en sesión/request nunca autoriza esta escritura.
      await assertCurrentAdminAuthority({ actorUserId, businessId, session });

      // Tenant isolation por construcción: nunca se consulta el membershipId
      // globalmente antes de aplicar business al filtro.
      const membership = await Membership.findOne({
        _id: membershipId,
        business: businessId,
      })
        .session(session)
        .populate({ path: "user", select: "firstName lastName", options: { session } });

      if (!membership) {
        throw new NotFoundError(TEAM_NOT_FOUND);
      }

      if (patch.isActive === true && membership.isActive === false) {
        throw new ConflictError("La reactivación de Membership no forma parte de esta fase");
      }

      const nextRole = patch.role ?? membership.role;
      const nextIsBookable = patch.isBookable ?? membership.isBookable;
      const nextIsActive = patch.isActive ?? membership.isActive;
      const isOwner = fencedBusiness.owner
        && toId(fencedBusiness.owner) === toId(membership.user?._id || membership.user);

      if (isOwner && (nextRole !== "admin" || nextIsActive !== true)) {
        throw new ConflictError(OWNER_GUARD);
      }

      const currentlyActiveAdmin = membership.role === "admin" && membership.isActive === true;
      const remainsActiveAdmin = nextRole === "admin" && nextIsActive === true;

      if (currentlyActiveAdmin && !remainsActiveAdmin) {
        const activeAdmins = await Membership.countDocuments({
          business: businessId,
          role: "admin",
          isActive: true,
        }).session(session);

        if (activeAdmins <= 1) {
          throw new ConflictError(LAST_ADMIN_GUARD);
        }
      }

      // Allowlist explícita; role, bookability y acceso se mutan de forma
      // independiente y no producen side-effects en Shift/Service/Appointment.
      if (Object.hasOwn(patch, "role")) membership.role = nextRole;
      if (Object.hasOwn(patch, "isBookable")) membership.isBookable = nextIsBookable;
      if (Object.hasOwn(patch, "isActive")) membership.isActive = nextIsActive;

      await membership.save({ session });
      result = projectMembership(membership, fencedBusiness.owner);
    });
  } finally {
    await session.endSession();
  }

  return result;
};
