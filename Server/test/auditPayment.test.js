import './setup.js';
import test from "node:test";
import assert from "node:assert";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import User from "../src/db/models/user.model.js";
import Service from "../src/db/models/service.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import Shift from "../src/db/models/shift.model.js";
import Business from "../src/db/models/business.model.js";
import Payment from "../src/db/models/payment.model.js";
import AuditLog from "../src/db/models/auditLog.model.js";
import Block from "../src/db/models/block.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";

// Mock de Transbank SDK
import pkg from "transbank-sdk";
const { WebpayPlus } = pkg;

export const mockPaymentState = {
  buyOrder: null,
  amount: 5000,
  token: "mock-token-12345",
  status: "AUTHORIZED",
  responseCode: 0,
  failCreate: false,
  failCommit: false,
  authorizationCode: "1213",
};

// Sobrescribir prototipos de Webpay Plus Transaction
WebpayPlus.Transaction.prototype.create = async function (buyOrder, sessionId, amount, returnUrl) {
  if (mockPaymentState.failCreate) {
    throw new Error("Transbank creation failed");
  }
  mockPaymentState.buyOrder = buyOrder;
  mockPaymentState.amount = amount;
  return {
    token: mockPaymentState.token,
    url: "https://webpay-mock-redirect",
  };
};

WebpayPlus.Transaction.prototype.commit = async function (token) {
  if (mockPaymentState.failCommit) {
    throw new Error("Connection timeout mock");
  }
  return {
    status: mockPaymentState.status,
    response_code: mockPaymentState.responseCode,
    buy_order: mockPaymentState.buyOrder,
    amount: mockPaymentState.amount,
    authorization_code: mockPaymentState.authorizationCode,
  };
};

// Conectar a la base de datos
await connectDB();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

