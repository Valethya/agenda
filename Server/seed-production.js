import mongoose from "mongoose";
import "dotenv/config";
import User from "./src/db/models/user.model.js";
import Service from "./src/db/models/service.model.js";
import Shift from "./src/db/models/shift.model.js";
import Appointment from "./src/db/models/appointment.model.js";
import Payment from "./src/db/models/payment.model.js";
import AuditLog from "./src/db/models/auditLog.model.js";
import Business from "./src/db/models/business.model.js";
import { createHash } from "./src/utils/password.js";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI no está definido en el archivo .env");
  process.exit(1);
}

// 25 Realistic Clients
const CLIENTS_DATA = [
  { firstName: "Sofía", lastName: "Rodríguez", email: "sofia.rodriguez@gmail.com", phone: "+56991112222" },
  { firstName: "Mateo", lastName: "Fernández", email: "mateo.f@outlook.com", phone: "+56992223333" },
  { firstName: "Valentina", lastName: "Rojas", email: "valerajas@gmail.com", phone: "+56993334444" },
  { firstName: "Lucas", lastName: "Muñoz", email: "lucas.munoz@yahoo.com", phone: "+56994445555" },
  { firstName: "Martina", lastName: "Pérez", email: "marti.perez@gmail.com", phone: "+56995556666" },
  { firstName: "Benjamín", lastName: "Soto", email: "benja.soto@gmail.com", phone: "+56996667777" },
  { firstName: "Florencia", lastName: "Silva", email: "flo.silva@outlook.com", phone: "+56997778888" },
  { firstName: "Tomás", lastName: "Contreras", email: "tomas.c@gmail.com", phone: "+56998889999" },
  { firstName: "Isidora", lastName: "Morales", email: "isi.morales@gmail.com", phone: "+56991234567" },
  { firstName: "Joaquín", lastName: "Herrera", email: "joaco.herrera@gmail.com", phone: "+56992345678" },
  { firstName: "Camila", lastName: "Fuentes", email: "camila.fuentes@gmail.com", phone: "+56993456789" },
  { firstName: "Agustín", lastName: "Valenzuela", email: "agustin.val@gmail.com", phone: "+56994567890" },
  { firstName: "Catalina", lastName: "González", email: "cata.gonzalez@gmail.com", phone: "+56995678901" },
  { firstName: "Vicente", lastName: "Araya", email: "vicente.araya@gmail.com", phone: "+56996789012" },
  { firstName: "Emilia", lastName: "Martínez", email: "emilia.m@gmail.com", phone: "+56997890123" },
  { firstName: "Maximiliano", lastName: "López", email: "max.lopez@gmail.com", phone: "+56998901234" },
  { firstName: "Fernanda", lastName: "Díaz", email: "fernanda.diaz@gmail.com", phone: "+56999012345" },
  { firstName: "Gaspar", lastName: "Castro", email: "gaspar.c@gmail.com", phone: "+56990123456" },
  { firstName: "Antonia", lastName: "Vargas", email: "anto.vargas@gmail.com", phone: "+56991230987" },
  { firstName: "Alonso", lastName: "Guzmán", email: "alonso.g@gmail.com", phone: "+56992341098" },
  { firstName: "Ignacia", lastName: "Miranda", email: "ignacia.m@gmail.com", phone: "+56993452109" },
  { firstName: "Matías", lastName: "Henríquez", email: "matias.h@gmail.com", phone: "+56994563210" },
  { firstName: "Javiera", lastName: "Cárdenas", email: "javiera.c@gmail.com", phone: "+56995674321" },
  { firstName: "Sebastián", lastName: "Pino", email: "seba.pino@gmail.com", phone: "+56996785432" },
  { firstName: "Diego", lastName: "Torres", email: "diego.torres@gmail.com", phone: "+56997896543" }
];

// 6 Workers
const WORKERS_DATA = [
  { firstName: "Carlos", lastName: "Gómez", email: "carlos@barberia.com", popularity: 1.3 },
  { firstName: "Mateo", lastName: "Díaz", email: "mateo@barberia.com", popularity: 0.7 },
  { firstName: "Sofía", lastName: "Castro", email: "sofia@barberia.com", popularity: 1.3 },
  { firstName: "Lucas", lastName: "Silva", email: "lucas@barberia.com", popularity: 0.7 },
  { firstName: "Javier", lastName: "Ortiz", email: "javier@barberia.com", popularity: 1.0 },
  { firstName: "Elena", lastName: "Muñoz", email: "elena@barberia.com", popularity: 1.0 }
];

