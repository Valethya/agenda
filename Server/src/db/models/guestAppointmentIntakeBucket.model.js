import mongoose from "mongoose";

const guestAppointmentIntakeBucketSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    count: {
      type: Number,
      min: 1,
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

// The bucket is purely an anti-amplification guard. It contains no Business,
// Appointment, email or authority data and expires automatically.
guestAppointmentIntakeBucketSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "guest_appointment_intake_bucket_ttl" },
);

const GuestAppointmentIntakeBucketModel = mongoose.model(
  "GuestAppointmentIntakeBucket",
  guestAppointmentIntakeBucketSchema,
);

export default GuestAppointmentIntakeBucketModel;
