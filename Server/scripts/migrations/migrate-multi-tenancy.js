import mongoose from "mongoose";
import "dotenv/config";
import Business from "./src/db/models/business.model.js";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";
import Appointment from "./src/db/models/appointment.model.js";
import BusinessConfig from "./src/db/models/businessConfig.model.js";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI no está definido en el archivo .env");
  process.exit(1);
}

async function migrate() {
  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB conectado.");

    // 1. Encontrar o crear la Barbería Central por defecto
    let business = await Business.findOne({ slug: "barberia" });
    if (!business) {
      console.log("Creando negocio 'Barbería Central' (slug: 'barberia')...");
      business = await Business.create({
        name: "Barbería Central",
        slug: "barberia",
        isActive: true,
      });
    }
    console.log(`Negocio asignado: ${business.name} (ID: ${business._id})`);

    // 2. Asociar el usuario Administrador del negocio
    const adminUser = await User.findOne({ email: "admin@barberia.com" });
    if (adminUser) {
      console.log(`Asociando administrador admin@barberia.com con el negocio...`);
      adminUser.business = business._id;
      await adminUser.save();
      
      // Asignar dueño del negocio
      business.owner = adminUser._id;
      await business.save();
    }

    // 3. Asociar trabajadores (Barberos)
    console.log("Asociando barberos (carlos y mateo) con el negocio...");
    const updatedWorkers = await User.updateMany(
      { email: { $in: ["carlos@barberia.com", "mateo@barberia.com"] } },
      { $set: { business: business._id } }
    );
    console.log(`Barberos actualizados: ${updatedWorkers.modifiedCount}`);

    // 4. Asociar todos los Servicios existentes al negocio
    console.log("Asociando servicios al negocio...");
    const updatedServices = await Service.updateMany(
      { business: { $exists: false } },
      { $set: { business: business._id } }
    );
    console.log(`Servicios actualizados: ${updatedServices.modifiedCount}`);

    // Adicionalmente, aseguramos que los servicios del seed anterior también estén vinculados si ya tenían business
    const updatedSeedServices = await Service.updateMany(
      { name: { $in: [
        "Corte de Cabello Premium",
        "Perfilado de Barba + Vaporera",
        "Corte + Barba Combo Completo",
        "Coloración / Tintura de Cabello"
      ] } },
      { $set: { business: business._id } }
    );
    console.log(`Servicios de barbería de semilla re-asociados: ${updatedSeedServices.modifiedCount}`);

    // 5. Asociar todas las Citas existentes al negocio
    console.log("Asociando citas existentes al negocio...");
    const updatedAppointments = await Appointment.updateMany(
      { business: { $exists: false } },
      { $set: { business: business._id } }
    );
    console.log(`Citas actualizadas: ${updatedAppointments.modifiedCount}`);

    // 6. Migrar la Configuración de Negocio (BusinessConfig)
    console.log("Migrando configuración global de negocio a la configuración de 'Barbería Central'...");
    // Buscar la configuración global (que no tiene business o la primera que haya)
    let config = await BusinessConfig.findOne({ business: { $exists: false } });
    if (config) {
      config.business = business._id;
      config.businessName = "Barbería Central";
      await config.save();
      console.log("Configuración global migrada al negocio 'Barbería Central'.");
    } else {
      // Si no hay configuración sin business, verificar si el negocio ya tiene una
      let businessConfig = await BusinessConfig.findOne({ business: business._id });
      if (!businessConfig) {
        console.log("Creando configuración por defecto para 'Barbería Central'...");
        await BusinessConfig.create({
          business: business._id,
          businessName: "Barbería Central",
          workingHours: [
            { dayOfWeek: 1, isOpen: true, startTime: "09:00", endTime: "19:00", breaks: [] },
            { dayOfWeek: 2, isOpen: true, startTime: "09:00", endTime: "19:00", breaks: [] },
            { dayOfWeek: 3, isOpen: true, startTime: "09:00", endTime: "19:00", breaks: [] },
            { dayOfWeek: 4, isOpen: true, startTime: "09:00", endTime: "19:00", breaks: [] },
            { dayOfWeek: 5, isOpen: true, startTime: "09:00", endTime: "19:00", breaks: [] },
            { dayOfWeek: 6, isOpen: false, startTime: "09:00", endTime: "19:00", breaks: [] },
            { dayOfWeek: 0, isOpen: false, startTime: "09:00", endTime: "19:00", breaks: [] }
          ]
        });
      }
    }

    console.log("=========================================");
    console.log("¡MIGRACIÓN A MULTI-TENANCY COMPLETADA!");
    console.log(`Negocio 'barberia' configurado con sus barberos y servicios.`);
    console.log("=========================================");

  } catch (err) {
    console.error("Error durante la migración:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Conexión a MongoDB cerrada.");
  }
}

migrate();