// 6 Services
const SERVICES_DATA = [
  { name: "Lavado e Hidratación Capilar", duration: 15, price: 8000, depositAmount: 2000, weight: 1.5 },
  { name: "Corte Clásico", duration: 30, price: 12000, depositAmount: 3000, weight: 4.0 },
  { name: "Afeitado y Toalla Caliente", duration: 45, price: 15000, depositAmount: 4000, weight: 2.0 },
  { name: "Corte + Barba Premium", duration: 60, price: 22000, depositAmount: 5000, weight: 3.5 },
  { name: "Coloración Completa", duration: 90, price: 32000, depositAmount: 8000, weight: 1.0 },
  { name: "Tratamiento Facial Purificante", duration: 120, price: 40000, depositAmount: 10000, weight: 0.8 }
];

// Helper: parse HH:MM to minutes
function timeToMins(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Helper: format minutes to HH:MM
function minsToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

async function seed() {
  try {
    console.log("Conectando a MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB conectado.");

    // 1. Obtener o crear negocio
    let business = await Business.findOne({ slug: "barberia" });
    if (!business) {
      business = await Business.create({
        name: "Barbería Central",
        slug: "barberia",
        isActive: true,
      });
    }
    const bId = business._id;
    console.log(`Negocio asignado: ${business.name} (${bId})`);

    // 2. Limpieza profunda
    console.log("Limpiando colecciones para repoblar...");
    await Appointment.deleteMany({ business: bId });
    await Payment.deleteMany({ business: bId });
    await Shift.deleteMany({ business: bId });
    await Service.deleteMany({ business: bId });
    await AuditLog.deleteMany({});
    
    // Eliminar trabajadores y clientes anteriores
    const workerEmails = WORKERS_DATA.map(w => w.email);
    const clientEmails = CLIENTS_DATA.map(c => c.email);
    await User.deleteMany({ 
      $or: [
        { email: { $in: workerEmails } },
        { email: { $in: clientEmails } },
        { role: "user" }
      ]
    });
    console.log("Limpieza completada.");

    // 3. Crear trabajadores (en memoria primero)
    console.log("Preparando trabajadores en memoria...");
    const hashPassword = await createHash("barbero123");
    const workers = [];
    for (const wData of WORKERS_DATA) {
      workers.push({
        _id: new mongoose.Types.ObjectId(),
        firstName: wData.firstName,
        lastName: wData.lastName,
        email: [wData.email],
        password: hashPassword,
        role: "worker",
        phone: [`+569${Math.floor(10000000 + Math.random() * 90000000)}`],
        business: bId,
        isActive: true,
        popularity: wData.popularity // transient property
      });
    }

    // 4. Crear turnos laborales (en memoria)
    console.log("Preparando turnos laborales en memoria...");
    const shifts = [];
    for (const w of workers) {
      if (w.email.includes("carlos@barberia.com") || w.email.includes("mateo@barberia.com")) {
        // Lunes a Viernes 09:00 a 19:00 con almuerzo 13:00 a 14:00
        for (let day = 1; day <= 5; day++) {
          shifts.push({
            _id: new mongoose.Types.ObjectId(),
            worker: w._id,
            dayOfWeek: day,
            isOpen: true,
            startTime: "09:00",
            endTime: "19:00",
            breaks: [{ startTime: "13:00", endTime: "14:00" }],
            business: bId
          });
        }
      } else if (w.email.includes("sofia@barberia.com") || w.email.includes("lucas@barberia.com")) {
        // Miércoles a Sábado 10:00 a 20:00 con almuerzo 14:00 a 15:00
        for (let day = 3; day <= 6; day++) {
          shifts.push({
            _id: new mongoose.Types.ObjectId(),
            worker: w._id,
            dayOfWeek: day,
            isOpen: true,
            startTime: "10:00",
            endTime: "20:00",
            breaks: [{ startTime: "14:00", endTime: "15:00" }],
            business: bId
          });
        }
      } else {
        // Javier & Elena: Jueves a Sábado 09:00 a 19:00 (almuerzo 13:00-14:00) y Domingo 10:00 a 16:00 (sin almuerzo)
        for (let day = 4; day <= 6; day++) {
          shifts.push({
            _id: new mongoose.Types.ObjectId(),
            worker: w._id,
            dayOfWeek: day,
            isOpen: true,
            startTime: "09:00",
            endTime: "19:00",
            breaks: [{ startTime: "13:00", endTime: "14:00" }],
            business: bId
          });
        }
        // Domingo
        shifts.push({
          _id: new mongoose.Types.ObjectId(),
          worker: w._id,
          dayOfWeek: 0,
          isOpen: true,
          startTime: "10:00",
          endTime: "16:00",
          breaks: [],
          business: bId
        });
      }
    }

    // 5. Crear catálogo de servicios (en memoria)
    console.log("Preparando catálogo de servicios en memoria...");
    const services = [];
    const workerIds = workers.map(w => w._id);
    
    for (const sData of SERVICES_DATA) {
      let allowedWorkers = workerIds;
      if (sData.name === "Afeitado y Toalla Caliente") {
        allowedWorkers = workers.filter(w => !w.email.includes("sofia@barberia.com") && !w.email.includes("lucas@barberia.com")).map(w => w._id);
      } else if (sData.name === "Coloración Completa") {
        allowedWorkers = workers.filter(w => w.email.includes("sofia@barberia.com") || w.email.includes("lucas@barberia.com") || w.email.includes("elena@barberia.com")).map(w => w._id);
      } else if (sData.name === "Tratamiento Facial Purificante") {
        allowedWorkers = workers.filter(w => !w.email.includes("carlos@barberia.com") && !w.email.includes("mateo@barberia.com")).map(w => w._id);
      }

      services.push({
        _id: new mongoose.Types.ObjectId(),
        name: sData.name,
        description: `Servicio profesional de ${sData.name.toLowerCase()} con productos de la mejor calidad.`,
        duration: sData.duration,
        price: sData.price,
        depositAmount: sData.depositAmount,
        workers: allowedWorkers,
        business: bId,
        isActive: true,
        weight: sData.weight // transient
      });
    }

    // 6. Crear clientes (en memoria)
    console.log("Preparando clientes en memoria...");
    const clients = [];
    const clientPassword = await createHash("cliente123");
    
    for (const cData of CLIENTS_DATA) {
      clients.push({
        _id: new mongoose.Types.ObjectId(),
        firstName: cData.firstName,
        lastName: cData.lastName,
        email: [cData.email],
        password: clientPassword,
        role: "user",
        phone: [cData.phone],
        business: bId,
        isActive: true
      });
    }

    // 7. Generar citas en memoria
    console.log("Simulando agenda en memoria...");
    
    const todayDate = new Date("2026-06-30");
    const startDate = new Date(todayDate);
    startDate.setMonth(todayDate.getMonth() - 2);
    const endDate = new Date(todayDate);
    endDate.setMonth(todayDate.getMonth() + 2);

    const appointments = [];
    const payments = [];
    const auditLogs = [];
    
    const clientWeightList = clients.map((c, idx) => ({
      client: c,
      weight: idx < 5 ? 8 : (idx < 15 ? 3 : 1)
    }));

    const selectWeightedClient = () => {
      const totalW = clientWeightList.reduce((sum, item) => sum + item.weight, 0);
      let r = Math.random() * totalW;
      for (const item of clientWeightList) {
        r -= item.weight;
        if (r <= 0) return item.client;
      }
      return clients[0];
    };

    const selectWeightedService = (availableServices) => {
      const totalW = availableServices.reduce((sum, s) => sum + (s.weight || 1), 0);
      let r = Math.random() * totalW;
      for (const s of availableServices) {
        r -= (s.weight || 1);
        if (r <= 0) return s;
      }
      return availableServices[0];
    };

    const loopDate = new Date(startDate);
    const reservations = new Map();

    while (loopDate <= endDate) {
      const dayOfWeek = loopDate.getDay();
      const dateStr = loopDate.toISOString().split('T')[0];

      let baseVolume = 3;
      if (dayOfWeek === 0) baseVolume = 0.5;
      else if (dayOfWeek === 5 || dayOfWeek === 6) baseVolume = 6;

      const activeWorkers = [];
      for (const w of workers) {
        const hasShift = shifts.find(s => s.worker.toString() === w._id.toString() && s.dayOfWeek === dayOfWeek && s.isOpen);
        if (hasShift) {
          activeWorkers.push({ worker: w, shift: hasShift });
        }
      }

      for (const { worker, shift } of activeWorkers) {
        const workerVolume = Math.floor(baseVolume * (worker.popularity || 1));
        const resKey = `${worker._id}_${dateStr}`;
        if (!reservations.has(resKey)) {
          reservations.set(resKey, []);
        }
        const workerRes = reservations.get(resKey);

        const shiftStartM = timeToMins(shift.startTime);
        const shiftEndM = timeToMins(shift.endTime);
        const breaksM = shift.breaks.map(b => ({
          start: timeToMins(b.startTime),
          end: timeToMins(b.endTime)
        }));

        let appsScheduledToday = 0;
        let attempts = 0;

        while (appsScheduledToday < workerVolume && attempts < 50) {
          attempts++;

          const workerServices = services.filter(s => s.workers.some(wId => wId.toString() === worker._id.toString()));
          if (workerServices.length === 0) continue;
          const service = selectWeightedService(workerServices);
          const duration = service.duration;

          const totalIntervals = (shiftEndM - shiftStartM - duration) / 15;
          if (totalIntervals <= 0) continue;

          const intervals = [];
          for (let i = 0; i <= totalIntervals; i++) {
            const startM = shiftStartM + i * 15;
            const endM = startM + duration;
            
            const overlapsColacion = breaksM.some(b => 
              (startM >= b.start && startM < b.end) || 
              (endM > b.start && endM <= b.end) || 
              (startM <= b.start && endM >= b.end)
            );
            if (overlapsColacion) continue;

            const startHour = startM / 60;
            let weight = 2;
            if (startHour >= 10 && startHour < 13) weight = 10;
            if (startHour >= 13 && startHour < 15) weight = 0.5;
            if (startHour >= 16 && startHour < 19) weight = 10;
            if (startHour >= 19) weight = 1;
            
            intervals.push({ startM, endM, weight });
          }

          if (intervals.length === 0) continue;

          const selectInterval = () => {
            const totalW = intervals.reduce((sum, item) => sum + item.weight, 0);
            let r = Math.random() * totalW;
            for (const item of intervals) {
              r -= item.weight;
              if (r <= 0) return item;
            }
            return intervals[0];
          };

          const chosenSlot = selectInterval();
          const startM = chosenSlot.startM;
          const endM = chosenSlot.endM;

          const overlapsCita = workerRes.some(r => 
            (startM >= r.start && startM < r.end) || 
            (endM > r.start && endM <= r.end) || 
            (startM <= r.start && endM >= r.end)
          );

          if (overlapsCita) continue;

          workerRes.push({ start: startM, end: endM });
          appsScheduledToday++;

          const client = selectWeightedClient();
          const startTime = minsToTime(startM);
          const endTime = minsToTime(endM);

          const isPast = loopDate < todayDate;
          let status = "confirmed";
          if (isPast) {
            status = Math.random() < 0.90 ? "completed" : "cancelled";
          } else {
            const rVal = Math.random();
            if (rVal < 0.65) status = "confirmed";
            else if (rVal < 0.90) status = "pending";
            else status = "cancelled";
          }

          let notes = "";
          if (Math.random() < 0.15) {
            notes = `Cita reagendada de fecha anterior a solicitud del cliente.`;
          } else if (Math.random() < 0.1) {
            notes = `Cliente solicita corte degradado texturizado con tijera.`;
          }

          let paymentStatus = "unpaid";
          if (status === "completed") {
            paymentStatus = Math.random() < 0.95 ? "fully_paid" : "partially_paid";
          } else if (status === "confirmed") {
            paymentStatus = Math.random() < 0.60 ? "partially_paid" : "unpaid";
          } else if (status === "cancelled") {
            paymentStatus = Math.random() < 0.30 ? "refunded" : "unpaid";
          }

          const appId = new mongoose.Types.ObjectId();
          
          appointments.push({
            _id: appId,
            client: client._id,
            worker: worker._id,
            service: service._id,
            date: new Date(loopDate),
            startTime,
            endTime,
            status,
            paymentStatus,
            business: bId,
            notes
          });

          // Crear pago si corresponde
          if (paymentStatus !== "unpaid") {
            let amount = service.price;
            let type = "full";
            if (paymentStatus === "partially_paid") {
              amount = service.depositAmount;
              type = "deposit";
            }
            
            const gateways = ["webpay", "mercadopago", "stripe"];
            const payStatus = paymentStatus === "refunded" ? "refunded" : "approved";

            payments.push({
              _id: new mongoose.Types.ObjectId(),
              appointment: appId,
              business: bId,
              amount,
              gateway: gateways[Math.floor(Math.random() * gateways.length)],
              transactionId: `TX_${Date.now()}_${Math.floor(1000 + Math.random() * 90000)}_${appointments.length}`,
              status: payStatus,
              type
            });
          }

          // Crear logs de auditoría
          const creationDate = new Date(loopDate);
          creationDate.setDate(creationDate.getDate() - 3);
          
          auditLogs.push({
            appointmentId: appId,
            userId: client._id,
            event: "APPOINTMENT_CREATED",
            level: "INFO",
            message: `Cita reservada por el cliente ${client.firstName} ${client.lastName} para el servicio ${service.name}.`,
            technicalMessage: `New appointment document created for client ID ${client._id}`,
            createdAt: creationDate
          });

          if (status === "confirmed" || status === "completed" || (status === "cancelled" && Math.random() < 0.5)) {
            const confirmDate = new Date(creationDate);
            confirmDate.setHours(confirmDate.getHours() + 2);
            
            auditLogs.push({
              appointmentId: appId,
              userId: worker._id,
              event: "APPOINTMENT_CONFIRMED",
              level: "SUCCESS",
              message: `Cita confirmada administrativamente para el profesional ${worker.firstName}.`,
              technicalMessage: `Appointment status patched to "confirmed"`,
              createdAt: confirmDate
            });
          }

          if (status === "completed") {
            const closeDate = new Date(loopDate);
            const [he, me] = endTime.split(':').map(Number);
            closeDate.setHours(he, me, 0);

            auditLogs.push({
              appointmentId: appId,
              userId: worker._id,
              event: "APPOINTMENT_COMPLETED",
              level: "SUCCESS",
              message: `Servicio completado exitosamente por ${worker.firstName}. Cierre de orden.`,
              technicalMessage: `Appointment marked as completed on calendar grid`,
              createdAt: closeDate
            });
          } else if (status === "cancelled") {
            const cancelDate = new Date(creationDate);
            cancelDate.setDate(cancelDate.getDate() + 1);

            auditLogs.push({
              appointmentId: appId,
              userId: client._id,
              event: "APPOINTMENT_CANCELLED",
              level: "WARN",
              message: `Cita cancelada. Disponibilidad liberada en el calendario.`,
              technicalMessage: `Status patched to "cancelled"`,
              createdAt: cancelDate
            });
          }
        }
      }

      loopDate.setDate(loopDate.getDate() + 1);
    }

    // 8. Inserción masiva ultra-eficiente
    console.log("Guardando datos masivos en MongoDB (Bulk Insert)...");
    
    // Quitar campos transients de los esquemas en memoria antes de guardar
    workers.forEach(w => delete w.popularity);
    services.forEach(s => delete s.weight);

    await User.insertMany(workers);
    await User.insertMany(clients);
    await Shift.insertMany(shifts);
    await Service.insertMany(services);
    await Appointment.insertMany(appointments);
    await Payment.insertMany(payments);
    await AuditLog.insertMany(auditLogs);

    console.log("=========================================");
    console.log("¡SEMBRADO DE PRODUCCIÓN REALISTA EXITOSO!");
    console.log(`- Trabajadores creados: ${workers.length}`);
    console.log(`- Clientes creados: ${clients.length}`);
    console.log(`- Turnos semanales: ${shifts.length}`);
    console.log(`- Servicios en catálogo: ${services.length}`);
    console.log(`- Citas generadas: ${appointments.length}`);
    console.log(`- Pagos registrados: ${payments.length}`);
    console.log(`- AuditLogs insertados: ${auditLogs.length}`);
    console.log("=========================================");

  } catch (err) {
    console.error("Error durante el sembrado de producción:", err);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
