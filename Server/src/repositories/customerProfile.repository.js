import mongoose from "mongoose";
import Business from "../db/models/business.model.js";
import CustomerProfile from "../db/models/customerProfile.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const DEFAULT_LIMIT = 100;
const DEFAULT_SKIP = 0;
const MAX_LIMIT = 100;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;

  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  throw new TypeError(`${fieldName} debe ser un ObjectId o hexadecimal canónico de 24 caracteres`);
};

const requirePaginationOptions = (options) => {
  if (options === undefined) return {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Las opciones de paginación deben ser un objeto");
  }
  return options;
};

const requirePaginationInteger = (value, fieldName, { min, max = Number.POSITIVE_INFINITY }) => {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < min
    || value > max
  ) {
    const range = Number.isFinite(max) ? `${min}..${max}` : `>= ${min}`;
    throw new TypeError(`${fieldName} debe ser un entero finito ${range}`);
  }
  return value;
};

const pickCreateFields = (data = {}) => ({
  firstName: data.firstName,
  lastName: data.lastName,
  email: data.email,
  phone: data.phone,
});

export const findByIdAndBusiness = async (profileId, businessId) => {
  const scopedProfileId = requireStrictObjectId(profileId, "profileId");
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");

  return CustomerProfile.findOne({ _id: scopedProfileId, business: scopedBusinessId });
};

export const findAllByBusiness = async (businessId, options) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const pagination = requirePaginationOptions(options);

  const limit = Object.hasOwn(pagination, "limit")
    ? requirePaginationInteger(pagination.limit, "limit", { min: 1, max: MAX_LIMIT })
    : DEFAULT_LIMIT;
  const skip = Object.hasOwn(pagination, "skip")
    ? requirePaginationInteger(pagination.skip, "skip", { min: 0 })
    : DEFAULT_SKIP;

  return CustomerProfile.find({ business: scopedBusinessId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit);
};

export const createForBusiness = async (businessId, data = {}) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const businessExists = await Business.exists({ _id: scopedBusinessId });

  if (!businessExists) {
    throw new ReferenceError("businessId no corresponde a un Business existente");
  }

  return CustomerProfile.create({
    ...pickCreateFields(data),
    business: scopedBusinessId,
  });
};
