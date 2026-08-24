import './setup.js';
import test from 'node:test';
import assert from 'node:assert';
import app, { sessionStore } from '../src/app.js';
import { connectDB } from '../src/db/db.js';
import { seedTestData, cleanTestData, teardown } from './fixtures.js';
import User from '../src/db/models/user.model.js';
import Membership from '../src/db/models/membership.model.js';
import Shift from '../src/db/models/shift.model.js';

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

  let adminCookie = '';
  let testServiceId = '';
  let testAppointmentId = '';

  // 1. REGISTRO Y CONTRATO ACTUAL DE CUENTA SIN MEMBRESÍA
  await t.test('Registro de cliente y rechazo explícito de login sin membresía', async () => {
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

    // B. El registro no crea una membresía. Mientras no se defina el modelo
    // formal de cuentas cliente, el login debe rechazarlo de forma explícita.
    const logRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test-nuevo@example.com',
        password: 'passwordNuevo',
      }),
    });
    assert.strictEqual(logRes.status, 401);
    const logData = await logRes.json();
    assert.match(logData.message, /ningún negocio asociado/i);
  });

  // 2. OPERACIONES DE ADMINISTRADOR Y CIERRE LEGACY DE PROFESIONALES
  await t.test('Admin crea Servicio y la administración legacy de profesionales permanece cerrada', async () => {
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

    // B. A+A2 retira esta ruta como lifecycle administrativo. Debe fallar
    // cerrado y no crear identidad global, Membership ni Shift implícito.
    const before = {
      users: await User.countDocuments({}),
      memberships: await Membership.countDocuments({}),
      shifts: await Shift.countDocuments({}),
    };
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
    assert.strictEqual(workerRes.status, 409);
    const workerData = await workerRes.json();
    assert.strictEqual(workerData.code, 'CONFLICT_ERROR');
    assert.strictEqual(
      workerData.message,
      'La administración legacy de profesionales no está disponible',
    );
    assert.strictEqual(await User.countDocuments({}), before.users);
    assert.strictEqual(await Membership.countDocuments({}), before.memberships);
    assert.strictEqual(await Shift.countDocuments({}), before.shifts);
    assert.strictEqual(await User.findOne({ email: 'test-new-worker@example.com' }), null);
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
      `${baseUrl}/availability/slots?workerId=${workerId}&serviceId=${serviceId}&date=${dateStr}&slug=${seed.business.slug}`
    );
    assert.strictEqual(availRes.status, 200);
    const availData = await availRes.json();
    assert.ok(Array.isArray(availData.payload));

    const firstAvailableSlot = availData.payload.find(slot => slot.available !== false);
    assert.ok(firstAvailableSlot, 'Debe existir al menos un horario disponible');
    const startTime = firstAvailableSlot.startTime;

    // B. Reservar cita mediante el contrato público headless, enviando clientInfo.
    const bookRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worker: workerId,
        service: serviceId,
        slug: seed.business.slug,
        date: dateStr,
        startTime: startTime,
        notes: 'Cita de prueba integrada',
        clientInfo: {
          firstName: 'Cliente',
          lastName: 'Prueba',
          email: 'test-client@example.com',
          phone: '+56911112222',
        },
      }),
    });
    assert.strictEqual(bookRes.status, 201);
    const bookData = await bookRes.json();
    testAppointmentId = bookData.payload.appointmentId;
    assert.strictEqual(bookData.status, 'success');
    assert.ok(testAppointmentId);
    assert.strictEqual(bookData.payload.businessId, seed.business._id.toString());
    assert.strictEqual(bookData.payload.serviceId, serviceId);
    assert.strictEqual(bookData.payload.workerId, workerId);
    assert.ok(!('client' in bookData.payload));
  });

  // 4. CONFIRMACIÓN Y CANCELACIÓN DE CITAS
  await t.test('Flujos administrativos de citas (Confirmar y Cancelar)', async () => {
    assert.ok(testAppointmentId, 'La reserva previa debe haber creado una cita');

    // A. Confirmar cita como administrador.
    const confRes = await fetch(`${baseUrl}/appointments/${testAppointmentId}/confirm`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(confRes.status, 200);
    const confData = await confRes.json();
    assert.strictEqual(confData.payload.status, 'confirmed');

    // B. Cancelar cita como administrador. El modelo de acceso del cliente se
    // decidirá en la etapa 6.2 y no se simula con permisos de trabajador.
    const cancelRes = await fetch(`${baseUrl}/appointments/${testAppointmentId}/cancel`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelData.payload.status, 'cancelled');
  });
});