import mongoose from "mongoose";
import "dotenv/config";
import Business from "./src/db/models/business.model.js";
import BusinessConfig from "./src/db/models/businessConfig.model.js";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";
import Appointment from "./src/db/models/appointment.model.js";
import { bookAppointment } from "./src/services/appointment.service.js";

const MONGO_URI = process.env.MONGO_URI;

async function runTest() {
  let testServiceId;
  let clientUser;
  const createdAppointments = [];

  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB conectado.");

    // 1. Encontrar negocio y barbero
    const business = await Business.findOne({ slug: "barberia" });
    const carlos = await User.findOne({ email: "carlos@barberia.com" });
    if (!business || !carlos) {
      console.error("No se encontró el negocio 'barberia' o el barbero Carlos. Corre el seed primero.");
      return;
    }

    // 2. Encontrar o crear cliente
    clientUser = await User.findOne({ "email.0": "test-client-auto@example.com" });
    if (!clientUser) {
      clientUser = await User.create({
        firstName: "Diego",
        lastName: "Pruebas",
        email: ["test-client-auto@example.com"],
        phone: ["+56955554444"],
        password: "password123",
      });
    }

    // 3. Crear un servicio de prueba sin abono requerido (depositAmount: 0)
    console.log("Creando servicio de prueba sin abono...");
    const testService = await Service.create({
      name: "Corte Express Test AutoConfirm",
      description: "Servicio rápido de prueba",
      duration: 30,
      price: 8000,
      depositAmount: 0,
      workers: [carlos._id],
      business: business._id,
      isActive: true
    });
    testServiceId = testService._id;

    // 4. Encontrar o crear configuración del negocio
    let config = await BusinessConfig.findOne({ business: business._id });
    if (!config) {
      config = new BusinessConfig({ business: business._id });
    }

    // ==========================================
    // CASO A: autoConfirmLocalBookings = TRUE
    // ==========================================
    console.log("\n--- CASO A: Probando con autoConfirmLocalBookings = TRUE ---");
    config.appointmentSettings.autoConfirmLocalBookings = true;
    await config.save();

    const apptA = await bookAppointment({
      client: clientUser._id,
      worker: carlos._id,
      service: testService._id,
      date: new Date("2026-06-11"),
      startTime: "11:00",
      notes: "Prueba con auto-confirmacion activa",
    });
    createdAppointments.push(apptA._id);

    console.log(`Resultado Caso A: Cita Creada ID: ${apptA._id}`);
    console.log(`Estado Inicial en Base de Datos: '${apptA.status}'`);
    if (apptA.status === "confirmed") {
      console.log("✅ ÉXITO: La cita se auto-confirmó directamente!");
    } else {
      console.error("❌ ERROR: La cita debería haberse auto-confirmado.");
    }

    // ==========================================
    // CASO B: autoConfirmLocalBookings = FALSE
    // ==========================================
    console.log("\n--- CASO B: Probando con autoConfirmLocalBookings = FALSE ---");
    config.appointmentSettings.autoConfirmLocalBookings = false;
    await config.save();

    const apptB = await bookAppointment({
      client: clientUser._id,
      worker: carlos._id,
      service: testService._id,
      date: new Date("2026-06-11"),
      startTime: "12:00", // Diferente horario para evitar colisiones
      notes: "Prueba con auto-confirmacion inactiva",
    });
    createdAppointments.push(apptB._id);

    console.log(`Resultado Caso B: Cita Creada ID: ${apptB._id}`);
    console.log(`Estado Inicial en Base de Datos: '${apptB.status}'`);
    if (apptB.status === "pending") {
      console.log("✅ ÉXITO: La cita se registró como pendiente y envió alerta al barbero!");
    } else {
      console.error("❌ ERROR: La cita debería haber quedado pendiente.");
    }

  } catch (error) {
    console.error("Error durante las pruebas:", error);
  } finally {
    // Limpieza de datos de prueba
    console.log("\nLimpiando datos de prueba...");
    if (testServiceId) {
      await Service.deleteOne({ _id: testServiceId });
    }
    if (createdAppointments.length > 0) {
      await Appointment.deleteMany({ _id: { $in: createdAppointments } });
    }
    if (clientUser) {
      await User.deleteOne({ _id: clientUser._id });
    }
    await mongoose.disconnect();
    console.log("Conexión a MongoDB cerrada.");
  }
}

runTest();
