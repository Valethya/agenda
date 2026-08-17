import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import Business from "../src/db/models/business.model.js";
import ClientContactVerification from "../src/db/models/clientContactVerification.model.js";
import CustomerProfile from "../src/db/models/customerProfile.model.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import * as verificationRepository from "../src/repositories/clientContactVerification.repository.js";
import {
  CLIENT_CONTACT_VERIFICATION_ERROR_CODES,
  consumeVerificationForBusiness,
  issueVerificationForBusiness,
  revokeVerificationForBusiness,
} from "../src/services/clientContactVerification.service.js";

await connectDB();

const suffix = `${Date.now()}-${process.pid}`;
const sharedEmail = `verification-${suffix}@example.com`;
const businessA = await Business.create({
  name: `Verification A ${suffix}`,
  slug: `verification-a-${suffix}`,
});
const businessB = await Business.create({
  name: `Verification B ${suffix}`,
  slug: `verification-b-${suffix}`,
});
const existingUser = await User.create({
  firstName: "Existing",
  lastName: "Verification User",
  email: [sharedEmail],
  phone: [],
  password: "not-used-in-verification-test",
  role: "user",
});
const existingProfile = await CustomerProfile.create({
  business: businessA._id,
  firstName: "Existing",
  lastName: "Profile",
  email: sharedEmail,
});

const countsBefore = {
  users: await User.countDocuments(),
  memberships: await Membership.countDocuments(),
  appointments: await Appointment.countDocuments(),
  profiles: await CustomerProfile.countDocuments(),
};
const existingUserBefore = await User.findById(existingUser._id);
const existingProfileBefore = await CustomerProfile.findById(existingProfile._id);

const expectInvalidProof = async (promise) => {
  await assert.rejects(
    promise,
    (error) => (
      error.code === CLIENT_CONTACT_VERIFICATION_ERROR_CODES.INVALID_PROOF
      && error.message === "Verification no válida"
    ),
  );
};

