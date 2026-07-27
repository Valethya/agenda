import "./setup.js";

import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import User from "../src/db/models/user.model.js";
import Business from "../src/db/models/business.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";
import { cleanTestData } from "./fixtures.js";
import {
  buildMembershipAuthorityReport,
  readMembershipAuthoritySnapshot,
} from "../scripts/migrations/membership-authority-audit.js";

await connectDB();

test("audit Membership lee colecciones e índices sin modificar la base", async () => {
  await cleanTestData();

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

    const collections = ["users", "businesses", "memberships"];
    const before = Object.fromEntries(
      await Promise.all(
        collections.map(async (name) => [
          name,
          await mongoose.connection.db
            .collection(name)
            .find({})
            .sort({ _id: 1 })
            .toArray(),
        ]),
      ),
    );

    const { snapshot, readStrategy } =
      await readMembershipAuthoritySnapshot(mongoose.connection.db);
    const report = buildMembershipAuthorityReport(snapshot, {
      environment: "test",
      mongoTargetFingerprint: "integration-test-fingerprint",
      generatedAt: "2026-07-27T00:00:00.000Z",
      codeSha: "integration-test",
      auditorVersion: "integration-test",
      readStrategy,
    });

    const after = Object.fromEntries(
      await Promise.all(
        collections.map(async (name) => [
          name,
          await mongoose.connection.db
            .collection(name)
            .find({})
            .sort({ _id: 1 })
            .toArray(),
        ]),
      ),
    );

    assert.deepEqual(after, before);
    assert.equal(
      report.canonicalPayload.preconditions.membershipUniqueIndex.exactUniqueExists,
      true,
    );
    assert.equal(report.canonicalPayload.safeToApply, true);
    assert.equal(report.canonicalPayload.counts.candidates, 0);
    assert.equal(report.canonicalPayload.categoryCounts.alreadyConsistent, 1);
    assert.deepEqual(
      report.canonicalPayload.preconditions.collections.expected,
      ["businesses", "memberships", "users"],
    );
    assert.deepEqual(
      report.canonicalPayload.preconditions.collections.missing,
      [],
    );
    assert.equal(
      report.canonicalPayload.preconditions.snapshotConsistency.consistent,
      true,
    );
    assert.equal(["snapshot", "double-read"].includes(readStrategy), true);
    assert.equal(JSON.stringify(report).includes("audit-admin@example.com"), false);
    assert.equal(JSON.stringify(report.canonicalPayload).includes("updatedAt"), false);
  } finally {
    await cleanTestData();
    await mongoose.disconnect();
  }
});
