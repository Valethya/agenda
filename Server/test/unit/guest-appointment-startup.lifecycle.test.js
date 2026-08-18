import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import mongoose from "mongoose";
import { getConnectedDatabase, startServerLifecycle } from "../../src/server/startServer.js";

const fakeLogger = { info: () => {}, error: () => {} };

const dependencies = (overrides = {}) => {
  const calls = [];
  const server = new EventEmitter();
  server.listening = true;
  const appInstance = {
    listen: () => {
      calls.push("listen");
      return server;
    },
  };
  return {
    calls,
    server,
    options: {
      connect: async () => { calls.push("connect"); },
      database: () => ({ marker: "db" }),
      availabilityGate: async () => { calls.push("availability-gate"); },
      guestCapabilityGate: async () => { calls.push("c2-gate"); },
      appInstance,
      listenPort: 3210,
      socketInit: () => { calls.push("socket"); },
      workerStart: () => {
        calls.push("worker-start");
        return () => { calls.push("worker-stop"); };
      },
      processEnvironment: { NODE_ENV: "test" },
      runtimeLogger: fakeLogger,
      ...overrides,
    },
  };
};

test("6.2.5-C2 startup resolves the actual mongoose connection without identifier typos", () => {
  assert.doesNotThrow(() => getConnectedDatabase());
  assert.equal(getConnectedDatabase(), mongoose.connection.db);
});

test("6.2.5-C2 failed storage gate blocks listen, socket and worker", async () => {
  const fixture = dependencies({
    guestCapabilityGate: async () => {
      fixture.calls.push("c2-gate");
      throw new Error("C2_STORAGE_BLOCKED");
    },
  });

  await assert.rejects(startServerLifecycle(fixture.options), /C2_STORAGE_BLOCKED/u);
  assert.deepEqual(fixture.calls, ["connect", "availability-gate", "c2-gate"]);
});

test("6.2.5-C2 listen failure does not initialize socket or worker", async () => {
  const fixture = dependencies();
  fixture.server.listening = false;
  const start = startServerLifecycle(fixture.options);
  queueMicrotask(() => fixture.server.emit("error", new Error("EADDRINUSE")));
  await assert.rejects(start, /EADDRINUSE/u);
  assert.deepEqual(fixture.calls, ["connect", "availability-gate", "c2-gate", "listen"]);
});

test("6.2.5-C2 startup opens HTTP only after both gates and stops worker on server close", async () => {
  const fixture = dependencies();
  const server = await startServerLifecycle(fixture.options);

  assert.equal(server, fixture.server);
  assert.deepEqual(
    fixture.calls,
    ["connect", "availability-gate", "c2-gate", "listen", "socket", "worker-start"],
  );

  server.emit("close");
  assert.deepEqual(
    fixture.calls,
    ["connect", "availability-gate", "c2-gate", "listen", "socket", "worker-start", "worker-stop"],
  );

  server.emit("close");
  assert.equal(fixture.calls.filter((entry) => entry === "worker-stop").length, 1);
});