test("6.2.5-C1 tenant-scoped client contact verification", async (t) => {
  await t.test("Verification requires Business and nonexistent Business fails closed", async () => {
    await assert.rejects(
      ClientContactVerification.create({
        channel: "email",
        destination: sharedEmail,
        purpose: "contact-control",
        secretHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
      /negocio de la verificación es obligatorio/u,
    );

    const missingBusinessId = new mongoose.Types.ObjectId();
    await assert.rejects(
      issueVerificationForBusiness({
        businessId: missingBusinessId,
        destination: sharedEmail,
        purpose: "contact-control",
      }),
      /Business no disponible/u,
    );

    assert.equal(
      await ClientContactVerification.countDocuments({ business: missingBusinessId }),
      0,
    );
  });

  await t.test("same contact has independent proofs in Business A and B", async () => {
    const issuedA = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: sharedEmail,
      purpose: "contact-control",
      ttlMs: 5 * 60_000,
    });
    const issuedB = await issueVerificationForBusiness({
      businessId: businessB._id,
      destination: sharedEmail,
      purpose: "contact-control",
      ttlMs: 5 * 60_000,
    });

    assert.notEqual(issuedA.verificationId.toString(), issuedB.verificationId.toString());
    assert.notEqual(issuedA.secret, issuedB.secret);

    const docA = await ClientContactVerification.findById(issuedA.verificationId)
      .select("+secretHash")
      .lean();
    const docB = await ClientContactVerification.findById(issuedB.verificationId)
      .select("+secretHash")
      .lean();

    assert.equal(docA.business.toString(), businessA._id.toString());
    assert.equal(docB.business.toString(), businessB._id.toString());
    assert.equal(docA.destination, sharedEmail);
    assert.equal(docB.destination, sharedEmail);
    assert.equal(docA.secret, undefined);
    assert.equal(docB.secret, undefined);
    assert.notEqual(docA.secretHash, issuedA.secret);
    assert.notEqual(docB.secretHash, issuedB.secret);

    await expectInvalidProof(
      consumeVerificationForBusiness({
        businessId: businessB._id,
        purpose: "contact-control",
        secret: issuedA.secret,
      }),
    );

    const consumedA = await consumeVerificationForBusiness({
      businessId: businessA._id,
      purpose: "contact-control",
      secret: issuedA.secret,
    });
    assert.equal(consumedA.status, "consumed");

    const consumedB = await consumeVerificationForBusiness({
      businessId: businessB._id,
      purpose: "contact-control",
      secret: issuedB.secret,
    });
    assert.equal(consumedB.status, "consumed");
  });

  await t.test("purpose mismatch and invalid secret do not validate", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: sharedEmail,
      purpose: "appointment-read-bootstrap",
      ttlMs: 5 * 60_000,
    });

    await expectInvalidProof(
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "appointment-cancel-bootstrap",
        secret: issued.secret,
      }),
    );

    const invalidSecret = `${issued.secret.slice(0, -1)}${issued.secret.endsWith("A") ? "B" : "A"}`;
    await expectInvalidProof(
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "appointment-read-bootstrap",
        secret: invalidSecret,
      }),
    );

    const consumed = await consumeVerificationForBusiness({
      businessId: businessA._id,
      purpose: "appointment-read-bootstrap",
      secret: issued.secret,
    });
    assert.equal(consumed.status, "consumed");
  });

  await t.test("expiresAt <= now is invalid even while document still exists", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: sharedEmail,
      purpose: "contact-control",
      ttlMs: 5 * 60_000,
    });

    const persistedWithHash = await ClientContactVerification.findById(issued.verificationId)
      .select("+secretHash");
    const exactExpiry = new Date();

    persistedWithHash.expiresAt = exactExpiry;
    await persistedWithHash.save();

    const exactBoundaryResult = await verificationRepository.consumeForBusiness({
      businessId: businessA._id,
      purpose: "contact-control",
      secretHash: persistedWithHash.secretHash,
      now: exactExpiry,
    });
    assert.equal(exactBoundaryResult, null);

    await expectInvalidProof(
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "contact-control",
        secret: issued.secret,
      }),
    );

    const persisted = await ClientContactVerification.findById(issued.verificationId);
    assert.ok(persisted);
    assert.equal(persisted.status, "pending");
    assert.equal(persisted.expiresAt.getTime(), exactExpiry.getTime());
  });

  await t.test("consumed proof is single-use", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: sharedEmail,
      purpose: "contact-control",
      ttlMs: 5 * 60_000,
    });

    const first = await consumeVerificationForBusiness({
      businessId: businessA._id,
      purpose: "contact-control",
      secret: issued.secret,
    });
    assert.equal(first.status, "consumed");

    await expectInvalidProof(
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "contact-control",
        secret: issued.secret,
      }),
    );
  });

  await t.test("revoked proof cannot be consumed or reactivated", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: sharedEmail,
      purpose: "contact-control",
      ttlMs: 5 * 60_000,
    });

    const revoked = await revokeVerificationForBusiness({
      verificationId: issued.verificationId,
      businessId: businessA._id,
      purpose: "contact-control",
    });
    assert.equal(revoked.status, "revoked");
    assert.ok(revoked.revokedAt);

    await expectInvalidProof(
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "contact-control",
        secret: issued.secret,
      }),
    );

    await expectInvalidProof(
      revokeVerificationForBusiness({
        verificationId: issued.verificationId,
        businessId: businessA._id,
        purpose: "contact-control",
      }),
    );
  });

  await t.test("concurrent consume is atomic: exactly one succeeds", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: sharedEmail,
      purpose: "contact-control",
      ttlMs: 5 * 60_000,
    });

    const results = await Promise.allSettled([
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "contact-control",
        secret: issued.secret,
      }),
      consumeVerificationForBusiness({
        businessId: businessA._id,
        purpose: "contact-control",
        secret: issued.secret,
      }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const persisted = await ClientContactVerification.findById(issued.verificationId);
    assert.equal(persisted.status, "consumed");
    assert.ok(persisted.consumedAt);
  });

  await t.test("verification has no User, Membership, CustomerProfile or Appointment side effects", async () => {
    assert.equal(await User.countDocuments(), countsBefore.users);
    assert.equal(await Membership.countDocuments(), countsBefore.memberships);
    assert.equal(await Appointment.countDocuments(), countsBefore.appointments);
    assert.equal(await CustomerProfile.countDocuments(), countsBefore.profiles);

    const existingUserAfter = await User.findById(existingUser._id);
    const existingProfileAfter = await CustomerProfile.findById(existingProfile._id);

    assert.deepEqual(existingUserAfter.email, existingUserBefore.email);
    assert.equal(existingUserAfter.updatedAt.getTime(), existingUserBefore.updatedAt.getTime());

    assert.equal(existingProfileAfter.email, existingProfileBefore.email);
    assert.equal(existingProfileAfter.updatedAt.getTime(), existingProfileBefore.updatedAt.getTime());

    assert.equal(ClientContactVerification.schema.path("user"), undefined);
    assert.equal(ClientContactVerification.schema.path("membership"), undefined);
    assert.equal(ClientContactVerification.schema.path("binding"), undefined);
    assert.equal(ClientContactVerification.schema.path("customerProfile"), undefined);
    assert.equal(ClientContactVerification.schema.path("appointment"), undefined);
  });
});

test.after(async () => {
  await ClientContactVerification.deleteMany({
    business: { $in: [businessA._id, businessB._id] },
  });
  await Membership.deleteMany({
    business: { $in: [businessA._id, businessB._id] },
  });
  await CustomerProfile.deleteMany({
    business: { $in: [businessA._id, businessB._id] },
  });
  await User.deleteOne({ _id: existingUser._id });
  await Business.deleteMany({
    _id: { $in: [businessA._id, businessB._id] },
  });
  await mongoose.disconnect();
});
