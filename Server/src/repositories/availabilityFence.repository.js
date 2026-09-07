import mongoose from "mongoose";
import AppointmentBookingMutex from "../db/models/appointmentBookingMutex.model.js";

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
const id = (value) => value?.toString?.() || String(value);

export const shiftAvailabilityFenceId = (businessId, workerId, dayOfWeek) =>
  `availability:shift:${id(businessId)}:${id(workerId)}:${dayOfWeek}`;

export const blockAvailabilityFenceId = (businessId, workerId, date) =>
  `availability:block:${id(businessId)}:${id(workerId)}:${dateKey(date)}`;

export const holidayAvailabilityFenceId = (date) =>
  `availability:holiday:${dateKey(date)}`;

export const businessConfigAvailabilityFenceId = (businessId) =>
  `availability:config:${id(businessId)}`;

export const canonicalAvailabilityFenceIds = ({ businessId, workerId, date }) => {
  const target = new Date(date);
  return [
    shiftAvailabilityFenceId(businessId, workerId, target.getUTCDay()),
    blockAvailabilityFenceId(businessId, workerId, target),
    holidayAvailabilityFenceId(target),
    businessConfigAvailabilityFenceId(businessId),
  ].sort();
};

export const ensureAvailabilityFenceRows = async (fenceIds) => {
  const ids = [...new Set(fenceIds)].sort();
  await Promise.all(ids.map(async (fenceId) => {
    try {
      await AppointmentBookingMutex.updateOne(
        { _id: fenceId },
        { $setOnInsert: { version: 0 } },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }));
  return ids;
};

export const acquireAvailabilityFenceRowsInSession = async (fenceIds, session) => {
  if (!session) throw new TypeError("La session es obligatoria para adquirir fences de disponibilidad");
  const ids = [...new Set(fenceIds)].sort();
  for (const fenceId of ids) {
    const fence = await AppointmentBookingMutex.findOneAndUpdate(
      { _id: fenceId },
      { $inc: { version: 1 } },
      { new: true, session },
    );
    if (!fence) throw new Error("No se pudo adquirir el fence de disponibilidad");
  }
};

export const withAvailabilityMutationFences = async (fenceIds, work) => {
  const ids = await ensureAvailabilityFenceRows(fenceIds);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await acquireAvailabilityFenceRowsInSession(ids, session);
      result = await work(session);
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    return result;
  } finally {
    await session.endSession();
  }
};
