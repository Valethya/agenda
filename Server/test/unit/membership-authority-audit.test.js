import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildMembershipAuthorityPayload,
  buildMembershipAuthorityReport,
  canonicalize,
  checksumCanonicalPayload,
  inspectMembershipIndexes,
  isExactMembershipUniqueIndex,
  readMembershipAuthoritySnapshot,
  serializeCanonicalPayload,
} from "../../scripts/migrations/membership-authority-audit.js";
import {
  main,
  parseMembershipAuthorityArgs,
  runMembershipAuthorityAudit,
} from "../../scripts/migrations/membership-authority.js";

const id = (value) => value.toString(16).padStart(24, "0");

const exactIndex = {
  name: "user_1_business_1",
  key: { user: 1, business: 1 },
  unique: true,
  v: 2,
};

const snapshot = (overrides = {}) => ({
  databaseName: "agenda_test",
  collectionState: {
    observed: ["businesses", "memberships", "users"],
  },
  snapshotConsistency: {
    consistent: true,
    firstFingerprint: "fixture",
    secondFingerprint: "fixture",
  },
  indexes: [exactIndex],
  users: [],
  businesses: [],
  memberships: [],
  ...overrides,
});

const sourceRead = (overrides = {}) => ({
  collections: ["users", "businesses", "memberships"],
  indexes: [exactIndex],
  users: [],
  businesses: [],
  memberships: [],
  duplicatePairs: [],
  ...overrides,
});

const createSequencedDb = (reads, calls = []) => {
  let readIndex = -1;
  const current = () => reads[Math.min(readIndex, reads.length - 1)];

  return {
    databaseName: "agenda_test",
    listCollections(_filter, options) {
      readIndex += 1;
      calls.push({ operation: "listCollections", options });
      return {
        async toArray() {
          return current().collections.map((name) => ({ name }));
        },
      };
    },
    collection(name) {
      return {
        find(_filter, options) {
          calls.push({ operation: `find:${name}`, options });
          return {
            sort() {
              return {
                async toArray() {
                  return current()[name];
                },
              };
            },
          };
        },
        listIndexes(options) {
          calls.push({ operation: `listIndexes:${name}`, options });
          return {
            async toArray() {
              return current().indexes;
            },
          };
        },
        aggregate(_pipeline, options) {
          calls.push({ operation: `aggregate:${name}`, options });
          return {
            async toArray() {
              return current().duplicatePairs;
            },
          };
        },
      };
    },
  };
};

const categories = (payload, category) =>
  payload.findings.filter((finding) => finding.category === category);

