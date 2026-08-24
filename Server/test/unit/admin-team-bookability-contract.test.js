import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(currentDir, "../../src");
const readSource = async (relativePath) => fs.readFile(path.join(srcRoot, relativePath), "utf8");

test("Membership.isBookable es canónico, boolean y default false", async () => {
  const model = await readSource("db/models/membership.model.js");
  assert.match(model, /isBookable:\s*\{[\s\S]*type:\s*Boolean[\s\S]*default:\s*false[\s\S]*required:/u);
  assert.match(model, /index\(\{ user: 1, business: 1 \}, \{ unique: true \}\)/u);
});

test("booking eligibility no contiene fallback role=worker", async () => {
  const eligibility = await readSource("services/professionalEligibility.service.js");
  assert.match(eligibility, /membership\.isBookable\s*!==\s*true/u);
  assert.doesNotMatch(eligibility, /isBookable\s*\?\?/u);
  assert.doesNotMatch(eligibility, /membership\.role\s*===\s*["']worker["']/u);
  assert.match(eligibility, /assertServiceBookingEligibility/u);
});

test("existing Appointment actor capability no usa bookability ni Service.workers", async () => {
  const appointment = await readSource("services/appointment.service.js");
  const actorSection = appointment.slice(
    appointment.indexOf("export const resolveExistingAppointmentActorCapabilities"),
    appointment.indexOf("const authorizeProtectedAppointment"),
  );
  assert.match(actorSection, /sameId\(appointment\.worker, userId\)/u);
  assert.doesNotMatch(actorSection, /isBookable/u);
  assert.doesNotMatch(actorSection, /serviceIncludesProfessional/u);
});

test("POST/DELETE workers legacy son no-mutating y sin email/password/Shift", async () => {
  const userService = await readSource("services/user.service.js");
  const routes = await readSource("routes/user.routes.js");
  const createSection = userService.slice(userService.indexOf("export const createWorker"), userService.indexOf("export const deleteWorker"));
  const deleteSection = userService.slice(userService.indexOf("export const deleteWorker"), userService.indexOf("export const getWorkersList"));

  assert.match(createSection, /throw new ConflictError/u);
  assert.doesNotMatch(createSection, /findByEmail|Membership|Shift|password|email/u);
  assert.match(deleteSection, /throw new ConflictError/u);
  assert.doesNotMatch(deleteSection, /deleteOne|hard|Shift|Block|Appointment/u);
  assert.doesNotMatch(routes, /createWorkerSchema/u);
  assert.doesNotMatch(routes, /req\.query\.hard/u);
});

test("GET interno workers expone sólo proyección operacional mínima", async () => {
  const userService = await readSource("services/user.service.js");
  const getSection = userService.slice(userService.indexOf("export const getWorkersList"));
  assert.match(getSection, /firstName/u);
  assert.match(getSection, /lastName/u);
  assert.doesNotMatch(getSection, /\.email\b|\.phone\b|\.role\b|\.business\b/u);
});

test("startup ejecuta bookability gate antes de listen y conserva gates previos", async () => {
  const startServer = await readSource("server/startServer.js");
  const availability = startServer.indexOf("await availabilityGate");
  const guest = startServer.indexOf("await guestCapabilityGate");
  const publicWeb = startServer.indexOf("await publicWebGate");
  const bookability = startServer.indexOf("await membershipBookabilityGate");
  const listen = startServer.indexOf("appInstance.listen");
  assert.ok(availability >= 0 && guest > availability && publicWeb > guest && bookability > publicWeb && listen > bookability);
});
