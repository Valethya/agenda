import mongoose from "mongoose";
import "dotenv/config";
import Business from "./src/db/models/business.model.js";
import BusinessConfig from "./src/db/models/businessConfig.model.js";

const MONGO_URI = process.env.MONGO_URI;
const targetValue = process.argv[2] === "true";

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    const business = await Business.findOne({ slug: "barberia" });
    if (!business) {
      console.error("No se encontró el negocio 'barberia'.");
      return;
    }
    
    let config = await BusinessConfig.findOne({ business: business._id });
    if (!config) {
      config = new BusinessConfig({ business: business._id });
    }
    
    config.appointmentSettings.autoConfirmLocalBookings = targetValue;
    await config.save();
    console.log(`Configuración actualizada con éxito: 'autoConfirmLocalBookings' = ${targetValue}`);
  } catch (error) {
    console.error("Error al actualizar la configuración:", error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
