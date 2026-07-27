import "./setup.js";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { TEST_DB_URI } from "./setup.js";
import { connectDB } from "../src/db/db.js";
import User from "../src/db/models/user.model.js";
import Business from "../src/db/models/business.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";
import { cleanTestData } from "./fixtures.js";
import {
  runMembershipAuthorityAudit,
} from "../scripts/migrations/membership-authority.js";

const MUTATING_COMMANDS = new Set([
  "insert",
  "update",
  "delete",
  "findandmodify",
  "bulkwrite",
  "create",
  "drop",
  "createindexes",
  "dropindexes",
  "renamecollection",
  "collmod",
]);

const snapshotDatabase = async (db) => {
  const collectionNames = (
    await db.listCollections({}, { nameOnly: true }).toArray()
  )
    .map((collection) => collection.name)
    .sort();
  const collections = {};

  for (const collectionName of collectionNames) {
    const collection = db.collection(collectionName);
    collections[collectionName] = {
      documents: await collection.find({}).sort({ _id: 1 }).toArray(),
      indexes: (await collection.listIndexes().toArray()).sort((left, right) =>
        String(left.name).localeCompare(String(right.name)),
      ),
    };
  }

  return {
    collectionNames,
    collections,
  };
};

await connectDB();

test("entrada pública del audit no muta documentos, colecciones ni índices", async () => {
  await cleanTestData();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "membership-authority-e2e-"),
  );
  const reportPath = path.join(temporaryDirectory, "audit.json");
  const auditConnection = await mongoose
    .createConnection(TEST_DB_URI, {
      autoIndex: false,
      monitorCommands: true,
    })
    .asPromise();

  try {
    await Membership.init();

    const business = await Business.create({
      name: "Audit Membership Test",
      slug: "audit-membership-test",
      isActive: true,
    });
    const user = await User.create({
      firstName: "Audit",
      lastName: "Admin",
      email: ["audit-admin@example.com"],
      password: await createHash("auditPassword"),
      role: "admin",
      business: business._id,
      isActive: true,
    });
    business.owner = user._id;
    await business.save();
    await Membership.create({
      user: user._id,
      business: business._id,
      role: "admin",
      isActive: true,
    });

    const db = auditConnection.db;
    assert.match(db.databaseName, /_test$/u);
    const before = await snapshotDatabase(db);
    const observedCommands = [];
    const commandStarted = (event) => {
      observedCommands.push(event.commandName);
    };
    auditConnection.getClient().on("commandStarted", commandStarted);

    let result;
    try {
      result = await runMembershipAuthorityAudit({
        mongoUri: TEST_DB_URI,
        environment: "test",
        database: db.databaseName,
        report: reportPath,
        explicitCodeSha: "a".repeat(40),
        railwayGitCommitSha: "",
        githubSha: "",
        connect: async (_uri, options) => {
          assert.deepEqual(options, { autoIndex: false });
        },
        disconnect: async () => {},
        connection: auditConnection,
        startSession: auditConnection.startSession.bind(auditConnection),
        now: () => new Date("2026-07-27T00:00:00.000Z"),
      });
    } finally {
      auditConnection.getClient().off("commandStarted", commandStarted);
    }

    const after = await snapshotDatabase(db);
    const mutatingCommands = observedCommands.filter((commandName) =>
      MUTATING_COMMANDS.has(commandName.toLowerCase()),
    );
    const serializedReport = JSON.stringify(result.report);

    assert.deepEqual(after.collectionNames, before.collectionNames);
    assert.deepEqual(after.collections, before.collections);
    assert.deepEqual(mutatingCommands, []);
    assert.equal(observedCommands.includes("listCollections"), true);
    assert.equal(observedCommands.includes("find"), true);
    assert.equal(observedCommands.includes("listIndexes"), true);
    assert.equal(observedCommands.includes("aggregate"), true);
    assert.equal(result.report.metadata.environment, "test");
    assert.equal(result.report.metadata.codeShaSource, "explicit");
    assert.equal(
      serializedReport.includes(user._id.toHexString()),
      false,
    );
    assert.equal(serializedReport.includes("audit-admin@example.com"), false);

    if (result.report.metadata.readStrategy === "double-read") {
      assert.equal(result.exitCode, 2);
      assert.equal(result.report.canonicalPayload.safeToApply, false);
      assert.equal(
        result.report.canonicalPayload.preconditions.snapshotConsistency
          .temporalSnapshotGuaranteed,
        false,
      );
    } else {
      assert.equal(result.report.metadata.readStrategy, "snapshot");
      assert.equal(
        result.report.canonicalPayload.preconditions.snapshotConsistency
          .temporalSnapshotGuaranteed,
        true,
      );
    }
  } finally {
    await cleanTestData();
    await auditConnection.close();
    await mongoose.disconnect();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
