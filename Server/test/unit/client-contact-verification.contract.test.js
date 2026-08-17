import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Business from "../../src/db/models/business.model.js";
import ClientContactVerification, {
  CLIENT_CONTACT_VERIFICATION_CHANNELS,
  CLIENT_CONTACT_VERIFICATION_PURPOSES,
  CLIENT_CONTACT_VERIFICATION_STATUSES,
} from "../../src/db/models/clientContactVerification.model.js";
import * as verificationRepository from "../../src/repositories/clientContactVerification.repository.js";
import {
  CLIENT_CONTACT_VERIFICATION_ERROR_CODES,
  consumeVerificationForBusiness,
  issueVerificationForBusiness,
} from "../../src/services/clientContactVerification.service.js";

test("6.2.5-C1 Verification schema is tenant-scoped and purpose-bound", () => {
  assert.equal(ClientContactVerification.schema.path("business").isRequired, true);
  assert.equal(ClientContactVerification.schema.path("channel").isRequired, true);
  assert.equal(ClientContactVerification.schema.path("destination").isRequired, true);
  assert.equal(ClientContactVerification.schema.path("purpose").isRequired, true);
  assert.equal(ClientContactVerification.schema.path("secretHash").isRequired, true);
  assert.equal(ClientContactVerification.schema.path("expiresAt").isRequired, true);

  assert.deepEqual(CLIENT_CONTACT_VERIFICATION_CHANNELS, ["email"]);
  assert.deepEqual(CLIENT_CONTACT_VERIFICATION_PURPOSES, [
    "contact-control",
    "appointment-read-bootstrap",
    "appointment-cancel-bootstrap",
    "appointment-reschedule-bootstrap",
  ]);
  assert.deepEqual(CLIENT_CONTACT_VERIFICATION_STATUSES, [
    "pending",
    "consumed",
    "revoked",
  ]);

  assert.equal(ClientContactVerification.schema.path("user"), undefined);
  assert.equal(ClientContactVerification.schema.path("membership"), undefined);
  assert.equal(ClientContactVerification.schema.path("binding"), undefined);
  assert.equal(ClientContactVerification.schema.path("customerProfile"), undefined);
  assert.equal(ClientContactVerification.schema.path("appointment"), undefined);

  const indexes = ClientContactVerification.schema.indexes();
  const declaredIndex = indexes.find(([, options]) => (
    options.name === "client_verification_business_purpose_secret_status_expiry"
  ));

  assert.ok(declaredIndex);
  assert.deepEqual(
    declaredIndex[0],
    {
      business: 1,
      purpose: 1,
      secretHash: 1,
      status: 1,
      expiresAt: 1,
    },
  );
  assert.equal(Boolean(declaredIndex[1].unique), false);

  for (const [fields, options] of indexes) {
    assert.equal(Boolean(options.unique), false);
    assert.equal(Object.hasOwn(fields, "destination"), false);
    assert.equal(Object.hasOwn(fields, "email"), false);
    assert.equal(Object.hasOwn(fields, "phone"), false);
  }

  assert.deepEqual(
    Object.keys(verificationRepository).sort(),
    ["consumeForBusiness", "createForBusiness", "revokeForBusiness"],
  );
});

