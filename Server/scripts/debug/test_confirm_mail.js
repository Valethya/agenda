import mongoose from "mongoose";
import { confirmAppointment } from "./src/services/appointment.service.js";
import Appointment from "./src/db/models/appointment.model.js";
import logger from "./src/config/logger.js";

const MONGO_URI = "mongodb+srv://valethya:guraJkMN7JzWv1kW@prisma.ya5dejb.mongodb.net/agenda?appName=Prisma";

// Capturar logs para ver qué intenta hacer el mailer
const logs = [];
logger.info = (msg) => {
  console.log("[LOG INFO]", msg);
  logs.push({ level: "info", msg });
};
logger.error = (msg) => {
  console.error("[LOG ERROR]", msg);
  logs.push({ level: "error", msg });
};

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const appointmentId = "6a4d3ef85f64c53174533140";
    
    // 1. Forzar estado a "pending" primero
    await Appointment.findByIdAndUpdate(appointmentId, { status: "pending" });
    console.log("Forced appointment status to pending");

    // 2. Ejecutar confirmación
    console.log("Running confirmAppointment service...");
    const result = await confirmAppointment(
      appointmentId,
      "6a4d3ffc2efdfcbc0ac7ba80", // ID del Admin DAM
      "admin"
    );
    console.log("confirmAppointment executed. Waiting 8 seconds for setImmediate mailer to finish...");

    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log("\n--- CAPTURED MAILER LOGS ---");
    console.log(JSON.stringify(logs, null, 2));

  } catch (err) {
    console.error("Error during test:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected");
  }
}

test();
