import "dotenv/config";
import mongoose from "mongoose";
import AuditLog from "../../src/db/models/auditLog.model.js";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  throw new Error("MONGO_URI es obligatoria para ejecutar check_audit_logs.js");
}

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const appointmentId = "6a4d3ef85f64c53174533140";
    console.log(`Fetching audit logs for appointment ${appointmentId}...`);

    const logs = await AuditLog.find({ appointmentId }).sort({ createdAt: 1 });
    console.log(`\nFound ${logs.length} log events:`);

    logs.forEach((log) => {
      console.log(`\n[${log.createdAt.toISOString()}] Event: ${log.event} (${log.level})`);
      console.log(`Message: ${log.message}`);
      if (log.technicalMessage) {
        console.log(`Technical Message: ${log.technicalMessage}`);
      }
      if (log.metadata) {
        console.log("Metadata:", JSON.stringify(log.metadata, null, 2));
      }
    });
  } catch (err) {
    console.error("Error fetching audit logs:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected");
  }
}

run();
