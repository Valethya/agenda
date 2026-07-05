import mongoose from "mongoose";
import "dotenv/config";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";
import Shift from "./src/db/models/shift.model.js";
import Business from "./src/db/models/business.model.js";
import { createHash } from "./src/utils/password.js";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI no está definido en el archivo .env");
  process.exit(1);
}

async function seed() {
  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB conectado.");

    // 1. Limpieza de datos antiguos de Atmósfera para hacer el script re-ejecutable
    console.log("Limpiando registros antiguos de Atmósfera...");
    const emailsToCleanup = [
      "admin@atmosfera.com",
      "contacto@atmosfera.com"
    ];
    
    const oldWorkers = await User.find({ email: { $in: emailsToCleanup } });
    const oldWorkerIds = oldWorkers.map(w => w._id);
    
    await Shift.deleteMany({ worker: { $in: oldWorkerIds } });
    await User.deleteMany({ email: { $in: emailsToCleanup } });
    
    const oldBusiness = await Business.findOne({ slug: "atmosfera" });
    if (oldBusiness) {
      await Service.deleteMany({ business: oldBusiness._id });
      await Business.deleteOne({ _id: oldBusiness._id });
      console.log("Negocio anterior de Atmósfera y sus servicios eliminados.");
    }
    
    // 2. Crear el Negocio Atmósfera
    console.log("Creando negocio 'Atmósfera' (slug: 'atmosfera')...");
    const business = await Business.create({
      name: "Atmósfera",
      slug: "atmosfera",
      isActive: true,
    });
    const businessId = business._id;
    console.log(`Negocio Atmósfera creado (ID: ${businessId})`);

    // 3. Crear Usuarios
    console.log("Creando usuarios para Atmósfera...");
    const passwordHashAdmin = await createHash("atmosfera123");
    const passwordHashWorker = await createHash("atmosfera123");

    // Admin
    const admin = await User.create({
      firstName: "Admin",
      lastName: "Atmósfera",
      email: ["admin@atmosfera.com"],
      password: passwordHashAdmin,
      role: "admin",
      phone: ["+56911112222"],
      business: businessId
    });
    console.log("Admin Atmósfera creado: admin@atmosfera.com / atmosfera123");

    // Consultor Atmósfera (Worker)
    const consultor = await User.create({
      firstName: "Consultor",
      lastName: "Atmósfera",
      email: ["contacto@atmosfera.com"],
      password: passwordHashWorker,
      role: "worker",
      phone: ["+56922223333"],
      business: businessId
    });
    console.log("Consultor Atmósfera (Worker) creado: contacto@atmosfera.com / atmosfera123");

    // Asignar admin como dueño del negocio
    business.owner = admin._id;
    await business.save();

    // 4. Crear Turnos (Lunes a Viernes de 09:00 a 18:00 con colación de 13:00 a 14:00)
    console.log("Creando turnos de disponibilidad para el Consultor...");
    const shiftPromises = [];

    // dayOfWeek: 1 (Lunes) a 5 (Viernes)
    for (let day = 1; day <= 5; day++) {
      shiftPromises.push(
        Shift.create({
          worker: consultor._id,
          dayOfWeek: day,
          isOpen: true,
          startTime: "09:00",
          endTime: "18:00",
          breaks: [
            {
              startTime: "13:00",
              endTime: "14:00"
            }
          ],
          business: businessId
        })
      );
    }
    await Promise.all(shiftPromises);
    console.log("Turnos semanales creados para el Consultor.");

    // 5. Crear Servicio "Reunión Online"
    console.log("Creando servicio de Reunión Online...");
    const service = await Service.create({
      name: "Reunión Online",
      description: "Videollamada para analizar los requerimientos de tu proyecto y proponer soluciones.",
      duration: 30, // 30 minutos
      price: 0,
      depositAmount: 0,
      workers: [consultor._id],
      business: businessId
    });
    console.log(`Servicio creado: ${service.name} (ID: ${service._id})`);

    console.log("=========================================");
    console.log("¡SEMBRADO DE DATOS ATMÓSFERA EXITOSO!");
    console.log(`Business ID (slug 'atmosfera'): ${businessId}`);
    console.log(`Worker ID (contacto@atmosfera.com): ${consultor._id}`);
    console.log(`Service ID: ${service._id}`);
    console.log("=========================================");

  } catch (err) {
    console.error("Error durante el sembrado:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Conexión a MongoDB cerrada.");
  }
}

seed();
