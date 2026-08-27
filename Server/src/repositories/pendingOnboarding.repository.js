import mongoose from "mongoose";
import Business from "../db/models/business.model.js";
import PendingOnboarding from "../db/models/pendingOnboarding.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;

  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  throw new TypeError(`${fieldName} debe ser un ObjectId o hexadecimal canónico de 24 caracteres`);
};

const pickCreateFields = (data = {}) => ({
  email: data.email,
  role: data.role,
  isBookable: data.isBookable,
});

/**
 * Persiste exclusivamente intención administrativa pendiente.
 *
 * No consulta User por email, no crea User/Membership y no implementa binding,
 * delivery ni consumo. El índice único parcial del modelo es la barrera final
 * contra carreras para Business + email canónico mientras status=pending.
 */
export const createPendingForBusiness = async (businessId, data = {}) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const businessExists = await Business.exists({ _id: scopedBusinessId });

  if (!businessExists) {
    throw new ReferenceError("businessId no corresponde a un Business existente");
  }

  return PendingOnboarding.create({
    ...pickCreateFields(data),
    business: scopedBusinessId,
    status: "pending",
  });
};
