import test from "node:test";
import assert from "node:assert/strict";
import CustomerProfile from "../../src/db/models/customerProfile.model.js";
import * as customerProfileRepository from "../../src/repositories/customerProfile.repository.js";

test("6.2.5-B CustomerProfile persistence contract", () => {
  assert.ok(CustomerProfile.schema.path("business"));
  assert.equal(CustomerProfile.schema.path("business").isRequired, true);
  assert.equal(CustomerProfile.schema.path("user"), undefined);
  assert.equal(CustomerProfile.schema.path("membership"), undefined);
  assert.equal(CustomerProfile.schema.path("binding"), undefined);

  const indexes = CustomerProfile.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    fields.business === 1
    && fields.createdAt === -1
    && options.name === "customer_profile_business_created_at"
  )));

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
