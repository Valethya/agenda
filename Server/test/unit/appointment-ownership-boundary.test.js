import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(currentDir, "../../src");

const readSource = async (relativePath) =>
  fs.readFile(path.join(srcRoot, relativePath), "utf8");

test("6.2.4-B source boundary neutraliza grant Client por Appointment.client", async () => {
  const source = await readSource("services/appointment.service.js");

  assert.doesNotMatch(source, /appointment\.client\._id\.toString\(\)\s*===\s*userId/u);
  assert.doesNotMatch(source, /query\.client\s*=\s*userId/u);
  assert.match(source, /Appointment\.client equality is deliberately NOT a grant/u);
});

test("6.2.4-B Appointment sólo expone mutaciones purpose-specific", async () => {
  const repository = await readSource("repositories/appointment.repository.js");
  const service = await readSource("services/appointment.service.js");
  const payment = await readSource("services/payment.service.js");

  assert.doesNotMatch(repository, /export const update\s*=/u);
  assert.doesNotMatch(repository, /export const updateByIdAndBusiness/u);
  assert.doesNotMatch(repository, /export const \w*update\w*\s*=\s*async\s*\(\s*id\s*,\s*(?:data|updateData)\b/ui);
  assert.match(repository, /export const transitionStatusByBusiness/u);
  assert.match(repository, /export const markPendingPaymentFromLegacyPayment/u);
  assert.match(repository, /export const confirmPendingPaymentFromLegacyPayment/u);
  assert.match(repository, /\{ _id: id, status: "pending_payment" \}/u);
  assert.match(repository, /export const cancelPendingPaymentForLegacyConflict/u);
  assert.match(repository, /export const cancelFromRejectedLegacyPayment/u);
  assert.doesNotMatch(repository, /export const confirmFromLegacyPayment/u);
  assert.doesNotMatch(service, /appointmentRepository\.update(?:ByIdAndBusiness)?\s*\(/u);
  assert.doesNotMatch(payment, /appointmentRepository\.update\s*\(/u);
  assert.match(payment, /withSerializedBookingInterval/u);
});

test("6.2.4-B Service update no acepta passthrough abierto ni business mutable", async () => {
  const service = await readSource("services/service.service.js");
  const repository = await readSource("repositories/service.repository.js");
  const validation = await readSource("validations/service.validation.js");

  assert.match(service, /MUTABLE_SERVICE_FIELDS/u);
  assert.match(service, /buildMutableServiceUpdate/u);
  assert.doesNotMatch(service, /let safeData\s*=\s*data/u);
  assert.doesNotMatch(service, /updateByIdAndBusiness/u);
  assert.match(repository, /updateMutableByIdAndBusiness/u);
  assert.doesNotMatch(repository, /export const update\s*=/u);
  assert.match(repository, /pickMutableServiceFields/u);
  assert.match(validation, /updateServiceSchema[\s\S]*\.strict\(\)/u);
});

test("A+A2 desacopla role=worker de elegibilidad profesional", async () => {
  const appointment = await readSource("services/appointment.service.js");
  const availability = await readSource("services/availability.service.js");
  const eligibility = await readSource("services/professionalEligibility.service.js");

  assert.doesNotMatch(appointment, /tenantRole\s*===\s*["']worker["']/u);
  assert.doesNotMatch(availability, /membership\.role\s*!==\s*["']worker["']/u);
  assert.doesNotMatch(eligibility, /membership\.role\s*===\s*["']worker["']/u);
  assert.doesNotMatch(eligibility, /membership\.isBookable\s*\?\?/u);
  assert.match(eligibility, /serviceIncludesProfessional/u);
  assert.match(eligibility, /membership\.isBookable\s*!==\s*true/u);
  assert.match(eligibility, /resolveBookableTenantParticipant/u);
  assert.match(eligibility, /new mongoose\.Types\.ObjectId\(value\)\.toHexString\(\)/u);
});

test("6.2.4-B timeline usa proyección allowlist y controller no accede AuditLog directo", async () => {
  const controller = await readSource("controllers/appointment.controller.js");
  const repository = await readSource("repositories/auditLog.repository.js");

  assert.doesNotMatch(controller, /\bAuditLog\b/u);
  assert.match(controller, /appointmentService\.getAppointmentTimeline/u);
  assert.match(repository, /\.select\("event level message createdAt -_id"\)/u);
  assert.doesNotMatch(repository, /findFunctionalTimelineByAppointment[\s\S]*technicalMessage/u);
});

test("6.2.4-B Payment/Webpay queda deny-by-default", async () => {
  const routes = await readSource("routes/index.js");
  const env = await readSource("config/env.js");

  assert.match(env, /process\.env\.ENABLE_PAYMENTS\s*===\s*"true"/u);
  assert.match(routes, /if\s*\(paymentRoutesEnabled\)\s*\{[\s\S]*router\.use\("\/payments", paymentRoutes\)/u);
});

test("6.2.6-A booking guest no correlaciona ni crea User", async () => {
  const controller = await readSource("controllers/appointment.controller.js");
  const model = await readSource("db/models/appointment.model.js");

  assert.doesNotMatch(controller, /getOrCreateGuestUser/u);
  assert.doesNotMatch(controller, /authService/u);
  assert.match(controller, /bookingSurface\s*===\s*"public"/u);
  assert.match(controller, /guestContact\s*=\s*\{/u);
  assert.match(model, /client:[\s\S]*default:\s*null/u);
  assert.match(model, /client autenticado o guestContact/u);
});

test("6.2.6-A inicio de Payment no acepta Appointment ID como authority", async () => {
  const routes = await readSource("routes/payment.routes.js");

  assert.doesNotMatch(routes, /\bstartPayment\b/u);
  assert.match(routes, /El inicio de pago público requiere una autoridad específica/u);
  assert.match(routes, /ForbiddenError/u);
});
