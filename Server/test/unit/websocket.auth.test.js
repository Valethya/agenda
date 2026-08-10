import '../setup.js';
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../../src/app.js";
import { connectDB } from "../../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "../fixtures.js";
import { io as ioClient } from "socket.io-client";
import { initSocket, emitAvailabilityChange } from "../../src/config/socket.js";
import Membership from "../../src/db/models/membership.model.js";

await connectDB();
let seed, port, httpServer, adminCookie, userBCookie;

async function loginAndGetCookie(email, password) {
  const res = await fetch(`http://localhost:${port}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 201) {
    const body = await res.text();
    throw new Error(`Login falló (${res.status}): ${body}`);
  }
  return res.headers.get("set-cookie");
}

before(async () => {
  await cleanTestData();
  seed = await seedTestData();
  httpServer = app.listen(0);
  port = httpServer.address().port;
  initSocket(httpServer);
  adminCookie = await loginAndGetCookie("test-admin@example.com", "passwordAdmin");
  userBCookie = await loginAndGetCookie("user-b@example.com", "passwordUserB");
});

after(async () => {
  await teardown(httpServer, sessionStore);
});

async function switchBusiness(cookie, businessId) {
  return fetch(`http://localhost:${port}/api/switch-business`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ businessId }),
  });
}

function createSocketClient(cookie) {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    extraHeaders: cookie ? { Cookie: cookie } : {},
    autoConnect: false,
  });
}

async function connectSocket(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout esperando conexión")), 5000);
    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Conexión rechazada: ${err.message}`));
    });
    socket.connect();
  });
}

async function emitAndWaitForWsError(socket, event, payload, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    socket.once("ws_error", (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
    socket.emit(event, payload);
  });
}

describe("WebSocket Authentication (6.2.2-D)", () => {
  it("rechaza conexión sin sesión", async () => {
    const socket = createSocketClient(null);
    const error = await new Promise((resolve) => {
      socket.on("connect_error", resolve);
      socket.connect();
    });
    assert.ok(error);
    assert.ok(error.message.includes("No autorizado") || error.message.includes("Unauthorized"));
    socket.disconnect();
  });

  it("permite conexión autenticada con Membership activa", async () => {
    const socket = createSocketClient(adminCookie);
    await connectSocket(socket);
    assert.ok(socket.connected);
    socket.disconnect();
  });

  it("permite join_availability para worker del mismo negocio", async () => {
    const socket = createSocketClient(adminCookie);
    await connectSocket(socket);

    const error = await emitAndWaitForWsError(
      socket,
      "join_availability",
      { workerId: seed.worker._id.toString(), date: "2026-07-22" },
      800,
    );
    assert.equal(error, null);
    socket.disconnect();
  });

  it("revocar Membership después del handshake bloquea la siguiente operación", async () => {
    const socket = createSocketClient(adminCookie);
    await connectSocket(socket);

    const membership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
    membership.isActive = false;
    await membership.save();

    try {
      const error = await emitAndWaitForWsError(socket, "join_availability", {
        workerId: seed.worker._id.toString(),
        date: "2026-07-22",
      });
      assert.ok(error?.message?.includes("ya no está vigente"));
    } finally {
      membership.isActive = true;
      await membership.save();
      socket.disconnect();
    }
  });

  it("un socket revocado deja de recibir broadcasts tenant", async () => {
    const socket = createSocketClient(adminCookie);
    await connectSocket(socket);

    const joinError = await emitAndWaitForWsError(socket, "join_availability", {
      workerId: seed.worker._id.toString(),
      date: "2026-07-23",
    }, 500);
    assert.equal(joinError, null);

    const membership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
    membership.isActive = false;
    await membership.save();

    let receivedAvailability = false;
    socket.on("availability_changed", () => { receivedAvailability = true; });
    try {
      emitAvailabilityChange(seed.worker._id.toString(), "2026-07-23", seed.business._id.toString());
      await new Promise((resolve) => setTimeout(resolve, 800));
      assert.equal(receivedAvailability, false);
    } finally {
      membership.isActive = true;
      await membership.save();
      socket.disconnect();
    }
  });
});

describe("WebSocket Multitenant Isolation", () => {
  it("rechaza join_availability cuando el worker pertenece a otro negocio", async () => {
    const socketA = createSocketClient(adminCookie);
    await connectSocket(socketA);

    const result = await emitAndWaitForWsError(socketA, "join_availability", {
      workerId: seed.workerB._id.toString(),
      date: "2026-07-22",
    });
    assert.ok(result?.message?.includes("no pertenece"));
    socketA.disconnect();
  });

  it("socket del negocio B no recibe calendar_update emitido para el negocio A", async () => {
    const socketA = createSocketClient(adminCookie);
    await connectSocket(socketA);
    const socketB = createSocketClient(userBCookie);
    await connectSocket(socketB);

    let socketAReceived = false;
    let socketBReceived = false;
    socketA.on("calendar_update", () => { socketAReceived = true; });
    socketB.on("calendar_update", () => { socketBReceived = true; });

    emitAvailabilityChange(seed.worker._id.toString(), "2026-07-22", seed.business._id.toString());
    await new Promise((resolve) => setTimeout(resolve, 1000));

    assert.equal(socketAReceived, true);
    assert.equal(socketBReceived, false);
    socketA.disconnect();
    socketB.disconnect();
  });

  it("cambiar tenant en HTTP invalida el contexto antiguo del socket", async () => {
    const socket = createSocketClient(userBCookie);
    await connectSocket(socket);

    const addedMembership = await Membership.create({
      user: seed.userB._id,
      business: seed.business._id,
      role: "admin",
      isActive: true,
    });

    try {
      const switched = await switchBusiness(userBCookie, seed.business._id.toString());
      assert.equal(switched.status, 200);

      const error = await emitAndWaitForWsError(socket, "join_availability", {
        workerId: seed.workerB._id.toString(),
        date: "2026-07-22",
      });
      assert.ok(error?.message?.includes("ya no está vigente"));
    } finally {
      await Membership.findByIdAndDelete(addedMembership._id);
      socket.disconnect();
    }
  });
});
