import mongoose from 'mongoose';
import User from '../src/db/models/user.model.js';
import Business from '../src/db/models/business.model.js';
import Membership from '../src/db/models/membership.model.js';
import Service from '../src/db/models/service.model.js';
import Shift from '../src/db/models/shift.model.js';
import Appointment from '../src/db/models/appointment.model.js';
import Payment from '../src/db/models/payment.model.js';
import AuditLog from '../src/db/models/auditLog.model.js';
import Block from '../src/db/models/block.model.js';
import BusinessConfig from '../src/db/models/businessConfig.model.js';
import { createHash } from '../src/utils/password.js';

export const TEST_BUSINESS = {
  name: 'Barbería de Prueba',
  slug: 'barberia-test',
  isActive: true,
};

export const TEST_ADMIN = {
  firstName: 'Admin',
  lastName: 'Prueba',
  email: ['test-admin@example.com'],
  phone: ['+56900000001'],
  role: 'admin',
  isActive: true,
};

export const TEST_CLIENT = {
  firstName: 'Cliente',
  lastName: 'Prueba',
  email: ['test-client@example.com'],
  phone: ['+56911112222'],
  role: 'user',
  isActive: true,
};

export const TEST_WORKER = {
  firstName: 'Trabajador',
  lastName: 'Prueba',
  email: ['test-worker@example.com'],
  phone: ['+56933334444'],
  role: 'worker',
  isActive: true,
};

export const TEST_SERVICE = {
  name: 'Servicio de Prueba Integrado',
  description: 'Descripción de prueba',
  duration: 60,
  price: 25000,
  depositAmount: 5000,
  isActive: true,
};

/**
 * Seeds the test database with deterministic data.
 * Creates two businesses (A and B) for multi-tenant isolation tests.
 * Returns references to all created documents.
 */
export async function seedTestData() {
  // --- Business A (principal) ---
  const business = await Business.create(TEST_BUSINESS);

  const hashedAdminPw = await createHash('passwordAdmin');
  const hashedClientPw = await createHash('password123');
  const hashedWorkerPw = await createHash('passwordWorker');

  const admin = await User.create({
    ...TEST_ADMIN,
    password: hashedAdminPw,
    business: business._id,
  });

  const client = await User.create({
    ...TEST_CLIENT,
    password: hashedClientPw,
    business: business._id,
  });

  const worker = await User.create({
    ...TEST_WORKER,
    password: hashedWorkerPw,
    business: business._id,
  });

  await Membership.create({ user: admin._id, business: business._id, role: 'admin' });
  await Membership.create({ user: client._id, business: business._id, role: 'worker' });
  await Membership.create({ user: worker._id, business: business._id, role: 'worker' });

  const service = await Service.create({
    ...TEST_SERVICE,
    business: business._id,
    workers: [worker._id],
  });

  const shifts = [];
  for (let day = 1; day <= 5; day++) {
    shifts.push(await Shift.create({
      worker: worker._id,
      dayOfWeek: day,
      isOpen: true,
      startTime: '09:00',
      endTime: '18:00',
      breaks: [{ startTime: '13:00', endTime: '14:00' }],
    }));
  }

  // --- Business B (para tests de aislamiento multitenant) ---
  const businessB = await Business.create({
    name: 'Negocio B Test',
    slug: 'negocio-b-test',
    isActive: true,
  });

  const hashedUserBPw = await createHash('passwordUserB');
  const hashedWorkerBPw = await createHash('passwordWorkerB');

  const userB = await User.create({
    firstName: 'Usuario',
    lastName: 'NegocioB',
    email: ['user-b@example.com'],
    phone: ['+56955555555'],
    password: hashedUserBPw,
    role: 'admin',
    business: businessB._id,
    isActive: true,
  });

  const workerB = await User.create({
    firstName: 'Worker',
    lastName: 'NegocioB',
    email: ['worker-b@example.com'],
    phone: ['+56966666666'],
    password: hashedWorkerBPw,
    role: 'worker',
    business: businessB._id,
    isActive: true,
  });

  await Membership.create({ user: userB._id, business: businessB._id, role: 'admin' });
  await Membership.create({ user: workerB._id, business: businessB._id, role: 'worker' });

  return { business, admin, client, worker, service, shifts, businessB, userB, workerB };
}

/**
 * Drops all documents from every collection in the test database.
 * Includes safety guards to prevent accidental execution against non-test databases.
 */
export async function cleanTestData() {
  // Guard: solo ejecutar en entorno de test
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(`cleanTestData() rechazada: NODE_ENV es "${process.env.NODE_ENV}", se requiere "test"`);
  }

  // Guard: verificar que la base de datos conectada termine en "_test"
  const dbName = mongoose.connection.db?.databaseName || '';
  if (!dbName.endsWith('_test')) {
    throw new Error(`cleanTestData() rechazada: la base de datos "${dbName}" no termina en "_test"`);
  }

  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

/**
 * Disconnects from the test database and cleans up.
 */
export async function teardown(server, sessionStore) {
  if (server) server.close();
  if (sessionStore && typeof sessionStore.close === 'function') {
    await sessionStore.close();
  }
  await cleanTestData();
  await mongoose.disconnect();
}