describe("membership authority audit", () => {
  it("reconoce únicamente el índice físico compuesto exacto y único", () => {
    assert.equal(isExactMembershipUniqueIndex(exactIndex), true);
    assert.equal(
      isExactMembershipUniqueIndex({
        key: { user: 1, business: 1 },
        unique: false,
      }),
      false,
    );
    assert.equal(
      isExactMembershipUniqueIndex({
        key: { business: 1, user: 1 },
        unique: true,
      }),
      false,
    );
    assert.equal(
      isExactMembershipUniqueIndex({
        key: { user: 1, business: 1 },
        unique: true,
        partialFilterExpression: { isActive: true },
      }),
      false,
    );

    const inspection = inspectMembershipIndexes([
      { key: { user: 1 }, name: "user_1" },
      exactIndex,
    ]);
    assert.equal(inspection.exactUniqueExists, true);
    assert.deepEqual(inspection.expectedKey, [
      ["user", 1],
      ["business", 1],
    ]);
  });

  it("bloquea el audit cuando falta el índice físico exacto", () => {
    const payload = buildMembershipAuthorityPayload(snapshot({ indexes: [] }));

    assert.equal(payload.safeToApply, false);
    assert.equal(payload.preconditions.membershipUniqueIndex.exactUniqueExists, false);
    assert.equal(categories(payload, "missingUniqueMembershipIndex").length, 1);
  });

  for (const collection of ["users", "businesses", "memberships"]) {
    it(`bloquea cuando falta la colección física ${collection}`, async () => {
      const incompleteRead = sourceRead({
        collections: ["users", "businesses", "memberships"].filter(
          (name) => name !== collection,
        ),
        [collection]: null,
        ...(collection === "memberships"
          ? { indexes: null, duplicatePairs: null }
          : {}),
      });
      const result = await readMembershipAuthoritySnapshot(
        createSequencedDb([incompleteRead, structuredClone(incompleteRead)]),
        { startSession: null },
      );
      const payload = buildMembershipAuthorityPayload(result.snapshot);

      assert.equal(payload.safeToApply, false);
      assert.equal(payload.sources[collection], null);
      assert.equal(payload.counts[collection], null);
      assert.deepEqual(categories(payload, "missingRequiredCollection"), [
        {
          category: "missingRequiredCollection",
          blocking: true,
          collection,
        },
      ]);
      assert.deepEqual(
        payload.preconditions.collections.expected,
        ["businesses", "memberships", "users"],
      );
      assert.equal(
        payload.preconditions.collections.observed.includes(collection),
        false,
      );
    });
  }

  it("acepta colecciones físicas existentes aunque estén vacías", async () => {
    const emptyRead = sourceRead();
    const result = await readMembershipAuthoritySnapshot(
      createSequencedDb([emptyRead, structuredClone(emptyRead)]),
      { startSession: null },
    );
    const payload = buildMembershipAuthorityPayload(result.snapshot);

    assert.equal(payload.safeToApply, true);
    assert.equal(payload.schemaVersion, 2);
    assert.deepEqual(payload.sources, {
      users: [],
      businesses: [],
      memberships: [],
    });
    assert.equal(categories(payload, "missingRequiredCollection").length, 0);
  });

  it("bloquea una restauración incompleta con sólo memberships e índice", async () => {
    const incompleteRead = sourceRead({
      collections: ["memberships"],
      users: null,
      businesses: null,
    });
    const result = await readMembershipAuthoritySnapshot(
      createSequencedDb([incompleteRead, structuredClone(incompleteRead)]),
      { startSession: null },
    );
    const payload = buildMembershipAuthorityPayload(result.snapshot);

    assert.equal(payload.safeToApply, false);
    assert.deepEqual(
      categories(payload, "missingRequiredCollection").map(
        (finding) => finding.collection,
      ),
      ["businesses", "users"],
    );
    assert.equal(
      payload.preconditions.membershipUniqueIndex.exactUniqueExists,
      true,
    );
  });

  const coherentUserId = id(41);
  const coherentBusinessId = id(42);
  const secondBusinessId = id(43);
  const coherentMembershipId = id(44);
  const secondMembershipId = id(45);
  const coherentRead = sourceRead({
    users: [
      {
        _id: coherentUserId,
        role: "admin",
        business: coherentBusinessId,
        isActive: true,
      },
    ],
    businesses: [
      {
        _id: coherentBusinessId,
        owner: coherentUserId,
        isActive: true,
      },
      {
        _id: secondBusinessId,
        isActive: true,
      },
    ],
    memberships: [
      {
        _id: coherentMembershipId,
        user: coherentUserId,
        business: coherentBusinessId,
        role: "admin",
        isActive: true,
      },
    ],
  });

  const consistencyChanges = [
    {
      name: "cambio de rol",
      mutate: (read) => ({
        ...read,
        users: [{ ...read.users[0], role: "worker" }],
      }),
    },
    {
      name: "cambio de negocio heredado",
      mutate: (read) => ({
        ...read,
        users: [{ ...read.users[0], business: secondBusinessId }],
      }),
    },
    {
      name: "cambio de propietario",
      mutate: (read) => ({
        ...read,
        businesses: [{ ...read.businesses[0], owner: null }, read.businesses[1]],
      }),
    },
    {
      name: "activación o desactivación de Membership",
      mutate: (read) => ({
        ...read,
        memberships: [{ ...read.memberships[0], isActive: false }],
      }),
    },
    {
      name: "inserción de Membership sin duplicados",
      mutate: (read) => ({
        ...read,
        memberships: [
          ...read.memberships,
          {
            _id: secondMembershipId,
            user: coherentUserId,
            business: secondBusinessId,
            role: "worker",
            isActive: true,
          },
        ],
      }),
    },
    {
      name: "eliminación de Membership sin duplicados",
      mutate: (read) => ({
        ...read,
        memberships: [],
      }),
    },
    {
      name: "cambio de índice",
      mutate: (read) => ({
        ...read,
        indexes: [{ name: "_id_", key: { _id: 1 }, unique: true }],
      }),
    },
  ];

  for (const change of consistencyChanges) {
    it(`bloquea double-read ante ${change.name}`, async () => {
      const result = await readMembershipAuthoritySnapshot(
        createSequencedDb([coherentRead, change.mutate(coherentRead)]),
        { startSession: null },
      );
      const payload = buildMembershipAuthorityPayload(result.snapshot);

      assert.equal(result.readStrategy, "double-read");
      assert.equal(
        payload.preconditions.snapshotConsistency.consistent,
        false,
      );
      assert.equal(categories(payload, "snapshotInconsistency").length, 1);
      assert.equal(payload.safeToApply, false);
    });
  }

  it("acepta dos lecturas completas idénticas", async () => {
    const result = await readMembershipAuthoritySnapshot(
      createSequencedDb([coherentRead, structuredClone(coherentRead)]),
      { startSession: null },
    );
    const payload = buildMembershipAuthorityPayload(result.snapshot);

    assert.equal(result.readStrategy, "double-read");
    assert.equal(payload.preconditions.snapshotConsistency.consistent, true);
    assert.equal(categories(payload, "snapshotInconsistency").length, 0);
    assert.equal(payload.safeToApply, true);
  });

  it("devuelve código no cero cuando double-read detecta un cambio", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "membership-authority-inconsistent-"),
    );
    const reportPath = path.join(temporaryDirectory, "audit.json");

    try {
      const changedRead = {
        ...coherentRead,
        users: [{ ...coherentRead.users[0], role: "worker" }],
      };
      const result = await runMembershipAuthorityAudit({
        mongoUri: "mongodb://127.0.0.1:27017/agenda_test",
        environment: "test",
        database: "agenda_test",
        report: reportPath,
        connect: async () => {},
        disconnect: async () => {},
        connection: {
          db: createSequencedDb([coherentRead, changedRead]),
        },
        startSession: null,
      });

      assert.equal(result.exitCode, 2);
      assert.equal(result.report.canonicalPayload.safeToApply, false);
      assert.equal(
        categories(
          result.report.canonicalPayload,
          "snapshotInconsistency",
        ).length,
        1,
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("usa la misma sesión snapshot en todas las lecturas y siempre la cierra", async () => {
    const calls = [];
    const session = {
      async endSession() {
        calls.push({ operation: "endSession" });
      },
    };
    const result = await readMembershipAuthoritySnapshot(
      createSequencedDb([coherentRead], calls),
      {
        startSession: async (options) => {
          assert.deepEqual(options, {
            snapshot: true,
            causalConsistency: false,
          });
          return session;
        },
      },
    );

    assert.equal(result.readStrategy, "snapshot");
    assert.equal(
      calls
        .filter((call) => call.options)
        .every((call) => call.options.session === session),
      true,
    );
    assert.equal(calls.at(-1).operation, "endSession");
  });

  it("usa double-read cuando la topología rechaza readConcern snapshot", async () => {
    let sessionEnded = false;
    const reads = [coherentRead, structuredClone(coherentRead)];
    const db = createSequencedDb(reads);
    const originalListCollections = db.listCollections.bind(db);
    let snapshotAttempt = true;
    db.listCollections = (...args) => {
      if (snapshotAttempt) {
        snapshotAttempt = false;
        const error = new Error("Snapshot reads are not supported on standalone");
        error.code = 72;
        throw error;
      }
      return originalListCollections(...args);
    };

    const result = await readMembershipAuthoritySnapshot(db, {
      startSession: async () => ({
        async endSession() {
          sessionEnded = true;
        },
      }),
    });

    assert.equal(sessionEnded, true);
    assert.equal(result.readStrategy, "double-read");
    assert.equal(result.snapshot.snapshotConsistency.consistent, true);
  });

  it("cierra la sesión snapshot y desconecta ante un error de lectura", async () => {
    let sessionEnded = false;
    let disconnected = false;
    const secretUri =
      "mongodb://private-user:private-pass@cluster.example:27017/agenda_test";

    await assert.rejects(
      () =>
        runMembershipAuthorityAudit({
          mongoUri: secretUri,
          environment: "test",
          database: "agenda_test",
          report: "./artifacts/no-debe-escribirse.json",
          connect: async () => {},
          disconnect: async () => {
            disconnected = true;
          },
          connection: {
            db: {
              databaseName: "agenda_test",
              listCollections() {
                throw new Error("fallo de lectura controlado");
              },
            },
          },
          startSession: async () => ({
            async endSession() {
              sessionEnded = true;
            },
          }),
        }),
      /fallo de lectura controlado/,
    );

    assert.equal(sessionEnded, true);
    assert.equal(disconnected, true);
  });

  it("genera una candidata determinista y expone el cambio de login", () => {
    const userId = id(1);
    const businessId = id(2);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: userId,
            role: "admin",
            business: businessId,
            isActive: true,
            email: ["private@example.com"],
            phone: ["+56900000000"],
          },
        ],
        businesses: [
          {
            _id: businessId,
            owner: userId,
            isActive: true,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, true);
    assert.deepEqual(payload.candidates, [
      {
        user: userId,
        business: businessId,
        role: "admin",
        isActive: true,
        legacyEvidence: {
          userBusiness: businessId,
          userRole: "admin",
          userIsActive: true,
        },
        loginOutcomeBefore: "no_access",
        loginOutcomeAfter: "single",
      },
    ]);
    assert.equal(categories(payload, "eligibleBackfill").length, 1);
    assert.equal(categories(payload, "ownerWithoutAdminMembership")[0].blocking, false);
    assert.equal(JSON.stringify(payload).includes("private@example.com"), false);
    assert.equal(JSON.stringify(payload).includes("+56900000000"), false);
  });

  it("bloquea roles contradictorios y conserva la Membership existente", () => {
    const userId = id(3);
    const businessId = id(4);
    const membershipId = id(5);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: userId,
            role: "admin",
            business: businessId,
            isActive: true,
          },
        ],
        businesses: [{ _id: businessId, isActive: true }],
        memberships: [
          {
            _id: membershipId,
            user: userId,
            business: businessId,
            role: "worker",
            isActive: true,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(payload.candidates.length, 0);
    assert.deepEqual(categories(payload, "roleConflict"), [
      {
        category: "roleConflict",
        blocking: true,
        membership: membershipId,
        user: userId,
        business: businessId,
        legacyRole: "admin",
        membershipRole: "worker",
      },
    ]);
  });

  it("bloquea estado inactivo de Membership sin actualizarla", () => {
    const userId = id(6);
    const businessId = id(7);
    const membershipId = id(8);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: userId,
            role: "worker",
            business: businessId,
            isActive: true,
          },
        ],
        businesses: [{ _id: businessId, isActive: true }],
        memberships: [
          {
            _id: membershipId,
            user: userId,
            business: businessId,
            role: "worker",
            isActive: false,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(payload.candidates.length, 0);
    assert.equal(categories(payload, "membershipStateConflict").length, 1);
  });

  it("trata una Membership sin estado activo explícito como conflicto", () => {
    const userId = id(23);
    const businessId = id(24);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: userId,
            role: "admin",
            business: businessId,
            isActive: true,
          },
        ],
        businesses: [{ _id: businessId, isActive: true }],
        memberships: [
          {
            _id: id(25),
            user: userId,
            business: businessId,
            role: "admin",
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(categories(payload, "membershipStateConflict").length, 1);
  });

  it("detecta pares duplicados aunque el snapshot declare el índice", () => {
    const userId = id(9);
    const businessId = id(10);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: userId,
            role: "admin",
            business: businessId,
            isActive: true,
          },
        ],
        businesses: [{ _id: businessId, isActive: true }],
        memberships: [
          {
            _id: id(11),
            user: userId,
            business: businessId,
            role: "admin",
            isActive: true,
          },
          {
            _id: id(12),
            user: userId,
            business: businessId,
            role: "admin",
            isActive: true,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(payload.preconditions.duplicatePairCount, 1);
    assert.equal(categories(payload, "duplicateMembership")[0].count, 2);
  });

  it("bloquea un snapshot inconsistente entre la agregación y la lectura", () => {
    const userId = id(37);
    const businessId = id(38);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        memberships: [
          {
            _id: id(39),
            user: userId,
            business: businessId,
            role: "worker",
            isActive: true,
          },
        ],
        duplicatePairs: [
          {
            _id: { user: userId, business: businessId },
            memberships: [id(39), id(40)],
            count: 2,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(payload.preconditions.duplicateScan.consistent, false);
    assert.equal(categories(payload, "snapshotInconsistency").length, 1);
    assert.equal(categories(payload, "duplicateMembership").length, 1);
  });

  it("bloquea ownerWithoutAdminMembership sin evidencia legacy exacta", () => {
    const ownerId = id(13);
    const businessId = id(14);
    const otherBusinessId = id(15);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: ownerId,
            role: "admin",
            business: otherBusinessId,
            isActive: true,
          },
        ],
        businesses: [
          { _id: businessId, owner: ownerId, isActive: true },
          { _id: otherBusinessId, isActive: true },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(categories(payload, "ownerWithoutAdminMembership")[0].blocking, true);
  });

  it("bloquea inactiveIdentity y no genera una candidata", () => {
    const userId = id(16);
    const businessId = id(17);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: userId,
            role: "worker",
            business: businessId,
            isActive: false,
          },
        ],
        businesses: [{ _id: businessId, isActive: true }],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(payload.candidates.length, 0);
    assert.equal(categories(payload, "inactiveIdentity").length, 1);
  });

  it("bloquea referencias de negocio ausentes y roles legacy desconocidos", () => {
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: id(29),
            role: "admin",
            business: null,
            isActive: true,
          },
          {
            _id: id(30),
            role: "owner",
            business: id(31),
            isActive: true,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(categories(payload, "missingBusinessReference").length, 1);
    assert.equal(categories(payload, "unknownLegacyRole").length, 1);
  });

  it("no expone valores corruptos que puedan contener información personal", () => {
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [
          {
            _id: id(32),
            role: "private-role@example.com",
            business: "private-business@example.com",
            isActive: true,
          },
        ],
      }),
    );
    const serialized = JSON.stringify(payload);

    assert.equal(serialized.includes("private-role@example.com"), false);
    assert.equal(serialized.includes("private-business@example.com"), false);
    assert.equal(categories(payload, "unknownLegacyRole").length, 1);
  });

  it("bloquea Membership superadmin y referencias huérfanas", () => {
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        memberships: [
          {
            _id: id(18),
            user: id(19),
            business: id(20),
            role: "superadmin",
            isActive: true,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(categories(payload, "platformRoleInMembership").length, 1);
    assert.equal(categories(payload, "orphanMembership").length, 1);
  });

  it("bloquea roles de Membership desconocidos aunque no exista relación legacy", () => {
    const userId = id(26);
    const businessId = id(27);
    const payload = buildMembershipAuthorityPayload(
      snapshot({
        users: [{ _id: userId, role: "user", isActive: true }],
        businesses: [{ _id: businessId, isActive: true }],
        memberships: [
          {
            _id: id(28),
            user: userId,
            business: businessId,
            role: "owner",
            isActive: true,
          },
        ],
      }),
    );

    assert.equal(payload.safeToApply, false);
    assert.equal(categories(payload, "unknownMembershipRole").length, 1);
  });

  it("excluye timestamps y metadata del checksum canónico", () => {
    const userId = id(21);
    const businessId = id(22);
    const source = snapshot({
      users: [
        {
          _id: userId,
          role: "admin",
          business: businessId,
          isActive: true,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      businesses: [{ _id: businessId, isActive: true }],
    });

    const first = buildMembershipAuthorityReport(source, {
      generatedAt: "2026-07-27T00:00:00.000Z",
      codeSha: "first",
      environment: "test",
      mongoTargetFingerprint: "first-target",
      auditorVersion: "1.0.0",
      readStrategy: "snapshot",
    });
    const second = buildMembershipAuthorityReport(source, {
      generatedAt: "2026-07-28T00:00:00.000Z",
      codeSha: "second",
      environment: "production",
      mongoTargetFingerprint: "second-target",
      auditorVersion: "2.0.0",
      readStrategy: "double-read",
    });

    assert.equal(first.checksum.value, second.checksum.value);
    assert.equal(
      serializeCanonicalPayload(first.canonicalPayload).includes("updatedAt"),
      false,
    );

    const changed = buildMembershipAuthorityReport({
      ...source,
      users: [
        {
          ...source.users[0],
          role: "worker",
        },
      ],
    });
    assert.notEqual(first.checksum.value, changed.checksum.value);
  });

  it("produce el mismo checksum aunque MongoDB entregue documentos en otro orden", () => {
    const firstUserId = id(33);
    const secondUserId = id(34);
    const firstBusinessId = id(35);
    const secondBusinessId = id(36);
    const ordered = snapshot({
      users: [
        {
          _id: firstUserId,
          role: "admin",
          business: firstBusinessId,
          isActive: true,
        },
        {
          _id: secondUserId,
          role: "worker",
          business: secondBusinessId,
          isActive: true,
        },
      ],
      businesses: [
        { _id: firstBusinessId, isActive: true },
        { _id: secondBusinessId, isActive: true },
      ],
    });
    const reversed = {
      ...ordered,
      users: [...ordered.users].reverse(),
      businesses: [...ordered.businesses].reverse(),
    };

    assert.equal(
      buildMembershipAuthorityReport(ordered).checksum.value,
      buildMembershipAuthorityReport(reversed).checksum.value,
    );
  });

  it("canonicaliza claves y rechaza timestamps dentro del payload", () => {
    assert.equal(
      serializeCanonicalPayload({ z: 1, a: { d: 2, b: 1 } }),
      '{"a":{"b":1,"d":2},"z":1}',
    );
    assert.deepEqual(canonicalize({ b: undefined, a: true }), { a: true });
    assert.throws(
      () => checksumCanonicalPayload({ generatedAt: new Date() }),
      /no admite timestamps/,
    );
    assert.throws(
      () => checksumCanonicalPayload({ count: Number.NaN }),
      /no admite números no finitos/,
    );
  });

  it("rechaza modos mutables antes de conectar", async () => {
    assert.deepEqual(
      parseMembershipAuthorityArgs([
        "--mode=audit",
        "--environment=test",
        "--database",
        "agenda_test",
        "--report=./artifacts/audit.json",
        "--code-sha=explicit-sha",
      ]),
      {
        mode: "audit",
        environment: "test",
        database: "agenda_test",
        report: "./artifacts/audit.json",
        codeSha: "explicit-sha",
      },
    );

    await assert.rejects(
      () =>
        main([
          "--mode=apply",
          "--database=agenda_test",
          "--report=./artifacts/audit.json",
        ]),
      /sólo implementa --mode=audit/,
    );
  });

  it("rechaza entorno ausente o inválido antes de conectar", async () => {
    let connected = false;
    const common = {
      mongoUri: "mongodb://127.0.0.1:27017/agenda_test",
      database: "agenda_test",
      report: "./artifacts/no-debe-escribirse.json",
      connect: async () => {
        connected = true;
      },
    };

    await assert.rejects(
      () => runMembershipAuthorityAudit(common),
      /--environment es obligatorio/,
    );
    await assert.rejects(
      () =>
        runMembershipAuthorityAudit({
          ...common,
          environment: "external-production",
        }),
      /Entorno no permitido/,
    );
    assert.equal(connected, false);
  });

  it("rechaza una base distinta de la confirmada y siempre desconecta", async () => {
    let disconnected = false;
    await assert.rejects(
      () =>
        runMembershipAuthorityAudit({
          mongoUri: "mongodb://127.0.0.1:27017/otra_test",
          environment: "test",
          database: "agenda_test",
          report: "./artifacts/no-debe-escribirse.json",
          connect: async () => {},
          disconnect: async () => {
            disconnected = true;
          },
          connection: {
            db: {
              databaseName: "otra_test",
            },
          },
        }),
      /Base rechazada/,
    );
    assert.equal(disconnected, true);
  });

  it("ejecuta el audit con autoIndex desactivado y sólo usa lecturas MongoDB", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "membership-authority-audit-"),
    );
    const reportPath = path.join(temporaryDirectory, "audit.json");
    const calls = [];
    const documents = {
      users: [],
      businesses: [],
      memberships: [],
    };
    const fakeDb = {
      databaseName: "agenda_test",
      listCollections() {
        calls.push("listCollections");
        return {
          async toArray() {
            return Object.keys(documents).map((name) => ({ name }));
          },
        };
      },
      collection(name) {
        calls.push(`collection:${name}`);
        return {
          find() {
            calls.push(`find:${name}`);
            return {
              sort() {
                return {
                  async toArray() {
                    return documents[name];
                  },
                };
              },
            };
          },
          listIndexes() {
            calls.push(`listIndexes:${name}`);
            return {
              async toArray() {
                return name === "memberships" ? [exactIndex] : [];
              },
            };
          },
          aggregate() {
            calls.push(`aggregate:${name}`);
            return {
              async toArray() {
                return [];
              },
            };
          },
        };
      },
    };
    let disconnected = false;

    try {
      const result = await runMembershipAuthorityAudit({
        mongoUri:
          "mongodb://audit-user:audit-password@127.0.0.1:27017/agenda_test?authSource=admin&token=private-token",
        environment: "test",
        database: "agenda_test",
        report: reportPath,
        connect: async (_uri, options) => {
          assert.deepEqual(options, { autoIndex: false });
        },
        disconnect: async () => {
          disconnected = true;
        },
        connection: { db: fakeDb },
        now: () => new Date("2026-07-27T00:00:00.000Z"),
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.report.canonicalPayload.safeToApply, true);
      assert.equal(disconnected, true);
      assert.deepEqual(
        calls.filter((call) =>
          /insert|update|delete|bulkWrite|createIndex|dropIndex|findOneAndUpdate|replaceOne/u.test(
            call,
          ),
        ),
        [],
      );

      const persistedReport = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(persistedReport.checksum.value, result.report.checksum.value);
      assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
      assert.equal(
        persistedReport.metadata.generatedAt,
        "2026-07-27T00:00:00.000Z",
      );
      assert.equal(persistedReport.metadata.environment, "test");
      assert.equal(persistedReport.metadata.readStrategy, "double-read");
      assert.equal(persistedReport.metadata.auditorVersion, "1.1.0");
      assert.match(
        persistedReport.metadata.mongoTargetFingerprint,
        /^[a-f0-9]{64}$/u,
      );
      assert.equal(JSON.stringify(persistedReport).includes("audit-user"), false);
      assert.equal(
        JSON.stringify(persistedReport).includes("audit-password"),
        false,
      );
      assert.equal(
        JSON.stringify(persistedReport).includes("private-token"),
        false,
      );
      assert.equal(calls.includes("aggregate:memberships"), true);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
