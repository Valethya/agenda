import '../setup.js';
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../../src/app.js";
import { connectDB } from "../../src/db/db.js";
import { seedTestData, teardown } from "../fixtures.js";
import { io as ioClient } from "socket.io-client";
import { initSocket, emitAvailabilityChange } from "../../src/config/socket.js";

await connectDB();
let seed, port, httpServer;

before(async () => {
  seed = await seedTestData();
  httpServer = app.listen(0);
  port = httpServer.address().port;
  initSocket(httpServer);
});

after(async () => {
  await teardown(httpServer, sessionStore);
});

/**
 * Helper: realiza login HTTP y retorna la cookie de sesión.
 */
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

/**
 * Helper: crea un cliente Socket.IO con cookie de sesión.
 */
function createSocketClient(cookie) {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    extraHeaders: cookie ? { Cookie: cookie } : {},
    autoConnect: false,
  });
}

/**
 * Helper: conecta un socket y espera el evento 'connect'.
 */
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

// ================================================================
// Tests de autenticación básica
// ================================================================
describe("WebSocket Authentication (6.5)", () => {
  it("rechaza conexión sin sesión (anónimo)", async () => {
    const socket = createSocketClient(null);
    
    const error = await new Promise((resolve) => {
      socket.on("connect_error", (err) => {
        resolve(err);
      });
      socket.connect();
    });
    
    assert.ok(error, "Debería recibir un error de conexión");
    assert.ok(
      error.message.includes("No autorizado") || error.message.includes("Unauthorized"),
      `Error esperado de autenticación, recibido: ${error.message}`
    );
    socket.disconnect();
  });

  it("permite conexión autenticada con sesión válida", async () => {
    const cookie = await loginAndGetCookie("test-client@example.com", "password123");
    assert.ok(cookie, "Debería obtener cookie de sesión");
    
    const socket = createSocketClient(cookie);
    await connectSocket(socket);
    
    assert.ok(true, "Debería conectar exitosamente");
    socket.disconnect();
  });

  it("permite join_availability para worker del mismo negocio", async () => {
    const cookie = await loginAndGetCookie("test-client@example.com", "password123");
    const socket = createSocketClient(cookie);
    await connectSocket(socket);
    
    const workerId = seed.worker._id.toString();
    
    // join_availability no emite callback; si hay error emite ws_error
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve("ok"), 1500);
      socket.on("ws_error", (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      socket.emit("join_availability", { workerId, date: "2026-07-22" });
    });
    
    assert.equal(result, "ok", "No debería recibir ws_error para worker del mismo negocio");
    socket.disconnect();
  });
});

// ================================================================
// Tests de aislamiento multitenant
// ================================================================
describe("WebSocket Multitenant Isolation", () => {
  it("rechaza join_availability cuando el worker pertenece a otro negocio", async () => {
    // Usuario del negocio A intenta acceder a un worker del negocio B
    const cookieA = await loginAndGetCookie("test-client@example.com", "password123");
    const socketA = createSocketClient(cookieA);
    await connectSocket(socketA);

    // workerB pertenece al negocio B
    const workerBId = seed.workerB._id.toString();

    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve("timeout_sin_error"), 2000);
      socketA.on("ws_error", (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      socketA.emit("join_availability", { workerId: workerBId, date: "2026-07-22" });
    });

    assert.ok(
      result && result.message && result.message.includes("no pertenece"),
      `Debería rechazar con "no pertenece a su negocio", recibido: ${JSON.stringify(result)}`
    );
    socketA.disconnect();
  });

  it("socket del negocio B no recibe calendar_update emitido para el negocio A", async () => {
    // Conectar socket del negocio A
    const cookieA = await loginAndGetCookie("test-client@example.com", "password123");
    const socketA = createSocketClient(cookieA);
    await connectSocket(socketA);

    // Conectar socket del negocio B
    const cookieB = await loginAndGetCookie("user-b@example.com", "passwordUserB");
    const socketB = createSocketClient(cookieB);
    await connectSocket(socketB);

    // Registrar si cada socket recibe calendar_update
    let socketAReceived = false;
    let socketBReceived = false;

    socketA.on("calendar_update", () => {
      socketAReceived = true;
    });
    socketB.on("calendar_update", () => {
      socketBReceived = true;
    });

    // Emitir calendar_update para el negocio A
    const businessAId = seed.business._id.toString();
    const workerAId = seed.worker._id.toString();
    emitAvailabilityChange(workerAId, "2026-07-22", businessAId);

    // Esperar un tiempo prudencial para que los eventos se propaguen
    await new Promise((resolve) => setTimeout(resolve, 1000));

    assert.equal(socketAReceived, true, "Socket A DEBE recibir calendar_update de su propio negocio");
    assert.equal(socketBReceived, false, "Socket B NO debe recibir calendar_update del negocio A");

    socketA.disconnect();
    socketB.disconnect();
  });
});
