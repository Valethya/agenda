import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Business from "../../src/db/models/business.model.js";
import CustomerProfile from "../../src/db/models/customerProfile.model.js";
import * as customerProfileRepository from "../../src/repositories/customerProfile.repository.js";

test("6.2.5-B CustomerProfile persistence contract", () => {
  assert.ok(CustomerProfile.schema.path("business"));
  assert.equal(CustomerProfile.schema.path("business").isRequired, true);
  assert.equal(CustomerProfile.schema.path("user"), undefined);
  assert.equal(CustomerProfile.schema.path("membership"), undefined);
  assert.equal(CustomerProfile.schema.path("binding"), undefined);

  const indexes = CustomerProfile.schema.indexes();
  const declaredIndex = indexes.find(([, options]) => (
    options.name === "customer_profile_business_created_at_id"
  ));

  assert.ok(declaredIndex);
  assert.deepEqual(declaredIndex[0], { business: 1, createdAt: -1, _id: -1 });
  assert.equal(Boolean(declaredIndex[1].unique), false);

  for (const [fields, options] of indexes) {
    assert.equal(Boolean(options.unique), false);
    assert.equal(Object.hasOwn(fields, "email"), false);
    assert.equal(Object.hasOwn(fields, "phone"), false);
  }

  assert.deepEqual(
    Object.keys(customerProfileRepository).sort(),
    ["createForBusiness", "findAllByBusiness", "findByIdAndBusiness"],
  );
});

test("6.2.5-B pagination defaults and valid values are exact", async () => {
  const originalFind = CustomerProfile.find;
  const calls = [];

  CustomerProfile.find = (filter) => {
    const call = { filter, sort: null, skip: null, limit: null };
    calls.push(call);

    return {
      sort(value) {
        call.sort = value;
        return this;
      },
      skip(value) {
        call.skip = value;
        return this;
      },
      limit(value) {
        call.limit = value;
        return Promise.resolve([]);
      },
    };
  };

  try {
    const businessId = new mongoose.Types.ObjectId();

    await customerProfileRepository.findAllByBusiness(businessId);
    await customerProfileRepository.findAllByBusiness(businessId.toHexString(), { limit: 25, skip: 7 });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].limit, 100);
    assert.equal(calls[0].skip, 0);
    assert.deepEqual(calls[0].sort, { createdAt: -1, _id: -1 });
    assert.ok(calls[0].filter.business instanceof mongoose.Types.ObjectId);

    assert.equal(calls[1].limit, 25);
    assert.equal(calls[1].skip, 7);
    assert.deepEqual(calls[1].sort, { createdAt: -1, _id: -1 });
    assert.ok(calls[1].filter.business instanceof mongoose.Types.ObjectId);
  } finally {
    CustomerProfile.find = originalFind;
  }
});

test("6.2.5-B invalid pagination fails before any query", async () => {
  const originalFind = CustomerProfile.find;
  let queryCalls = 0;
  CustomerProfile.find = () => {
    queryCalls += 1;
    throw new Error("CustomerProfile.find must not execute for invalid pagination");
  };

  try {
    const businessId = new mongoose.Types.ObjectId();
    const invalidLimits = [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      "10",
      "not-a-number",
      {},
      [],
      null,
      undefined,
      101,
    ];
    const invalidSkips = [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      "10",
      "not-a-number",
      {},
      [],
      null,
      undefined,
    ];

    for (const limit of invalidLimits) {
      await assert.rejects(
        customerProfileRepository.findAllByBusiness(businessId, { limit }),
        TypeError,
      );
    }

    for (const skip of invalidSkips) {
      await assert.rejects(
        customerProfileRepository.findAllByBusiness(businessId, { skip }),
        TypeError,
      );
    }

    for (const options of [null, [], "bad-options", 1]) {
      await assert.rejects(
        customerProfileRepository.findAllByBusiness(businessId, options),
        TypeError,
      );
    }

    assert.equal(queryCalls, 0);
  } finally {
    CustomerProfile.find = originalFind;
  }
});

test("6.2.5-B ObjectId boundary accepts only ObjectId or 24-hex strings", async () => {
  const originalFindOne = CustomerProfile.findOne;
  const originalFind = CustomerProfile.find;
  const originalBusinessExists = Business.exists;
  let findOneCalls = 0;
  let findCalls = 0;
  let existsCalls = 0;

  CustomerProfile.findOne = () => {
    findOneCalls += 1;
    return Promise.resolve(null);
  };
  CustomerProfile.find = () => {
    findCalls += 1;
    return {
      sort() { return this; },
      skip() { return this; },
      limit() { return Promise.resolve([]); },
    };
  };
  Business.exists = () => {
    existsCalls += 1;
    return Promise.resolve(null);
  };

  try {
    const validProfileId = new mongoose.Types.ObjectId();
    const validBusinessId = new mongoose.Types.ObjectId();

    await customerProfileRepository.findByIdAndBusiness(validProfileId, validBusinessId.toHexString());
    assert.equal(findOneCalls, 1);

    const mongooseDocument = new CustomerProfile({ business: validBusinessId });
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
      mongooseDocument,
    ];

    for (const invalidId of invalidIds) {
      const findOneBefore = findOneCalls;
      await assert.rejects(
        customerProfileRepository.findByIdAndBusiness(invalidId, validBusinessId),
        TypeError,
      );
      await assert.rejects(
        customerProfileRepository.findByIdAndBusiness(validProfileId, invalidId),
        TypeError,
      );
      assert.equal(findOneCalls, findOneBefore);

      const findBefore = findCalls;
      await assert.rejects(
        customerProfileRepository.findAllByBusiness(invalidId),
        TypeError,
      );
      assert.equal(findCalls, findBefore);

      const existsBefore = existsCalls;
      await assert.rejects(
        customerProfileRepository.createForBusiness(invalidId, {}),
        TypeError,
      );
      assert.equal(existsCalls, existsBefore);
    }
  } finally {
    CustomerProfile.findOne = originalFindOne;
    CustomerProfile.find = originalFind;
    Business.exists = originalBusinessExists;
  }
});
