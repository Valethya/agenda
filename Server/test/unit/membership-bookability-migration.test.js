import test from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  MEMBERSHIP_BOOKABILITY_APPLY_CONFIRMATION,
  applyMembershipBookabilityMigration,
  inspectMembershipBookabilityStorage,
  parseMembershipBookabilityArgs,
  planMembershipBookabilityMigration,
  validateMembershipBookabilityOptions,
} from "../../scripts/migrations/membership-bookability.js";

const clone = (value) => structuredClone(value);

const makeDb = ({ memberships, users, businesses, services = [], indexes } = {}) => {
  const state = {
    memberships: clone(memberships ?? []),
    users: clone(users ?? []),
    businesses: clone(businesses ?? []),
    services: clone(services),
    indexes: clone(indexes ?? [
      { name: "_id_", key: { _id: 1 }, unique: true },
      { name: "user_1_business_1", key: { user: 1, business: 1 }, unique: true },
    ]),
    writes: 0,
  };
  const names = ["memberships", "users", "businesses", ...(services.length ? ["services"] : [])];
  const collection = (name) => ({
    find: (_query = {}, options = {}) => ({
      toArray: async () => {
        const docs = clone(state[name] ?? []);
        if (!options?.projection) return docs;
        return docs.map((doc) => Object.fromEntries(
          Object.keys(options.projection)
            .filter((key) => options.projection[key] && key in doc)
            .map((key) => [key, doc[key]]),
        ));
      },
    }),
    listIndexes: () => ({ toArray: async () => clone(state.indexes) }),
    updateOne: async (filter, update) => {
      const index = state.memberships.findIndex((doc) => (
        doc._id.toString() === filter._id.toString()
        && !("isBookable" in doc)
      ));
      if (index === -1) return { matchedCount: 0, modifiedCount: 0 };
      state.memberships[index].isBookable = update.$set.isBookable;
      state.writes += 1;
      return { matchedCount: 1, modifiedCount: 1 };
    },
  });
  return {
    state,
    listCollections: () => ({ toArray: async () => names.map((name) => ({ name })) }),
    collection,
  };
};

const fixture = () => {
  const business = new mongo.ObjectId();
  const worker = new mongo.ObjectId();
  const admin = new mongo.ObjectId();
  return {
    business,
    worker,
    admin,
    users: [
      { _id: worker, isActive: true },
      { _id: admin, isActive: true },
    ],
    businesses: [{ _id: business, isActive: true }],
    memberships: [
      { _id: new mongo.ObjectId(), user: worker, business, role: "worker", isActive: true },
      { _id: new mongo.ObjectId(), user: admin, business, role: "admin", isActive: true },
    ],
  };
};

test("plan es read-only y clasifica worker->true/admin->false sólo si falta el campo", async () => {
  const data = fixture();
  const db = makeDb(data);
  const plan = await planMembershipBookabilityMigration(db);
  assert.equal(db.state.writes, 0);
  assert.equal(plan.counts.missing, 2);
  assert.equal(plan.counts.toTrue, 1);
  assert.equal(plan.counts.toFalse, 1);
  assert.equal(plan.canApply, true);
});

test("apply escribe sólo campos ausentes, verifica e idempotiza", async () => {
  const data = fixture();
  const db = makeDb(data);
  const first = await applyMembershipBookabilityMigration(db);
  assert.equal(first.applied, 2);
  assert.equal(db.state.memberships.find((m) => m.role === "worker").isBookable, true);
  assert.equal(db.state.memberships.find((m) => m.role === "admin").isBookable, false);
  const second = await applyMembershipBookabilityMigration(db);
  assert.equal(second.applied, 0);
  assert.equal(db.state.writes, 2);
});

test("inactividad de Membership, User o Business fuerza false en pre-cutover", async () => {
  for (const target of ["membership", "user", "business"]) {
    const data = fixture();
    if (target === "membership") data.memberships[0].isActive = false;
    if (target === "user") data.users[0].isActive = false;
    if (target === "business") data.businesses[0].isActive = false;
    data.memberships = [data.memberships[0]];
    data.users = [data.users[0]];
    const db = makeDb(data);
    const inspection = await inspectMembershipBookabilityStorage(db);
    assert.equal(inspection.writes[0].isBookable, false, target);
  }
});

test("booleanos canónicos se preservan incluido admin+true válido", async () => {
  const data = fixture();
  data.memberships[0].isBookable = false;
  data.memberships[1].isBookable = true;
  const db = makeDb(data);
  const result = await applyMembershipBookabilityMigration(db);
  assert.equal(result.applied, 0);
  assert.equal(db.state.memberships[0].isBookable, false);
  assert.equal(db.state.memberships[1].isBookable, true);
});

test("tipo no boolean, referencia ausente, duplicado e índice incompatible bloquean", async () => {
  const cases = [];
  {
    const data = fixture(); data.memberships[0].isBookable = "true";
    cases.push([data, "isBookableNonBoolean"]);
  }
  {
    const data = fixture(); data.users = [data.users[1]];
    cases.push([data, "referencedUserMissing"]);
  }
  {
    const data = fixture(); data.businesses = [];
    cases.push([data, "referencedBusinessMissing"]);
  }
  {
    const data = fixture(); data.memberships.push({ ...data.memberships[0], _id: new mongo.ObjectId() });
    cases.push([data, "duplicateUserBusinessMembership"]);
  }
  for (const [data, expected] of cases) {
    const inspection = await inspectMembershipBookabilityStorage(makeDb(data));
    assert.ok(inspection.findings.includes(expected));
  }
  const data = fixture();
  const badIndexDb = makeDb({ ...data, indexes: [{ name: "_id_", key: { _id: 1 }, unique: true }] });
  const badIndex = await inspectMembershipBookabilityStorage(badIndexDb);
  assert.ok(badIndex.findings.includes("membershipUniqueIndexMissingOrIncompatible"));
});

test("bookable=true con entidad inactiva es contradicción física", async () => {
  const data = fixture();
  data.memberships[0].isBookable = true;
  data.memberships[0].isActive = false;
  const inspection = await inspectMembershipBookabilityStorage(makeDb(data));
  assert.ok(inspection.findings.includes("inactiveMembershipBookable"));
});

test("parser rechaza opciones desconocidas/duplicadas y apply exige confirmación/fingerprint", () => {
  assert.throws(() => parseMembershipBookabilityArgs(["--wat=x"]), /no reconocida/);
  assert.throws(() => parseMembershipBookabilityArgs(["--mode=plan", "--mode=apply"]), /duplicada/);
  assert.throws(() => validateMembershipBookabilityOptions(
    { mode: "apply", environment: "test" },
    { NODE_ENV: "test" },
  ), /confirm/);
  const fingerprint = "a".repeat(64);
  assert.doesNotThrow(() => validateMembershipBookabilityOptions({
    mode: "apply",
    environment: "test",
    expectedTargetFingerprint: fingerprint,
    confirm: MEMBERSHIP_BOOKABILITY_APPLY_CONFIRMATION,
  }, { NODE_ENV: "test" }));
});
