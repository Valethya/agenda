import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import Business from "../src/db/models/business.model.js";
import CustomerProfile from "../src/db/models/customerProfile.model.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import {
  createForBusiness,
  findAllByBusiness,
  findByIdAndBusiness,
} from "../src/repositories/customerProfile.repository.js";

await connectDB();

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const businessA = await Business.create({
  name: `Customer Profile A ${suffix}`,
  slug: `customer-profile-a-${suffix}`,
});
const businessB = await Business.create({
  name: `Customer Profile B ${suffix}`,
  slug: `customer-profile-b-${suffix}`,
});
const existingUser = await User.create({
  firstName: "Existing",
  lastName: "User",
  email: [`shared-${suffix}@example.com`],
  phone: ["+56911112222"],
  password: "not-used-in-customer-profile-test",
  role: "user",
});

const userCountBefore = await User.countDocuments();
const membershipCountBefore = await Membership.countDocuments();
const existingUserBefore = await User.findById(existingUser._id);

let profileA;
let profileB;
let duplicateA;

test("6.2.5-B tenant-scoped CustomerProfile persistence", async (t) => {
  await t.test("CustomerProfile requires Business", async () => {
    await assert.rejects(
      CustomerProfile.create({ firstName: "No", lastName: "Tenant" }),
      /negocio del perfil de cliente es obligatorio/u,
    );
  });

  await t.test("createForBusiness fails closed for a syntactically valid missing Business", async () => {
    const missingBusinessId = new mongoose.Types.ObjectId();
    const before = await CustomerProfile.countDocuments({ business: missingBusinessId });

    await assert.rejects(
      createForBusiness(missingBusinessId, {
        firstName: "No",
        lastName: "Tenant",
        email: `missing-${suffix}@example.com`,
      }),
      /Business existente/u,
    );

    assert.equal(await CustomerProfile.countDocuments({ business: missingBusinessId }), before);

    // Read operations guarantee syntactic scope + tenant filtering, not Business existence.
    assert.equal(
      await findByIdAndBusiness(new mongoose.Types.ObjectId(), missingBusinessId),
      null,
    );
    assert.deepEqual(
      await findAllByBusiness(missingBusinessId, { limit: 10, skip: 0 }),
      [],
    );
  });

  await t.test("CustomerProfile can exist without User and create is business-scoped", async () => {
    profileA = await createForBusiness(businessA._id, {
      firstName: "Alex",
      lastName: "Cliente",
      email: `shared-${suffix}@example.com`,
      phone: "+56911112222",
      user: existingUser._id,
      business: businessB._id,
    });

    assert.equal(profileA.business.toString(), businessA._id.toString());
    assert.equal(profileA.get("user"), undefined);
    assert.equal(profileA.get("membership"), undefined);
  });

  await t.test("Business A can read its profiles and cannot read Business B by valid id", async () => {
    profileB = await createForBusiness(businessB._id, {
      firstName: "Alex",
      lastName: "Cliente B",
      email: `shared-${suffix}@example.com`,
      phone: "+56911112222",
    });

    const own = await findByIdAndBusiness(profileA._id, businessA._id);
    assert.ok(own);
    assert.equal(own._id.toString(), profileA._id.toString());

    const crossTenant = await findByIdAndBusiness(profileB._id, businessA._id);
    assert.equal(crossTenant, null);

    const allA = await findAllByBusiness(businessA._id);
    assert.ok(allA.some((profile) => profile._id.toString() === profileA._id.toString()));
    assert.ok(allA.every((profile) => profile.business.toString() === businessA._id.toString()));
  });

  await t.test("matching declared contacts neither conflict nor auto-merge", async () => {
    duplicateA = await createForBusiness(businessA._id, {
      firstName: "Alex",
      lastName: "Cliente duplicado",
      email: `shared-${suffix}@example.com`,
      phone: "+56911112222",
    });

    assert.notEqual(profileA._id.toString(), profileB._id.toString());
    assert.notEqual(profileA._id.toString(), duplicateA._id.toString());

    const sameContactA = await CustomerProfile.countDocuments({
      business: businessA._id,
      email: `shared-${suffix}@example.com`,
      phone: "+56911112222",
    });
    assert.equal(sameContactA, 2);

    const pagedA = await findAllByBusiness(businessA._id, { limit: 1, skip: 1 });
    assert.equal(pagedA.length, 1);
    assert.equal(pagedA[0].business.toString(), businessA._id.toString());
  });

  await t.test("creating profiles has no User or Membership side effects", async () => {
    assert.equal(await User.countDocuments(), userCountBefore);
    assert.equal(await Membership.countDocuments(), membershipCountBefore);

    const existingUserAfter = await User.findById(existingUser._id);
    assert.deepEqual(existingUserAfter.email, existingUserBefore.email);
    assert.deepEqual(existingUserAfter.phone, existingUserBefore.phone);
    assert.equal(existingUserAfter.updatedAt.getTime(), existingUserBefore.updatedAt.getTime());

    assert.equal(CustomerProfile.schema.path("user"), undefined);
    assert.equal(CustomerProfile.schema.path("binding"), undefined);
  });
});

test.after(async () => {
  await CustomerProfile.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await Membership.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await User.deleteOne({ _id: existingUser._id });
  await Business.deleteMany({ _id: { $in: [businessA._id, businessB._id] } });
  await mongoose.disconnect();
});
