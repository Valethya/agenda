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

    // 1. Limpieza de datos antiguos de la barbería
    console.log("Limpiando registros antiguos de barberia...");
    const emailsToCleanup = [
      "superadmin@barberia.com",
      "admin@barberia.com",
      "carlos@barberia.com",
      "mateo@barberia.com"
    ];
    
    // Buscar los IDs de los trabajadores a limpiar para borrar también sus turnos
    const oldWorkers = await User.find({ email: { $in: ["carlos@barberia.com", "mateo@barberia.com"] } });
    const oldWorkerIds = oldWorkers.map(w => w._id);
    
    await Shift.deleteMany({ worker: { $in: oldWorkerIds } });
    await User.deleteMany({ email: { $in: emailsToCleanup } });
    await Service.deleteMany({ name: { $in: [
      "Corte de Cabello Premium",
      "Perfilado de Barba + Vaporera",
      "Corte + Barba Combo Completo",
      "Coloración / Tintura de Cabello"
    ] } });
    
    console.log("Limpieza completada.");

    // 0. Encontrar o crear la Barbería Central
    let business = await Business.findOne({ slug: "barberia" });
    if (!business) {
      console.log("Creando negocio 'Barbería Central' (slug: 'barberia')...");
      business = await Business.create({
        name: "Barbería Central",
        slug: "barberia",
        isActive: true,
      });
    }
    const businessId = business._id;
    console.log(`Negocio para asignación: ${business.name} (ID: ${businessId})`);

    // 2. Crear Usuarios
    console.log("Creando usuarios...");
    const passwordHashSuper = await createHash("superadmin123");
    const passwordHashAdmin = await createHash("admin123");
    const passwordHashBarber = await createHash("barbero123");

    // Superadmin
    const superadmin = await User.create({
      firstName: "Valenthya",
      lastName: "Superadmin",
      email: ["superadmin@barberia.com"],
      password: passwordHashSuper,
      role: "superadmin",
      phone: ["+56999998888"]
    });
    console.log("Superadmin creado: superadmin@barberia.com / superadmin123");

    // Admin
    const admin = await User.create({
      firstName: "Pedro",
      lastName: "Admin Barbería",
      email: ["admin@barberia.com"],
      password: passwordHashAdmin,
      role: "admin",
      phone: ["+56912345678"],
      business: businessId
    });
    console.log("Admin creado: admin@barberia.com / admin123");

    // Barbero Carlos
    const carlos = await User.create({
      firstName: "Carlos",
      lastName: "Gómez",
      email: ["carlos@barberia.com"],
      password: passwordHashBarber,
      role: "worker",
      phone: ["+56988887777"],
      business: businessId
    });

    // Barbero Mateo
    const mateo = await User.create({
      firstName: "Mateo",
      lastName: "Díaz",
      email: ["mateo@barberia.com"],
      password: passwordHashBarber,
      role: "worker",
      phone: ["+56977776666"],
      business: businessId
    });
    console.log("Trabajadores creados: carlos@barberia.com y mateo@barberia.com / barbero123");

    // Asignar admin como dueño del negocio
    business.owner = admin._id;
    await business.save();

    // 3. Crear Turnos (Lunes a Viernes de 09:00 a 19:00 con colación de 13:00 a 14:00)
    console.log("Creando turnos de disponibilidad...");
    const workers = [carlos, mateo];
    const shiftPromises = [];

    for (const worker of workers) {
      // dayOfWeek: 1 (Lunes) a 5 (Viernes)
      for (let day = 1; day <= 5; day++) {
        shiftPromises.push(
          Shift.create({
            worker: worker._id,
            dayOfWeek: day,
            isOpen: true,
            startTime: "09:00",
            endTime: "19:00",
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
    }
    await Promise.all(shiftPromises);
    console.log("Turnos semanales creados exitosamente para los barberos (Lunes a Viernes).");

    // 4. Crear Servicios asociados a los barberos
    console.log("Creando servicios...");
    const barberIds = [carlos._id, mateo._id];

    await Service.create([
      {
        name: "Corte de Cabello Premium",
        description: "Lavado previo, corte personalizado a tijera/máquina, peinado y producto estilizador.",
        duration: 30,
        price: 15000,
        depositAmount: 3000,
        workers: barberIds,
        business: businessId
      },
      {
        name: "Perfilado de Barba + Vaporera",
        description: "Diseño de barba, toalla húmeda, afeitado con navaja tradicional y bálsamo hidratante.",
        duration: 30,
        price: 10000,
        depositAmount: 2000,
        workers: barberIds,
        business: businessId
      },
      {
        name: "Corte + Barba Combo Completo",
        description: "Servicio completo que incluye el corte de cabello premium y el perfilado de barba.",
        duration: 60,
        price: 22000,
        depositAmount: 5000,
        workers: barberIds,
        business: businessId
      },
      {
        name: "Coloración / Tintura de Cabello",
        description: "Cambio de color o cobertura de canas con productos premium especiales para cabello masculino.",
        duration: 90,
        price: 30000,
        depositAmount: 8000,
        workers: barberIds,
        business: businessId
      }
    ]);
    console.log("Servicios de barbería creados y asociados a los barberos.");

    console.log("=========================================");
    console.log("¡SEMBRADO DE DATOS EXITOSO!");
    console.log("Cuentas listas para probar:");
    console.log("- Superadmin: superadmin@barberia.com / superadmin123");
    console.log("- Admin Barbería: admin@barberia.com / admin123");
    console.log("- Barbero Carlos: carlos@barberia.com / barbero123");
    console.log("- Barbero Mateo: mateo@barberia.com / barbero123");
    console.log("=========================================");

  } catch (err) {
    console.error("Error durante el sembrado:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Conexión a MongoDB cerrada.");
  }
}

seed();
