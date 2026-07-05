import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: [true, "El pago debe estar asociado a una cita"],
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio para el pago es obligatorio"],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, "El monto del pago es obligatorio"],
      min: [1, "El monto mínimo es de 1"],
    },
    currency: {
      type: String,
      default: "CLP",
    },
    gateway: {
      type: String,
      enum: ["stripe", "mercadopago", "webpay"],
      required: [true, "La pasarela de pago es obligatoria"],
    },
    transactionId: {
      type: String,
      required: [true, "El ID de transacción es obligatorio"],
      unique: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "refunded"],
      required: [true, "El estado del pago es obligatorio"],
    },
    type: {
      type: String,
      enum: ["deposit", "full", "remaining"],
      required: [true, "El tipo de pago es obligatorio"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PaymentModel = mongoose.model("Payment", paymentSchema);

export default PaymentModel;
