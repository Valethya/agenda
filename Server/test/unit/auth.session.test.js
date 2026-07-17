import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test de funciones puras de sesión (resolveSessionFromUser)
// Importamos directamente la función desde auth.service
import { resolveSessionFromUser } from "../../src/services/auth.service.js";

describe("resolveSessionFromUser", () => {
  it("debería retornar type=superadmin para un usuario superadmin", () => {
    const user = {
      id: "abc123",
      firstName: "Admin",
      lastName: "Super",
      email: "admin@test.com",
      role: "superadmin",
      memberships: [],
    };

    const result = resolveSessionFromUser(user);

    assert.equal(result.type, "superadmin");
    assert.deepEqual(result.sessionUser, {
      id: "abc123",
      firstName: "Admin",
      lastName: "Super",
      email: "admin@test.com",
      role: "superadmin",
    });
    assert.equal(result.tempUser, undefined);
    assert.equal(result.memberships, undefined);
  });

  it("debería retornar type=single para usuario con 1 membresía", () => {
    const user = {
      id: "user1",
      firstName: "Juan",
      lastName: "Pérez",
      email: "juan@test.com",
      role: "user",
      memberships: [
        {
          id: "mem1",
          businessId: "biz1",
          businessName: "Mi Negocio",
          businessSlug: "mi-negocio",
          role: "admin",
        },
      ],
    };

    const result = resolveSessionFromUser(user);

    assert.equal(result.type, "single");
    assert.equal(result.sessionUser.id, "user1");
    assert.equal(result.sessionUser.role, "admin");
    assert.equal(result.sessionUser.businessId, "biz1");
    assert.equal(result.sessionUser.businessSlug, "mi-negocio");
  });

  it("debería retornar type=needs_selection para usuario con múltiples membresías", () => {
    const user = {
      id: "user2",
      firstName: "María",
      lastName: "López",
      email: "maria@test.com",
      role: "user",
      memberships: [
        { id: "mem1", businessId: "biz1", businessSlug: "negocio-1", role: "admin" },
        { id: "mem2", businessId: "biz2", businessSlug: "negocio-2", role: "worker" },
      ],
    };

    const result = resolveSessionFromUser(user);

    assert.equal(result.type, "needs_selection");
    assert.ok(result.tempUser);
    assert.equal(result.tempUser.id, "user2");
    assert.equal(result.memberships.length, 2);
    assert.equal(result.sessionUser, undefined);
  });

  it("debería lanzar error para usuario sin membresías (no superadmin)", () => {
    const user = {
      id: "user3",
      firstName: "Pedro",
      lastName: "García",
      email: "pedro@test.com",
      role: "user",
      memberships: [],
    };

    assert.throws(
      () => resolveSessionFromUser(user),
      { message: "Tu cuenta no tiene ningún negocio asociado" }
    );
  });

  it("debería lanzar error para usuario con memberships undefined", () => {
    const user = {
      id: "user4",
      firstName: "Ana",
      lastName: "Martínez",
      email: "ana@test.com",
      role: "worker",
    };

    assert.throws(
      () => resolveSessionFromUser(user),
      { message: "Tu cuenta no tiene ningún negocio asociado" }
    );
  });
});