test("6.2.5-C1 strict ObjectIds fail before query", async () => {
  const originalExists = Business.exists;
  const originalFindOneAndUpdate = ClientContactVerification.findOneAndUpdate;
  let existsCalls = 0;
  let updateCalls = 0;

  Business.exists = () => {
    existsCalls += 1;
    return Promise.resolve({ _id: new mongoose.Types.ObjectId() });
  };
  ClientContactVerification.findOneAndUpdate = () => {
    updateCalls += 1;
    return Promise.resolve(null);
  };

  try {
    const validBusinessId = new mongoose.Types.ObjectId();
    const validVerificationId = new mongoose.Types.ObjectId();
    const documentAsId = new ClientContactVerification({
      business: validBusinessId,
      channel: "email",
      destination: "client@example.com",
      purpose: "contact-control",
      secretHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const invalidIds = [
      1,
      123456789012,
      "abcdefghijkl",
      "123456789012",
      "not-an-object-id",
      "",
      null,
      undefined,
      {},
      [],
      documentAsId,
    ];

    for (const invalidId of invalidIds) {
      const existsBefore = existsCalls;
      await assert.rejects(
        verificationRepository.createForBusiness(invalidId, {
          channel: "email",
          destination: "client@example.com",
          purpose: "contact-control",
          secretHash: "a".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        }),
        TypeError,
      );
      assert.equal(existsCalls, existsBefore);

      const updateBefore = updateCalls;
      await assert.rejects(
        verificationRepository.consumeForBusiness({
          businessId: invalidId,
          purpose: "contact-control",
          secretHash: "a".repeat(64),
          now: new Date(),
        }),
        TypeError,
      );
      await assert.rejects(
        verificationRepository.revokeForBusiness({
          verificationId: validVerificationId,
          businessId: invalidId,
          purpose: "contact-control",
          now: new Date(),
        }),
        TypeError,
      );
      await assert.rejects(
        verificationRepository.revokeForBusiness({
          verificationId: invalidId,
          businessId: validBusinessId,
          purpose: "contact-control",
          now: new Date(),
        }),
        TypeError,
      );
      assert.equal(updateCalls, updateBefore);
    }
  } finally {
    Business.exists = originalExists;
    ClientContactVerification.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("6.2.5-C1 invalid purpose and malformed secret fail before consume query", async () => {
  const originalFindOneAndUpdate = ClientContactVerification.findOneAndUpdate;
  let updateCalls = 0;
  ClientContactVerification.findOneAndUpdate = () => {
    updateCalls += 1;
    return Promise.resolve(null);
  };

  try {
    const businessId = new mongoose.Types.ObjectId();

    await assert.rejects(
      verificationRepository.consumeForBusiness({
        businessId,
        purpose: "anything-goes",
        secretHash: "a".repeat(64),
        now: new Date(),
      }),
      TypeError,
    );

    await assert.rejects(
      consumeVerificationForBusiness({
        businessId,
        purpose: "contact-control",
        secret: "malformed",
      }),
      (error) => (
        error.code === CLIENT_CONTACT_VERIFICATION_ERROR_CODES.INVALID_PROOF
        && error.message === "Verification no válida"
        && !error.message.includes("malformed")
      ),
    );

    assert.equal(updateCalls, 0);
  } finally {
    ClientContactVerification.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("6.2.5-C1 issue creates a challenge and preserves mailbox local-part case", async () => {
  const originalExists = Business.exists;
  const originalCreate = ClientContactVerification.create;
  const persistedPayloads = [];

  Business.exists = () => Promise.resolve({ _id: new mongoose.Types.ObjectId() });
  ClientContactVerification.create = async (payload) => {
    persistedPayloads.push(payload);
    return {
      _id: new mongoose.Types.ObjectId(),
      ...payload,
      status: "pending",
      consumedAt: null,
      revokedAt: null,
    };
  };

  try {
    const businessId = new mongoose.Types.ObjectId();
    const before = Date.now();
    const upperLocal = await issueVerificationForBusiness({
      businessId,
      destination: "  Alice@Example.COM  ",
      purpose: "contact-control",
      ttlMs: 60_000,
    });
    const lowerLocal = await issueVerificationForBusiness({
      businessId,
      destination: "alice@example.com",
      purpose: "contact-control",
      ttlMs: 60_000,
    });
    const after = Date.now();

    assert.equal(upperLocal.destination, "Alice@example.com");
    assert.equal(lowerLocal.destination, "alice@example.com");
    assert.notEqual(upperLocal.destination, lowerLocal.destination);
    assert.equal(persistedPayloads[0].destination, "Alice@example.com");
    assert.equal(persistedPayloads[1].destination, "alice@example.com");

    assert.match(upperLocal.secret, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(persistedPayloads[0].secret, undefined);
    assert.notEqual(persistedPayloads[0].secretHash, upperLocal.secret);
    assert.match(persistedPayloads[0].secretHash, /^[0-9a-f]{64}$/u);
    assert.ok(upperLocal.expiresAt.getTime() >= before + 60_000);
    assert.ok(upperLocal.expiresAt.getTime() <= after + 60_000);
    assert.equal(upperLocal.status, "pending");
  } finally {
    Business.exists = originalExists;
    ClientContactVerification.create = originalCreate;
  }
});
