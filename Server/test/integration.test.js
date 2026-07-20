import './setup.js';
import test from 'node:test';
import assert from 'node:assert';
import app, { sessionStore } from '../src/app.js';
import { connectDB } from '../src/db/db.js';
import Membership from '../src/db/models/membership.model.js';
import { seedTestData, cleanTestData, teardown } from './fixtures.js';

await connectDB();

let seed;
let server;
let baseUrl;

test('Flujo de Integración Completo de la API', async (t) => {
  t.before(async () => {
    await cleanTestData();
    seed = await seedTestData();
    server = app.listen(0);
    const { port } = server.address();
    baseUrl = `http://localhost:${port}/api`;
  });

  t.after(async () => {
    await teardown(server, sessionStore);
  });

  let clientCookie = '';
  let adminCookie = '';
  let testServiceId = '';
  let testWorkerId = '';
  let testAppointmentId = '';

  // 1. REGISTRO E INICIO DE SESIÓN DE CLIENTE
  await t.test('Registro e Inicio de Sesión de Cliente', async () => {
    // A. Registrar un nuevo usuario (prueba que el endpoint funciona)
    const regRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'NuevoCliente',
        lastName: 'Registro',
        email: 'test-nuevo@example.com',
        password: 'passwordNuevo',
        phone: '+56955556666',
      }),
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    assert.strictEqual(regData.status, 'succes');

    // B. Login with the pre-seeded client (who has a Membership)
    const logRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test-client@example.com',
        password: 'password123',
      }),
    });
    assert.strictEqual(logRes.status, 201);
    clientCookie = logRes.headers.get('set-cookie');
    assert.ok(clientCookie, 'Debería retornar cookie de sesión');

    // C. Verificar sesión (GET /me)
    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { Cookie: clientCookie },
    });
    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.payload.email, 'test-client@example.com');
  });

  // 2. OPERACIONES DE ADMINISTRADOR
  await t.test('Operaciones de Administrador (Crear Servicio y Trabajador)', async () => {
    // Login de Admin (pre-seeded with Membership)
    const logRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test-admin@example.com',
        password: 'passwordAdmin',
      }),
    });
    assert.strictEqual(logRes.status, 201);
    adminCookie = logRes.headers.get('set-cookie');

    // A. Crear un Servicio (Solo Admin)
    const serviceRes = await fetch(`${baseUrl}/services`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: 'Servicio Creado en Test',
        description: 'Servicio creado durante la prueba',
        duration: 60,
        price: 25000,
        depositAmount: 5000,
      }),
    });
    assert.strictEqual(serviceRes.status, 201);
    const serviceData = await serviceRes.json();
    testServiceId = serviceData.payload._id;
    assert.ok(testServiceId);

    // B. Crear un Trabajador (Solo Admin)
    const workerRes = await fetch(`${baseUrl}/users/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        firstName: 'NuevoTrabajador',
        lastName: 'Test',
        email: 'test-new-worker@example.com',
        password: 'passwordNewWorker',
        phone: '+56977778888',
      }),
    });
    assert.strictEqual(workerRes.status, 201);
    const workerData = await workerRes.json();
    testWorkerId = workerData.payload.id;
    assert.ok(testWorkerId);
  });

  // 3. CONSULTA DE DISPONIBILIDAD Y AGENDAMIENTO DE CITAS
  await t.test('Consulta de Disponibilidad y Reserva de Citas', async () => {
    // Use the pre-seeded worker and service (they already have shifts)
    const workerId = seed.worker._id.toString();
    const serviceId = seed.service._id.toString();

    // Find the next weekday (Mon-Fri) at least 2 days from now
    const date = new Date();
    date.setDate(date.getDate() + 2);
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }
    const dateStr = date.toISOString().split('T')[0];

    // A. Consultar slots libres de disponibilidad
    const availRes = await fetch(
      `${baseUrl}/availability/slots?workerId=${workerId}&serviceId=${serviceId}&date=${dateStr}`
    );
    assert.strictEqual(availRes.status, 200);
    const availData = await availRes.json();
    assert.ok(Array.isArray(availData.payload));

    const firstAvailableSlot = availData.payload.find(slot => slot.available !== false);
    const startTime = firstAvailableSlot ? firstAvailableSlot.startTime : '09:00';

    // B. Reservar cita (POST /appointments como cliente)
    const bookRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: clientCookie,
      },
      body: JSON.stringify({
        worker: workerId,
        service: serviceId,
        date: dateStr,
        startTime: startTime,
        notes: 'Cita de prueba integrada',
      }),
    });

    if (bookRes.status === 201) {
      const bookData = await bookRes.json();
      testAppointmentId = bookData.payload._id;
      assert.strictEqual(bookData.status, 'success');
      assert.ok(testAppointmentId);
    }
  });

  // 4. CONFIRMACIÓN Y CANCELACIÓN DE CITAS
  await t.test('Flujos de Citas (Confirmar y Cancelar)', async () => {
    if (testAppointmentId) {
      // A. Confirmar Cita (Como Admin)
      const confRes = await fetch(`${baseUrl}/appointments/${testAppointmentId}/confirm`, {
        method: 'PATCH',
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(confRes.status, 200);
      const confData = await confRes.json();
      assert.strictEqual(confData.payload.status, 'confirmed');

      // B. Cancelar Cita (Como Cliente)
      const cancelRes = await fetch(`${baseUrl}/appointments/${testAppointmentId}/cancel`, {
        method: 'PATCH',
        headers: { Cookie: clientCookie },
      });
      assert.strictEqual(cancelRes.status, 200);
      const cancelData = await cancelRes.json();
      assert.strictEqual(cancelData.payload.status, 'cancelled');
    }
  });
});
