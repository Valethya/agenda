import mongoose from "mongoose";
import "dotenv/config";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI no está definido en el archivo .env");
  process.exit(1);
}

async function run() {
  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB conectado.");

    // 1. Obtener los barberos
    const carlos = await User.findOne({ email: "carlos@barberia.com" });
    const mateo = await User.findOne({ email: "mateo@barberia.com" });

    if (!carlos || !mateo) {
      console.error("No se encontraron los barberos Carlos y/o Mateo en la base de datos.");
      return;
    }

    console.log(`Carlos ID: ${carlos._id}`);
    console.log(`Mateo ID: ${mateo._id}`);

    // 2. Actualizar los servicios
    // Corte de Cabello Premium -> Solo Carlos
    await Service.updateOne(
      { name: "Corte de Cabello Premium" },
      { $set: { workers: [carlos._id] } }
    );
    console.log("Corte de Cabello Premium asignado solo a Carlos");

    // Perfilado de Barba + Vaporera -> Solo Mateo
    await Service.updateOne(
      { name: "Perfilado de Barba + Vaporera" },
      { $set: { workers: [mateo._id] } }
    );
    console.log("Perfilado de Barba + Vaporera asignado solo a Mateo");

    // Corte + Barba Combo Completo -> Ambos (Carlos y Mateo)
    await Service.updateOne(
      { name: "Corte + Barba Combo Completo" },
      { $set: { workers: [carlos._id, mateo._id] } }
    );
    console.log("Corte + Barba Combo Completo asignado a ambos");

    // Coloración / Tintura de Cabello -> Solo Carlos
    await Service.updateOne(
      { name: "Coloración / Tintura de Cabello" },
      { $set: { workers: [carlos._id] } }
    );
    console.log("Coloración / Tintura de Cabello asignado solo a Carlos");

    console.log("¡Diferenciación de servicios completada con éxito!");

  } catch (err) {
    console.error("Error durante la actualización:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Conexión a MongoDB cerrada.");
  }
}

run();
