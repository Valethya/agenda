import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startServerLifecycle } from "../../src/server/startServer.js";
import {
  TENANT_ONBOARDING_C2_CUTOVER_CONFIRMATION,
  TENANT_ONBOARDING_C2_CUTOVER_ENV,
  assertTenantOnboardingRuntimeStorageReady,
} from "../../src/db/tenant-onboarding-account-binding-cutover-gate.js";

const fakeLogger = { info: () => {}, error: () => {} };

const fixture = (tenantOnboardingGate) => {
  const calls = [];
  const server = new EventEmitter();
  server.listening = true;
  return {
    calls,
    options: {
      connect: async () => { calls.push("connect"); },
      database: () => ({ marker: "db" }),
      availabilityGate: async () => { calls.push("availability"); },
      guestCapabilityGate: async () => { calls.push("guest"); },
      publicWebGate: async () => { calls.push("public-web"); },
      membershipBookabilityGate: async () => { calls.push("bookability"); },
      tenantOnboardingGate,
      appInstance: {
        listen: () => {
          calls.push("listen");
          return server;
        },
      },
      listenPort: 3210,
      socketInit: () => { calls.push("socket"); },
      workerStart: () => {
        calls.push("worker");
        return () => {};
      },
      processEnvironment: { NODE_ENV: "test" },
      runtimeLogger: fakeLogger,
    },
  };
};

test("C2 onboarding storage gate executes after existing gates and before listen", async () => {
  let current;
  current = fixture(async () => {
    current.calls.push("tenant-onboarding");
  });

  await startServerLifecycle(current.options);
  assert.deepEqual(current.calls, [
    "connect",
    "availability",
    "guest",
    "public-web",
    "bookability",
    "tenant-onboarding",
    "listen",
    "socket",
    "worker",
  ]);
});

test("C2 onboarding storage failure blocks listen/socket/worker", async () => {
  let current;
  current = fixture(async () => {
    current.calls.push("tenant-onboarding");
    throw new Error("TENANT_ONBOARDING_STORAGE_BLOCKED");
  });

  await assert.rejects(
    startServerLifecycle(current.options),
    /TENANT_ONBOARDING_STORAGE_BLOCKED/u,
  );
  assert.deepEqual(current.calls, [
    "connect",
    "availability",
    "guest",
    "public-web",
    "bookability",
    "tenant-onboarding",
  ]);
});

test("remote C2 runtime requires explicit cutover confirmation before inspecting storage", async () => {
  await assert.rejects(
    assertTenantOnboardingRuntimeStorageReady({}, { NODE_ENV: "production" }),
    new RegExp(TENANT_ONBOARDING_C2_CUTOVER_ENV, "u"),
  );
});

test("isolated local NODE_ENV=test is exempt from runtime storage gate", async () => {
  assert.deepEqual(
    await assertTenantOnboardingRuntimeStorageReady({}, { NODE_ENV: "test" }),
    { enforced: false },
  );
});

test("deployment indicator defeats NODE_ENV=test exemption", async () => {
  await assert.rejects(
    assertTenantOnboardingRuntimeStorageReady({}, {
      NODE_ENV: "test",
      RAILWAY_ENVIRONMENT: "test-deployment",
    }),
    new RegExp(`${TENANT_ONBOARDING_C2_CUTOVER_ENV}.*${TENANT_ONBOARDING_C2_CUTOVER_CONFIRMATION}`, "u"),
  );
});
