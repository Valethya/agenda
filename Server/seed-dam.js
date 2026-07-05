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

    // 1. Limpieza de datos antiguos de DAM
    console.log("Limpiando registros antiguos de DAM...");
    const emailsToCleanup = [
      "admin@dam.com",
      "contacto@dam.com"
    ];
    
    const oldWorkers = await User.find({ email: { $in: emailsToCleanup } });
    const oldWorkerIds = oldWorkers.map(w => w._id);
    
    await Shift.deleteMany({ worker: { $in: oldWorkerIds } });
    await User.deleteMany({ email: { $in: emailsToCleanup } });
    await Service.deleteMany({ name: "Conversación de Proyecto", business: { $exists: true } });
    
    // 2. Encontrar o crear el Negocio DAM
    let business = await Business.findOne({ slug: "dam" });
    if (!business) {
      console.log("Creando negocio 'DAM Production' (slug: 'dam')...");
      business = await Business.create({
        name: "DAM Production",
        slug: "dam",
        isActive: true,
      });
    }
    const businessId = business._id;
    console.log(`Negocio DAM creado/encontrado (ID: ${businessId})`);

    // 3. Crear Usuarios
    console.log("Creando usuarios para DAM...");
    const passwordHashAdmin = await createHash("dam123");
    const passwordHashWorker = await createHash("dam123");

    // Admin
    const admin = await User.create({
      firstName: "Admin",
      lastName: "DAM",
      email: ["admin@dam.com"],
      password: passwordHashAdmin,
      role: "admin",
      phone: ["+56900001111"],
      business: businessId
    });
    console.log("Admin DAM creado: admin@dam.com / dam123");

    // Productor DAM (Worker)
    const productor = await User.create({
      firstName: "Productor",
      lastName: "DAM",
      email: ["contacto@dam.com"],
      password: passwordHashWorker,
      role: "worker",
      phone: ["+56900002222"],
      business: businessId
    });
    console.log("Productor DAM (Worker) creado: contacto@dam.com / dam123");

    // Asignar admin como dueño del negocio
    business.owner = admin._id;
    await business.save();

    // 4. Crear Turnos (Lunes a Viernes de 09:00 a 18:00 con colación de 13:00 a 14:00)
    console.log("Creando turnos de disponibilidad para el Productor...");
    const shiftPromises = [];

    // dayOfWeek: 1 (Lunes) a 5 (Viernes)
    for (let day = 1; day <= 5; day++) {
      shiftPromises.push(
        Shift.create({
          worker: productor._id,
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
    console.log("Turnos semanales creados para el Productor.");

    // 5. Crear Servicio "Conversación de Proyecto"
    console.log("Creando servicio de Conversación de Proyecto...");
    const service = await Service.create({
      name: "Conversación de Proyecto",
      description: "Reunión de exploración creativa y asesoría para tu propuesta audiovisual.",
      duration: 45, // 45 minutos
      price: 0,
      depositAmount: 0,
      workers: [productor._id],
      business: businessId
    });
    console.log(`Servicio creado: ${service.name} (ID: ${service._id})`);

    console.log("=========================================");
    console.log("¡SEMBRADO DE DATOS DAM EXITOSO!");
    console.log(`Business ID (slug 'dam'): ${businessId}`);
    console.log(`Worker ID (contacto@dam.com): ${productor._id}`);
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
