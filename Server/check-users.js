import mongoose from "mongoose";
import "dotenv/config";
import User from "./src/db/models/user.model.js";
import Shift from "./src/db/models/shift.model.js";
import Business from "./src/db/models/business.model.js";

const MONGO_URI = process.env.MONGO_URI;

async function check() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Conectado a MongoDB");

    // 1. Mostrar negocios
    const businesses = await Business.find();
    console.log("\n=== NEGOCIOS ===");
    businesses.forEach(b => console.log(`- ${b.name} (ID: ${b._id}, Slug: ${b.slug}, Active: ${b.isActive})`));

    // 2. Mostrar Carlos y Mateo
    const workers = await User.find({ role: "worker" });
    console.log("\n=== TRABAJADORES ===");
    workers.forEach(w => {
      console.log(`- ${w.firstName} ${w.lastName} (ID: ${w._id}, Email: ${w.email}, Business: ${w.business})`);
    });

    // 3. Mostrar turnos
    const shifts = await Shift.find();
    console.log(`\n=== TOTAL DE TURNOS EN LA BD: ${shifts.length} ===`);
    if (shifts.length > 0) {
      console.log("Primeros 5 turnos:");
      shifts.slice(0, 5).forEach(s => {
        console.log(`- Worker: ${s.worker}, DayOfWeek: ${s.dayOfWeek}, Open: ${s.isOpen}, Time: ${s.startTime} - ${s.endTime}`);
      });
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

check();
