import mongoose from "mongoose";
import Service from "../db/models/service.model.js";
import Membership from "../db/models/membership.model.js";

const MUTABLE_SERVICE_FIELDS = Object.freeze([
  "name",
  "description",
  "duration",
  "price",
  "depositAmount",
  "workers",
  "isActive",
]);
const BOOKING_RELEVANT_SERVICE_FIELDS = new Set([
  "duration",
  "depositAmount",
  "workers",
  "isActive",
]);

const pickMutableServiceFields = (data = {}) => {
  const update = {};
  for (const field of MUTABLE_SERVICE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      update[field] = data[field];
    }
  }
  return update;
};

const asIdStrings = (values = []) => values.map((value) => value?._id?.toString?.() || value?.toString?.()).filter(Boolean);

export const findAll = async (query = {}) => {
  return await Service.find(query).populate("workers", "firstName lastName email phone");
};

export const findById = async (id) => {
  return await Service.findById(id).populate("workers", "firstName lastName email phone");
};

export const findByIdAndBusiness = async (
  id,
  businessId,
  { onlyActive = false, session = null } = {},
) => {
  const query = { _id: id, business: businessId };
  if (onlyActive) query.isActive = true;

  return await Service.findOne(query)
    .session(session || null)
    .populate("workers", "firstName lastName email phone");
};

export const findByName = async (name, businessId) => {
  return await Service.findOne({ name, business: businessId });
};

export const create = async (data) => {
  return await Service.create(data);
};

export const updateMutableByIdAndBusiness = async (id, businessId, data) => {
  const mutableUpdate = pickMutableServiceFields(data);
  const touchesBookingEligibility = Object.keys(mutableUpdate)
    .some((field) => BOOKING_RELEVANT_SERVICE_FIELDS.has(field));

  if (!touchesBookingEligibility) {
    return await Service.findOneAndUpdate(
      { _id: id, business: businessId },
      { $set: mutableUpdate },
      { new: true, runValidators: true },
    );
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const current = await Service.findOne({ _id: id, business: businessId }).session(session);
      if (!current) return;

      const affectedWorkers = new Set(asIdStrings(current.workers));
      if (Object.prototype.hasOwnProperty.call(mutableUpdate, "workers")) {
        for (const workerId of asIdStrings(mutableUpdate.workers)) affectedWorkers.add(workerId);
      }

      if (affectedWorkers.size > 0) {
        // El Service puede afectar a varios workers, pero cada booking sólo
        // escribe su propia Membership. La mutación administrativa participa
        // en todos los fences afectados sin serializar bookings entre sí.
        await Membership.updateMany(
          { business: businessId, user: { $in: [...affectedWorkers] } },
          { $inc: { bookingEligibilityRevision: 1 } },
          { session },
        );
      }

      result = await Service.findOneAndUpdate(
        { _id: id, business: businessId },
        { $set: mutableUpdate },
        { new: true, runValidators: true, session },
      );
    });
    return result;
  } finally {
    await session.endSession();
  }
};
