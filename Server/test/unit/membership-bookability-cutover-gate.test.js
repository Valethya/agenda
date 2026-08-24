import test from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  ADMIN_TEAM_BOOKABILITY_CUTOVER_CONFIRMATION,
  ADMIN_TEAM_BOOKABILITY_CUTOVER_ENV,
  assertMembershipBookabilityRuntimeStorageReady,
  isMembershipBookabilityRemoteRuntime,
} from "../../src/db/membership-bookability-cutover-gate.js";

const makeDb = ({ isBookable = false, indexes = null } = {}) => {
  const user = new mongo.ObjectId();
  const business = new mongo.ObjectId();
  const membership = {
    _id: new mongo.ObjectId(),
    user,
    business,
    role: "admin",
    isActive: true,
  };
  if (isBookable !== undefined) membership.isBookable = isBookable;
  const data = {
    memberships: [membership],
    users: [{ _id: user, isActive: true }],
    businesses: [{ _id: business, isActive: true }],
  };
  return {
    listCollections: () => ({
      toArray: async () => ["memberships", "users", "businesses"].map((name) => ({ name })),
    }),
    collection: (name) => ({
      find: () => ({ toArray: async () => structuredClone(data[name]) }),
      listIndexes: () => ({
        toArray: async () => structuredClone(indexes ?? [
          { name: "_id_", key: { _id: 1 }, unique: true },
          { name: "user_1_business_1", key: { user: 1, business: 1 }, unique: true },
        ]),
      }),
    }),
  };
};

const readyEnv = {
  NODE_ENV: "production",
  [ADMIN_TEAM_BOOKABILITY_CUTOVER_ENV]: ADMIN_TEAM_BOOKABILITY_CUTOVER_CONFIRMATION,
};

test("test local genuino queda exento", async () => {
  const result = await assertMembershipBookabilityRuntimeStorageReady(null, { NODE_ENV: "test" });
  assert.deepEqual(result, { enforced: false });
});

test("indicador de deployment gana sobre NODE_ENV=test", () => {
  assert.equal(isMembershipBookabilityRemoteRuntime({ NODE_ENV: "test", RAILWAY_PROJECT_ID: "x" }), true);
});

test("runtime remoto exige confirmación literal", async () => {
  await assert.rejects(
    assertMembershipBookabilityRuntimeStorageReady(makeDb(), { NODE_ENV: "production" }),
    /ADMIN_TEAM_BOOKABILITY_CUTOVER/,
  );
  await assert.rejects(
    assertMembershipBookabilityRuntimeStorageReady(makeDb(), {
      NODE_ENV: "production",
      [ADMIN_TEAM_BOOKABILITY_CUTOVER_ENV]: "wrong",
    }),
    /ADMIN_TEAM_BOOKABILITY_CUTOVER/,
  );
});

test("runtime remoto rechaza campo ausente o tipo no boolean", async () => {
  await assert.rejects(
    assertMembershipBookabilityRuntimeStorageReady(makeDb({ isBookable: undefined }), readyEnv),
    /sin boolean canónico/,
  );
  await assert.rejects(
    assertMembershipBookabilityRuntimeStorageReady(makeDb({ isBookable: "true" }), readyEnv),
    /isBookableNonBoolean/,
  );
});

test("runtime remoto rechaza índice ausente/incompatible", async () => {
  await assert.rejects(
    assertMembershipBookabilityRuntimeStorageReady(makeDb({ indexes: [
      { name: "_id_", key: { _id: 1 }, unique: true },
    ] }), readyEnv),
    /membershipUniqueIndexMissingOrIncompatible/,
  );
});

test("storage físico correcto + confirmación exacta pasa", async () => {
  const result = await assertMembershipBookabilityRuntimeStorageReady(makeDb(), readyEnv);
  assert.deepEqual(result, { enforced: true, ready: true });
});
