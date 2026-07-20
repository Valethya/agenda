import './setup.js';
import test from "node:test";
import assert from "node:assert";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, teardown } from "./fixtures.js";

// Conectar a la base de datos de test
await connectDB();

// Sembrar datos base (se necesita al menos un Business para que scopeBusiness funcione)
await seedTestData();

// Creamos un servidor de pruebas en un puerto dinámico efímero (evita colisiones de puerto)
const server = app.listen(0);
const { port } = server.address();

test("Servidor Express - Endpoints Básicos", async (t) => {
  // Test 1: Verificar el estado de salud de la API (GET /api/health)
  await t.test("GET /api/health debería retornar status 200 y confirmación", async () => {
    const response = await fetch(`http://localhost:${port}/api/health`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.message, "API running");
  });

  // Test 2: Obtener la configuración por defecto del negocio (GET /api/business-settings)
  await t.test("GET /api/business-settings debería inicializar y retornar la configuración", async () => {
    const response = await fetch(`http://localhost:${port}/api/business-settings`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.status, "success");
    assert.ok(data.payload.businessName);
  });

  // Test 3: Listar servicios públicos (GET /api/services)
  await t.test("GET /api/services debería retornar el listado de servicios activos", async () => {
    const response = await fetch(`http://localhost:${port}/api/services`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.status, "success");
    assert.ok(Array.isArray(data.payload));
  });

  // Test 4: Ruta inexistente debería retornar 404
  await t.test("GET /api/ruta-inexistente debería retornar error 404", async () => {
    const response = await fetch(`http://localhost:${port}/api/ruta-inexistente`);
    assert.strictEqual(response.status, 404);
    const data = await response.json();
    assert.strictEqual(data.error, "Route not found");
  });
});

// Liberamos los recursos al finalizar todas las pruebas
test.after(async () => {
  await teardown(server, sessionStore);
});
