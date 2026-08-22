import mongoose from "mongoose";

// Fila persistente de serialización, no bearer/lease ni authority. El _id se deriva
// de Business + worker + fecha, por lo que la unicidad física de MongoDB sobre _id
// basta y no requiere un índice de cutover adicional.
const appointmentBookingMutexSchema = new mongoose.Schema(
  {
    _id: { type: String },
    version: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const AppointmentBookingMutexModel = mongoose.model(
  "AppointmentBookingMutex",
  appointmentBookingMutexSchema,
);

export default AppointmentBookingMutexModel;