test("Pruebas de Integración - Flujo de Pago Abierto y Registro Progresivo", async (t) => {
  let workerCookie = "";
  let testServiceId = "";
  let testWorkerId = "";
  let testBusinessId = "";
  let tomorrowStr = "";

  // Configuración inicial de datos de prueba
  t.before(async () => {
    // Limpieza de datos antiguos de pruebas
    await AuditLog.deleteMany({});
    await Payment.deleteMany({});
    await Appointment.deleteMany({});
    const oldWorker = await User.findOne({ email: "audit-worker@example.com" });
    if (oldWorker) {
      await Shift.deleteMany({ worker: oldWorker._id });
      await Block.deleteMany({ worker: oldWorker._id });
    }
    await User.deleteMany({ email: { $in: [
      "audit-client@example.com", 
      "audit-worker@example.com",
      "progressive-1@example.com",
      "progressive-2@example.com"
    ] } });
    await Service.deleteMany({ name: "Servicio Auditoría" });
    await Business.deleteMany({ slug: "barberia-audit" });

    // Crear negocio
    const business = await Business.create({
      name: "Barbería Auditoría",
      slug: "barberia-audit",
      isActive: true,
    });
    testBusinessId = business._id.toString();

    // Crear trabajador
    const hashedPassword = await createHash("password123");
    const workerUser = await User.create({
      firstName: "Trabajador",
      lastName: "Audit",
      email: "audit-worker@example.com",
      password: hashedPassword,
      role: "worker",
      business: business._id,
    });
    testWorkerId = workerUser._id.toString();

    // Crear membresía para el trabajador (requerida por resolveSessionFromUser)
    await Membership.create({
      user: workerUser._id,
      business: business._id,
      role: "worker",
    });

    // Iniciar sesión de trabajador para obtener la cookie de administración
    const logRes = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "audit-worker@example.com",
        password: "password123",
      }),
    });
    workerCookie = logRes.headers.get("set-cookie");

    // Crear servicio
    const service = await Service.create({
      name: "Servicio Auditoría",
      description: "Servicio de prueba para auditoría",
      duration: 30,
      price: 10000,
      depositAmount: 3000,
      business: business._id,
      isActive: true,
    });
    testServiceId = service._id.toString();

    // Generar fecha de prueba garantizando que sea día laborable (Lun-Vie)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    // Si cae en fin de semana, avanzar al lunes
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }
    tomorrowStr = tomorrow.toISOString().split("T")[0];

    // Crear shift para el trabajador en el día de la semana de la prueba
    await Shift.create({
      worker: workerUser._id,
      dayOfWeek: tomorrow.getDay(),
      isOpen: true,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [],
    });
  });

  t.after(async () => {
    server.close();
    await AuditLog.deleteMany({});
    await Payment.deleteMany({});
    await Appointment.deleteMany({});
    if (testWorkerId) {
      await Shift.deleteMany({ worker: testWorkerId });
      await Block.deleteMany({ worker: testWorkerId });
    }
    await User.deleteMany({ email: { $in: [
      "audit-client@example.com", 
      "audit-worker@example.com",
      "progressive-1@example.com",
      "progressive-2@example.com"
    ] } });
    await Service.deleteMany({ name: "Servicio Auditoría" });
    await Membership.deleteMany({});
    await Business.deleteMany({ slug: "barberia-audit" });

    if (sessionStore && typeof sessionStore.close === "function") {
      await sessionStore.close();
    }
    const mongoose = await import("mongoose");
    await mongoose.default.disconnect();
  });

  // Limpiar colecciones transaccionales antes de cada caso de prueba
  t.beforeEach(async () => {
    await Appointment.deleteMany({});
    await Payment.deleteMany({});
    await Block.deleteMany({});
    await AuditLog.deleteMany({});

    mockPaymentState.buyOrder = null;
    mockPaymentState.amount = 3000;
    mockPaymentState.token = "mock-token-12345";
    mockPaymentState.status = "AUTHORIZED";
    mockPaymentState.responseCode = 0;
    mockPaymentState.failCreate = false;
    mockPaymentState.failCommit = false;
    mockPaymentState.authorizationCode = "1213";
  });

  // 1. CASO DE PRUEBA: Pago Aprobado Exitosamente sin Login de Cliente
  await t.test("Debería registrar correctamente todo el flujo de un pago aprobado como invitado en el AuditLog", async () => {
    // A. Crear reserva como invitado (POST sin cookies, pasando clientInfo)
    const bookRes = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: testWorkerId,
        service: testServiceId,
        date: tomorrowStr,
        startTime: "09:00",
        notes: "Cita aprobada invitado",
        clientInfo: {
          firstName: "Cliente",
          lastName: "Audit",
          email: "audit-client@example.com",
          phone: "+56911112222",
        },
      }),
    });
    assert.strictEqual(bookRes.status, 201);
    const bookData = await bookRes.json();
    const appointmentId = bookData.payload._id;
    assert.ok(appointmentId);

    // Verificar que se creó el cliente en la base de datos
    const createdClient = await User.findOne({ email: "audit-client@example.com" });
    assert.ok(createdClient);
    assert.strictEqual(createdClient.firstName, "Cliente");
    assert.ok(createdClient.phone.includes("+56911112222"));

    // B. Iniciar pago (Público, sin cookies)
    const initRes = await fetch(`${baseUrl}/payments/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointmentId,
        paymentType: "deposit",
      }),
    });
    assert.strictEqual(initRes.status, 200);
    const initData = await initRes.json();
    assert.strictEqual(initData.payload.token, "mock-token-12345");

    // C. Confirmar pago (Commit)
    const returnRes = await fetch(`${baseUrl}/payments/webpay-return?token_ws=mock-token-12345&slug=barberia-audit`, {
      method: "POST",
      redirect: "manual",
    });
    assert.strictEqual(returnRes.status, 302);

    // Verificar cita confirmada
    const apptAfter = await Appointment.findById(appointmentId);
    assert.strictEqual(apptAfter.status, "confirmed");

    // D. Consultar timeline de auditoría usando las cookies de trabajador (administración)
    const timelineRes = await fetch(`${baseUrl}/appointments/${appointmentId}/timeline`, {
      headers: { Cookie: workerCookie },
    });
    assert.strictEqual(timelineRes.status, 200);
    const timelineData = await timelineRes.json();
    const logs = timelineData.payload;
    const events = logs.map((l) => l.event);

    assert.ok(events.includes("APPOINTMENT_REQUEST_RECEIVED"));
    assert.ok(events.includes("APPOINTMENT_VALIDATION_SUCCESS"));
    assert.ok(events.includes("APPOINTMENT_PENDING_CREATED"));
    assert.ok(events.includes("WEBPAY_CREATE_REQUEST"));
    assert.ok(events.includes("WEBPAY_CREATE_SUCCESS"));
    assert.ok(events.includes("CLIENT_REDIRECTED_TO_WEBPAY"));
    assert.ok(events.includes("CLIENT_RETURNED_FROM_WEBPAY"));
    assert.ok(events.includes("WEBPAY_COMMIT_REQUEST"));
    assert.ok(events.includes("WEBPAY_COMMIT_SUCCESS"));
    assert.ok(events.includes("WEBPAY_PAYMENT_AUTHORIZED"));
    assert.ok(events.includes("APPOINTMENT_CONFIRMED"));
  });

  // 2. CASO DE PRUEBA: Identificación Progresiva y Detección de Duplicados
  await t.test("Debería detectar duplicados por teléfono/correo y realizar identificación progresiva de datos", async () => {
    // A. Crear reserva para Cliente 1 (Creación de registro inicial)
    const bookRes1 = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: testWorkerId,
        service: testServiceId,
        date: tomorrowStr,
        startTime: "09:00",
        clientInfo: {
          firstName: "Progresivo",
          lastName: "Uno",
          email: "progressive-1@example.com",
          phone: "+56977777777",
        },
      }),
    });
    assert.strictEqual(bookRes1.status, 201);
    const clientDb1 = await User.findOne({ phone: "+56977777777" });
    assert.ok(clientDb1);
    assert.ok(clientDb1.email.includes("progressive-1@example.com"));
    assert.ok(clientDb1.phone.includes("+56977777777"));

    // Limpiar citas del slot para permitir re-agendamiento del test
    await Appointment.deleteMany({});

    // B. Crear reserva usando un EMAIL NUEVO pero el MISMO TELÉFONO
    // Esperamos que asocie la cita al mismo cliente, añada el nuevo email al arreglo,
    // y no sobrescriba los nombres existentes.
    const bookRes2 = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: testWorkerId,
        service: testServiceId,
        date: tomorrowStr,
        startTime: "09:00",
        clientInfo: {
          firstName: "Progresivo Actualizado",
          lastName: "Modificado",
          email: "progressive-2@example.com", // Email nuevo
          phone: "+56977777777", // Teléfono coincide con cliente existente
        },
      }),
    });
    assert.strictEqual(bookRes2.status, 201);
    const bookData2 = await bookRes2.json();

    // Buscar cuántos usuarios existen con ese teléfono (debe ser exactamente 1)
    const countUsers = await User.countDocuments({ phone: "+56977777777" });
    assert.strictEqual(countUsers, 1);

    // Comprobar que el usuario existente conservó sus nombres e incorporó el nuevo email
    const updatedClient = await User.findOne({ phone: "+56977777777" });
    assert.ok(updatedClient.email.includes("progressive-1@example.com"));
    assert.ok(updatedClient.email.includes("progressive-2@example.com"));
    assert.strictEqual(updatedClient.firstName, "Progresivo"); // No sobrescrito
    assert.strictEqual(updatedClient.lastName, "Uno"); // No sobrescrito
    
    // Comprobar que la cita se asignó a este cliente
    assert.strictEqual(bookData2.payload.client, updatedClient._id.toString());

    // C. Probar completado de nombres cuando están vacíos
    // Dejar apellido vacío en base de datos para simular ficha incompleta
    await User.updateOne({ _id: updatedClient._id }, { lastName: "" });

    // Limpiar citas del slot
    await Appointment.deleteMany({});

    // Reservar indicando un apellido para completar la ficha
    const bookRes3 = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: testWorkerId,
        service: testServiceId,
        date: tomorrowStr,
        startTime: "09:00",
        clientInfo: {
          firstName: "Progresivo",
          lastName: "Completado",
          email: "progressive-2@example.com",
          phone: "+56977777777",
        },
      }),
    });
    assert.strictEqual(bookRes3.status, 201);

    const completedClient = await User.findOne({ phone: "+56977777777" });
    assert.strictEqual(completedClient.firstName, "Progresivo");
    assert.strictEqual(completedClient.lastName, "Completado"); // Completado
  });

  // 3. CASO DE PRUEBA: Intento de reserva sin proporcionar clientInfo
  await t.test("Debería denegar la reserva si no se pasa clientInfo y no hay sesión activa", async () => {
    const bookRes = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: testWorkerId,
        service: testServiceId,
        date: tomorrowStr,
        startTime: "09:00",
      }),
    });
    assert.strictEqual(bookRes.status, 400);
    const bookData = await bookRes.json();
    assert.ok(bookData.message.includes("clientInfo"));
  });

  // 4. CASO DE PRUEBA: Horario tomado (con Bloqueo administrativo)
  await t.test("Debería impedir el pago si el horario de la cita fue tomado por un bloqueo", async () => {
    // Crear reserva inicial
    const bookRes = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: testWorkerId,
        service: testServiceId,
        date: tomorrowStr,
        startTime: "09:00",
        clientInfo: {
          firstName: "Cliente",
          lastName: "Bloqueado",
          email: "audit-client@example.com",
          phone: "+56911112222",
        },
      }),
    });
    const appointmentId = (await bookRes.json()).payload._id;

    // Crear bloqueo administrativo en el mismo horario
    await Block.create({
      worker: testWorkerId,
      date: new Date(tomorrowStr),
      startTime: "09:00",
      endTime: "09:30",
      reason: "Bloqueo por slot ocupado",
    });

    // Intentar iniciar el pago
    const initRes = await fetch(`${baseUrl}/payments/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId, paymentType: "deposit" }),
    });

    assert.strictEqual(initRes.status, 400);
    const initData = await initRes.json();
    assert.ok(initData.message.includes("no se encuentra disponible"));
  });
});
