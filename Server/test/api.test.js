import './setup.js';
import test from "node:test";
import assert from "node:assert";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Business from "../src/db/models/business.model.js";
import User from "../src/db/models/user.model.js";
import { createHash } from "../src/utils/password.js";

// Conectar a la base de datos de test
await connectDB();

// Sembrar dos negocios para comprobar resolución explícita y aislamiento.
await cleanTestData();
const seed = await seedTestData();

// Creamos un servidor de pruebas en un puerto dinámico efímero (evita colisiones de puerto)
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const loginAs = async (email, password) => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

test("Servidor Express - Endpoints Básicos", async (t) => {
  // Test 1: Verificar el estado de salud de la API (GET /api/health)
  await t.test("GET /api/health debería retornar status 200 y confirmación", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.message, "API running");
  });

  await t.test("GET /api/services sin negocio debería rechazar la solicitud", async () => {
    const response = await fetch(`${baseUrl}/services`);
    assert.strictEqual(response.status, 400);
  });

  await t.test("GET /api/services con slug inexistente no debería usar otro negocio", async () => {
    const response = await fetch(`${baseUrl}/services?slug=no-existe`);
    assert.strictEqual(response.status, 404);
    const data = await response.json();
    assert.strictEqual(data.message, "El negocio especificado no está disponible");
  });

  await t.test("GET /api/services con businessId mal formado debería retornar 400", async () => {
    const response = await fetch(`${baseUrl}/services?businessId=incorrecto`);
    assert.strictEqual(response.status, 400);
  });

  await t.test("GET /api/services debería rechazar ID y slug de negocios distintos", async () => {
    const response = await fetch(
      `${baseUrl}/services?businessId=${seed.business._id}&slug=${seed.businessB.slug}`
    );
    assert.strictEqual(response.status, 400);
  });

  await t.test("GET /api/services debería aceptar ID y slug del mismo negocio", async () => {
    const response = await fetch(
      `${baseUrl}/services?businessId=${seed.business._id}&slug=${seed.business.slug}`
    );
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.payload.length > 0);
    assert.ok(data.payload.every((service) => service.business === seed.business._id.toString()));
  });

  await t.test("GET /api/services no debería revelar un negocio inactivo al público", async () => {
    const inactiveBusiness = await Business.create({
      name: "Negocio Inactivo Test",
      slug: "negocio-inactivo-test",
      isActive: false,
    });
    const response = await fetch(`${baseUrl}/services?businessId=${inactiveBusiness._id}`);
    assert.strictEqual(response.status, 404);
    const data = await response.json();
    assert.strictEqual(data.message, "El negocio especificado no está disponible");
    assert.ok(!data.message.includes(inactiveBusiness.name));
  });

  // Obtener la configuración del negocio explícitamente seleccionado.
  await t.test("GET /api/business-settings debería inicializar y retornar la configuración", async () => {
    const response = await fetch(`${baseUrl}/business-settings?slug=${seed.business.slug}`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.status, "success");
    assert.ok(data.payload.businessName);
  });

  // Test 3: Listar servicios públicos (GET /api/services)
  await t.test("GET /api/services debería retornar el listado de servicios activos", async () => {
    const response = await fetch(`${baseUrl}/services?slug=${seed.business.slug}`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.status, "success");
    assert.ok(Array.isArray(data.payload));
  });

  // Test 4: Ruta inexistente debería retornar 404
  await t.test("GET /api/ruta-inexistente debería retornar error 404", async () => {
    const response = await fetch(`${baseUrl}/ruta-inexistente`);
    assert.strictEqual(response.status, 404);
    const data = await response.json();
    assert.strictEqual(data.error, "Route not found");
  });

  await t.test("Admin autenticado no debería cambiar de tenant mediante query", async () => {
    const cookie = await loginAs("test-admin@example.com", "passwordAdmin");
    const response = await fetch(`${baseUrl}/services?slug=${seed.businessB.slug}`, {
      headers: { Cookie: cookie },
    });
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.payload.length > 0);
    assert.ok(data.payload.every((service) => service.business === seed.business._id.toString()));
  });

  await t.test("Worker autenticado no debería cambiar de tenant mediante header", async () => {
    const cookie = await loginAs("test-worker@example.com", "passwordWorker");
    const response = await fetch(`${baseUrl}/services`, {
      headers: { Cookie: cookie, "x-business-slug": seed.businessB.slug },
    });
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.payload.length > 0);
    assert.ok(data.payload.every((service) => service.business === seed.business._id.toString()));
  });

  await t.test("Miembro autenticado de un negocio inactivo debería recibir 403", async () => {
    const cookie = await loginAs("test-admin@example.com", "passwordAdmin");
    await Business.findByIdAndUpdate(seed.business._id, { isActive: false });

    try {
      const response = await fetch(`${baseUrl}/services`, {
        headers: { Cookie: cookie },
      });
      assert.strictEqual(response.status, 403);
    } finally {
      await Business.findByIdAndUpdate(seed.business._id, { isActive: true });
    }
  });

  await t.test("Superadmin sin tenant explícito no debería seleccionar el primer negocio", async () => {
    const password = await createHash("passwordSuperadmin");
    await User.create({
      firstName: "Super",
      lastName: "Admin",
      email: ["superadmin-scope@example.com"],
      password,
      role: "superadmin",
      isActive: true,
    });
    const cookie = await loginAs("superadmin-scope@example.com", "passwordSuperadmin");

    const missingResponse = await fetch(`${baseUrl}/services`, {
      headers: { Cookie: cookie },
    });
    assert.strictEqual(missingResponse.status, 400);

    const invalidResponse = await fetch(`${baseUrl}/services?slug=no-existe`, {
      headers: { Cookie: cookie },
    });
    assert.strictEqual(invalidResponse.status, 404);
  });
});

// Liberamos los recursos al finalizar todas las pruebas
test.after(async () => {
  await teardown(server, sessionStore);
});
