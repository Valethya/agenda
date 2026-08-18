import mongoose from "mongoose";

const guestAppointmentIntakeBucketSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    // Bounded SHA-256 fingerprints of scopes admitted in this coarse window.
    // Raw Business/Appointment identifiers are never persisted in the bucket.
    scopeKeys: {
      type: [{ type: String, match: /^[0-9a-f]{64}$/u }],
      default: [],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
  },
);

guestAppointmentIntakeBucketSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "guest_appointment_intake_bucket_ttl" },
);

const GuestAppointmentIntakeBucketModel = mongoose.model(
  "GuestAppointmentIntakeBucket",
  guestAppointmentIntakeBucketSchema,
);

export default GuestAppointmentIntakeBucketModel;
