import mongoose from "mongoose";
import "dotenv/config";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";
import Shift from "./src/db/models/shift.model.js";
import { getAvailableSlots } from "./src/services/availability.service.js";

const MONGO_URI = process.env.MONGO_URI;

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Conectado a MongoDB");

    // 1. Obtener un barbero
    const carlos = await User.findOne({ email: "carlos@barberia.com" });
    if (!carlos) {
      console.log("No se encontró al barbero Carlos. ¿Corriste el seed?");
      return;
    }
    console.log(`Barbero encontrado: Carlos Gómez (${carlos._id})`);

    // 2. Obtener un servicio
    const servicio = await Service.findOne({ name: "Corte de Cabello Premium" });
    if (!servicio) {
      console.log("No se encontró el servicio Corte Premium.");
      return;
    }
    console.log(`Servicio encontrado: ${servicio.name} (${servicio._id})`);

    // 3. Consultar turnos de Carlos
    const turnos = await Shift.find({ worker: carlos._id });
    console.log(`Carlos tiene ${turnos.length} turnos configurados.`);
    turnos.forEach(t => {
      console.log(`  Día de la semana: ${t.dayOfWeek}, Abierto: ${t.isOpen}, Horas: ${t.startTime} - ${t.endTime}`);
    });

    // 4. Consultar slots para mañana (2026-06-04)
    const dateStr = "2026-06-04"; // Jueves
    console.log(`Consultando slots para la fecha: ${dateStr}...`);
    const slots = await getAvailableSlots(carlos._id, dateStr, servicio._id);
    console.log(`Se encontraron ${slots.length} slots disponibles:`);
    slots.slice(0, 10).forEach(s => {
      console.log(`  Slot: ${s.startTime} - ${s.endTime}`);
    });
    if (slots.length > 10) {
      console.log(`  ... y ${slots.length - 10} más.`);
    }

  } catch (err) {
    console.error("Error en prueba de slots:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Conexión cerrada.");
  }
}

test();
