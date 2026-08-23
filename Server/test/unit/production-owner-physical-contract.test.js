import test from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  buildProductionOwnerManifest,
  verifyProductionOwnerReadyState,
} from "../../scripts/bootstrap/production-initial-owners.js";

const ownerEnvironment = () => ({
  PRODUCTION_BOOTSTRAP_ATMOSFERA_FIRST_NAME: "Owner",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_LAST_NAME: "Atmósfera",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_EMAIL: "owner-atmosfera@example.test",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_PASSWORD: "atmosfera-owner-safe",
  PRODUCTION_BOOTSTRAP_DAM_FIRST_NAME: "Owner",
  PRODUCTION_BOOTSTRAP_DAM_LAST_NAME: "DAM",
  PRODUCTION_BOOTSTRAP_DAM_EMAIL: "owner-dam@example.test",
  PRODUCTION_BOOTSTRAP_DAM_PASSWORD: "dam-owner-password",
});

const exactIndexes = () => ({
  businessIndexes: [{ name: "slug_1", key: { slug: 1 }, unique: true }],
  userIndexes: [{ name: "email_1", key: { email: 1 }, unique: true }],
  membershipIndexes: [{
    name: "user_1_business_1",
    key: { user: 1, business: 1 },
    unique: true,
  }],
});

const readySource = (manifest) => {
  const businessIds = new Map(
    manifest.businesses.map((business) => [business.key, new mongo.ObjectId()]),
  );
  const userIds = new Map(
    manifest.users.map((user) => [user.key, new mongo.ObjectId()]),
  );
  return {
    observedCollections: ["businesses", "memberships", "users"],
    ...exactIndexes(),
    businesses: manifest.businesses.map((business) => ({
      _id: businessIds.get(business.key),
      name: business.name,
      slug: business.slug,
      isActive: true,
      subscriptionStatus: "active",
      owner: userIds.get(`${business.key}-admin`),
    })),
    users: manifest.users.map((user) => ({
      _id: userIds.get(user.key),
      firstName: user.firstName,
      lastName: user.lastName,
      email: [user.email],
      password: `hash:${user.password}`,
      role: "admin",
      isActive: true,
    })),
    memberships: manifest.memberships.map((membership) => ({
      _id: new mongo.ObjectId(),
      user: userIds.get(membership.userKey),
      business: businessIds.get(membership.businessKey),
      role: "admin",
      isActive: true,
    })),
  };
};

const verifier = async (password, hash) => hash === `hash:${password}`;

test("production owner ready-state requires BSON ObjectId references physically", async () => {
  const manifest = buildProductionOwnerManifest(ownerEnvironment());
  const source = readySource(manifest);

  source.businesses[0].owner = source.businesses[0].owner.toHexString();
  source.memberships[1].user = source.memberships[1].user.toHexString();

  const result = await verifyProductionOwnerReadyState(source, manifest, verifier);
  assert.equal(result.ready, false);
  assert.ok(result.findings.includes("businessMismatch:atmosfera"));
  assert.ok(result.findings.includes("membershipMismatch:dam:admin"));
});

test("production owner ready-state rejects persisted User.business even when null", async () => {
  const manifest = buildProductionOwnerManifest(ownerEnvironment());
  const source = readySource(manifest);
  source.users[0].business = null;

  const result = await verifyProductionOwnerReadyState(source, manifest, verifier);
  assert.equal(result.ready, false);
  assert.ok(result.findings.includes("userMismatch:atmosfera-admin"));
});
