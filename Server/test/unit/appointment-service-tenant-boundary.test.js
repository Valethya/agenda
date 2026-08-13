import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(currentDir, "../../src");
const readSource = async (relativePath) => fs.readFile(path.join(srcRoot, relativePath), "utf8");

test("6.2.4-B protected Appointment reads tenant-scope Service before exposure", async () => {
  const repository = await readSource("repositories/appointment.repository.js");
  const service = await readSource("services/appointment.service.js");

  assert.match(repository, /populateProtectedTenantRelations/u);
  assert.match(repository, /path:\s*"service"[\s\S]*match:\s*\{\s*business:\s*businessId\s*\}/u);
  assert.match(repository, /findCoherentAllByBusiness/u);
  assert.match(repository, /appointments\.filter\(\(appointment\)\s*=>\s*Boolean\(appointment\.service\)\)/u);

  assert.match(service, /assertAppointmentTenantCoherence/u);
  assert.match(service, /!appointment\.service/u);
  assert.match(service, /!sameId\(appointment\.service\.business,\s*businessId\)/u);
  assert.match(service, /findTenantAppointment[\s\S]*assertAppointmentTenantCoherence/u);
  assert.match(service, /authority\.role\s*===\s*"admin"[\s\S]*findCoherentAllByBusiness\(businessId\)/u);
});
