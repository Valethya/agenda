import mongoose from "mongoose";
import "dotenv/config";
import Business from "./src/db/models/business.model.js";
import BusinessConfig from "./src/db/models/businessConfig.model.js";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";
import { sendAppointmentConfirmedEmail } from "./src/utils/mailer.js";

const MONGO_URI = process.env.MONGO_URI;

async function test() {
  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB conectado.");

    // 1. Encontrar o crear negocio 'Barbería Central' (slug: 'barberia')
    const business = await Business.findOne({ slug: "barberia" });
    if (!business) {
      console.error("No se encontró el negocio 'Barbería Central'. Por favor corre el seed primero.");
      return;
    }
    console.log(`Negocio encontrado: ${business.name} (${business._id})`);

    // 2. Encontrar o crear configuración del negocio
    let config = await BusinessConfig.findOne({ business: business._id });
    if (!config) {
      console.log("Creando nueva configuración para Barbería Central...");
      config = new BusinessConfig({
        business: business._id,
      });
    }

    // Establecer personalización de marca para el negocio
    config.businessName = "Barbería Central Premium";
    config.emailSettings = {
      brandColor: "#D4AF37", // Color dorado/oro
      logoUrl: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=200&h=60", // Imagen de muestra
      customFooter: "¡Gracias por confiar en Barbería Central! Recuerda que el corte premium incluye lavado y un masaje capilar de cortesía.",
    };

    await config.save();
    console.log("Configuración de correo personalizada guardada en la base de datos.");

    // 3. Obtener un barbero y un servicio para simular la cita
    const carlos = await User.findOne({ email: "carlos@barberia.com" });
    const servicio = await Service.findOne({ name: "Corte de Cabello Premium" });

    if (!carlos || !servicio) {
      console.error("No se encontró al barbero Carlos Gómez o el servicio Premium. Por favor corre el seed.");
      return;
    }

    // 4. Crear detalle de cita simulado
    const appointmentDetail = {
      worker: carlos,
      service: servicio,
      date: new Date("2026-06-09"),
      startTime: "15:30",
      status: "confirmed",
      business: business, // Contiene el ID y slug del negocio
    };

    console.log("\nEnviando correo de confirmación de prueba...");
    await sendAppointmentConfirmedEmail("cliente-prueba@example.com", appointmentDetail);

    console.log("Prueba de correo finalizada con éxito.");

  } catch (error) {
    console.error("Error en la prueba de correo:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Conexión a MongoDB cerrada.");
  }
}

test();
