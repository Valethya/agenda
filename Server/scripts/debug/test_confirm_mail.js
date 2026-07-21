import "dotenv/config";
import mongoose from "mongoose";
import { confirmAppointment } from "../../src/services/appointment.service.js";
import Appointment from "../../src/db/models/appointment.model.js";
import logger from "../../src/config/logger.js";

const { MONGO_URI, APPOINTMENT_ID, ADMIN_USER_ID } = process.env;
const missingEnvironmentVariables = [
  ["MONGO_URI", MONGO_URI],
  ["APPOINTMENT_ID", APPOINTMENT_ID],
  ["ADMIN_USER_ID", ADMIN_USER_ID],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `${missingEnvironmentVariables.join(", ")} son obligatorias para ejecutar test_confirm_mail.js`,
  );
}

// Capturar logs para ver qué intenta hacer el mailer.
const logs = [];
logger.info = (msg) => {
  console.log("[LOG INFO]", msg);
  logs.push({ level: "info", msg });
};
logger.error = (msg) => {
  console.error("[LOG ERROR]", msg);
  logs.push({ level: "error", msg });
};

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    await Appointment.findByIdAndUpdate(APPOINTMENT_ID, { status: "pending" });
    console.log("Forced appointment status to pending");

    console.log("Running confirmAppointment service...");
    await confirmAppointment(
      APPOINTMENT_ID,
      ADMIN_USER_ID,
      "admin",
    );
    console.log("confirmAppointment executed. Waiting 8 seconds for setImmediate mailer to finish...");

    await new Promise((resolve) => setTimeout(resolve, 8000));

    console.log("\n--- CAPTURED MAILER LOGS ---");
    console.log(JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error("Error during test:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected");
  }
}

run();
