import mongoose from "mongoose";
import * as communicationRepository from "../../repositories/guestAppointmentCommunicationJob.repository.js";

const appointmentGuestContactSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ["email"],
      required: true,
      immutable: true,
    },
    destination: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320,
      immutable: true,
    },
    firstName: {
      type: String,
      trim: true,
      maxlength: 120,
      immutable: true,
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 120,
      immutable: true,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 64,
      immutable: true,
    },
    provenance: {
      type: String,
      enum: ["guest-booking-input-v1"],
      required: true,
      immutable: true,
    },
    capturedAt: {
      type: Date,
      required: true,
      immutable: true,
    },
  },
  { _id: false, versionKey: false },
);

const appointmentSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El trabajador es obligatorio"],
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: [true, "El servicio es obligatorio"],
    },
    date: {
      type: Date,
      required: [true, "La fecha de la cita es obligatoria"],
    },
    startTime: {
      type: String,
      required: [true, "La hora de inicio es obligatoria"],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de inicio inválido (HH:MM)"],
    },
    endTime: {
      type: String,
      required: [true, "La hora de finalización es obligatoria"],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de finalización inválido (HH:MM)"],
    },
    status: {
      type: String,
      enum: ["pending_payment", "pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partially_paid", "fully_paid", "refunded"],
      default: "unpaid",
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio para la cita es obligatorio"],
      index: true,
    },
    guestContact: {
      type: appointmentGuestContactSchema,
      default: null,
      select: false,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.guestContact;
        return ret;
      },
    },
  }
);

appointmentSchema.pre("validate", function () {
  if (!this.client && !this.guestContact) {
    this.invalidate("client", "La cita requiere client autenticado o guestContact");
  }
});

appointmentSchema.pre("save", async function () {
  if (!this.isNew || !this.guestContact) return;
  const session = this.$session();
  if (!session) return;
  const lifecycleSnapshot = await communicationRepository.buildLifecycleSnapshotInSession({
    businessId: this.business,
    appointment: this,
    lifecycleState: this.status,
    session,
  });
  const jobId = communicationRepository.buildCommunicationJobId({
    event: "booking",
    appointmentId: this._id,
    operationId: this._id,
  });
  await communicationRepository.enqueueInSession({
    jobId,
    businessId: this.business,
    appointmentId: this._id,
    event: "booking",
    lifecycleSnapshot,
    now: new Date(),
    session,
  });
});

appointmentSchema.index(
  { business: 1, worker: 1, date: 1, startTime: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending_payment", "pending", "confirmed", "completed"] },
    },
    name: "appointment_business_worker_date_start_active_unique",
  }
);

const AppointmentModel = mongoose.model("Appointment", appointmentSchema);

export default AppointmentModel;
