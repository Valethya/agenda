import mongoose from "mongoose";
import Business from "../db/models/business.model.js";
import Membership from "../db/models/membership.model.js";
import PendingOnboarding, {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "../db/models/pendingOnboarding.model.js";
import User from "../db/models/user.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const CANONICAL_INITIAL_ROLE = "worker";
const CANONICAL_INITIAL_BOOKABILITY = false;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;

  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  throw new TypeError(`${fieldName} debe ser un ObjectId o hexadecimal canónico de 24 caracteres`);
};

const requireFutureDate = (value) => {
  if (
    !(value instanceof Date)
    || Number.isNaN(value.getTime())
    || value.getTime() <= Date.now()
  ) {
    throw new TypeError("expiresAt debe ser una fecha futura válida");
  }

  return value;
};

/**
 * Persiste exclusivamente intención administrativa pendiente.
 *
 * `businessId` e `issuerUserId` son scope server-side; los campos homónimos o
 * policy fields presentes en `data` se ignoran. El issuer se valida por identidad
 * y autoridad tenant vigentes al emitir, pero esa autorización NO queda copiada
 * como autoridad durable: C3 deberá revalidarla al consumir.
 *
 * No consulta User por el email objetivo, no crea User/Membership y no implementa
 * binding, delivery ni consumo. El índice único parcial del modelo es la barrera
 * final contra carreras para Business + email canónico mientras status=pending.
 */
export const createPendingForBusiness = async (businessId, issuerUserId, data = {}) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedIssuerUserId = requireStrictObjectId(issuerUserId, "issuerUserId");
  const expiresAt = requireFutureDate(data.expiresAt);

  const [businessExists, issuerExists, issuerAdminMembership] = await Promise.all([
    Business.exists({ _id: scopedBusinessId, isActive: true }),
    User.exists({ _id: scopedIssuerUserId, isActive: true }),
    Membership.exists({
      user: scopedIssuerUserId,
      business: scopedBusinessId,
      role: "admin",
      isActive: true,
    }),
  ]);

  if (!businessExists) {
    throw new ReferenceError("businessId no corresponde a un Business activo existente");
  }
  if (!issuerExists || !issuerAdminMembership) {
    throw new ReferenceError("issuerUserId no corresponde a un admin tenant activo del Business");
  }

  return PendingOnboarding.create({
    business: scopedBusinessId,
    issuer: scopedIssuerUserId,
    channel: PENDING_ONBOARDING_CHANNEL,
    email: data.email,
    purpose: PENDING_ONBOARDING_PURPOSE,
    role: CANONICAL_INITIAL_ROLE,
    isBookable: CANONICAL_INITIAL_BOOKABILITY,
    expiresAt,
    status: "pending",
  });
};
