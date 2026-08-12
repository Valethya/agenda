import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AVAILABILITY_CUTOVER_CONFIRMATION,
  AVAILABILITY_CUTOVER_ENV,
  assertAvailabilityRuntimeStorageReady,
  shouldEnforceAvailabilityCutover,
} from "../../src/db/availability-cutover-gate.js";

test("6.2.3 cutover gate is not enforced for isolated test/development runtime", async () => {
  assert.equal(shouldEnforceAvailabilityCutover({ NODE_ENV: "test" }), false);
  assert.deepEqual(
    await assertAvailabilityRuntimeStorageReady(null, { NODE_ENV: "test" }),
    { enforced: false },
  );
});

test("6.2.3 cutover gate is enforced for remote environments and deployment indicators", () => {
  assert.equal(shouldEnforceAvailabilityCutover({ NODE_ENV: "production" }), true);
  assert.equal(shouldEnforceAvailabilityCutover({ NODE_ENV: "staging" }), true);
  assert.equal(
    shouldEnforceAvailabilityCutover({ NODE_ENV: "development", RAILWAY_ENVIRONMENT: "production" }),
    true,
  );
});

test("6.2.3 remote runtime fails closed without explicit storage-ready confirmation", async () => {
  await assert.rejects(
    assertAvailabilityRuntimeStorageReady(null, { NODE_ENV: "production" }),
    new RegExp(AVAILABILITY_CUTOVER_ENV, "u"),
  );
  await assert.rejects(
    assertAvailabilityRuntimeStorageReady(null, {
      NODE_ENV: "production",
      [AVAILABILITY_CUTOVER_ENV]: "wrong-value",
    }),
    new RegExp(AVAILABILITY_CUTOVER_CONFIRMATION, "u"),
  );
});

test("6.2.3 confirmation does not bypass physical storage verification", async () => {
  const db = {
    listCollections: () => ({
      toArray: async () => [{ name: "shifts" }, { name: "blocks" }],
    }),
  };
  await assert.rejects(
    assertAvailabilityRuntimeStorageReady(db, {
      NODE_ENV: "production",
      [AVAILABILITY_CUTOVER_ENV]: AVAILABILITY_CUTOVER_CONFIRMATION,
    }),
    /colección requerida ausente \(appointments\)/u,
  );
});

test("6.2.3 startup connects and passes cutover gate before opening HTTP", async () => {
  const indexPath = fileURLToPath(new URL("../../src/index.js", import.meta.url));
  const source = await fs.readFile(indexPath, "utf8");
  const connectPosition = source.indexOf("await connectDB()");
  const gatePosition = source.indexOf("await assertAvailabilityRuntimeStorageReady");
  const listenPosition = source.indexOf("app.listen(");

  assert.notEqual(connectPosition, -1);
  assert.notEqual(gatePosition, -1);
  assert.notEqual(listenPosition, -1);
  assert.ok(connectPosition < gatePosition, "Mongo debe conectarse antes del gate");
  assert.ok(gatePosition < listenPosition, "el gate debe bloquear antes de app.listen");
});
