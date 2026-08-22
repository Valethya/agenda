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
    // Snapshot reportado por el gateway cuando existe una autorización externa.
    // Nunca reemplaza `amount`, que conserva el monto esperado de la transacción local.
    authorizedAmount: {
      type: Number,
      min: [1, "El monto autorizado mínimo es de 1"],
      default: undefined,
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
    // Resultado local de aplicar un pago autorizado a la Appointment. Un Payment
    // approved registra el hecho externo; este campo evita inferir que eso concede
    // authority para reactivar una Appointment que cambió mientras Webpay respondía.
    reconciliationStatus: {
      type: String,
      enum: ["applied", "required"],
      default: undefined,
    },
    reconciliationReason: {
      type: String,
      enum: ["appointment_state_changed", "interval_conflict", "amount_mismatch"],
      default: undefined,
    },
    authorizedAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PaymentModel = mongoose.model("Payment", paymentSchema);

export default PaymentModel;
