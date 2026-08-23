import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";

const [
  { connectDB },
  fixtures,
  { default: BusinessConfig },
  publicWeb,
  constants,
] = await Promise.all([
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/db/models/businessConfig.model.js"),
  import("../src/services/publicWeb.service.js"),
  import("../src/config/publicWeb.constants.js"),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;
const {
  PUBLIC_WEB_ERROR_CODES,
  configurePublicWeb,
  resolveFreshPublicWebTrust,
  verifyPublicWeb,
} = publicWeb;
const { PUBLIC_WEB_VERIFIED_TRUST_TTL_MS } = constants;

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const rawFromState = (state) => {
  const value = state?.dnsVerification?.recordValue;
  assert.ok(typeof value === "string" && value.startsWith("agenda-verification="));
  return value.slice("agenda-verification=".length);
};

const configurePending = ({ businessId, origin, now }) => configurePublicWeb({
  businessId,
  websiteUrl: origin,
  bookingUrl: `${origin}/reservar`,
  now,
});

const assertCode = async (promise, code) => assert.rejects(
  promise,
  (error) => error?.code === code,
);

test("6.2.6-B DNS challenge freshness is authorized after resolver observation", async (t) => {
  await t.test("challenge expiring while resolveTxt is suspended cannot become verified", async () => {
    const issuedAt = new Date("2040-01-01T00:00:00.000Z");
    const pending = await configurePending({
      businessId: seed.business._id,
      origin: "https://dns-expiry-race.example.test",
      now: issuedAt,
    });
    const raw = rawFromState(pending);
    const challengeExpiresAt = new Date(pending.dnsVerification.challengeExpiresAt);

    let clockValue = new Date(issuedAt.getTime() + 1);
    const nowProvider = () => new Date(clockValue.getTime());

    let resolverEntered;
    const entered = new Promise((resolve) => { resolverEntered = resolve; });
    let releaseResolver;
    const resolverResult = new Promise((resolve) => { releaseResolver = resolve; });

    const verification = verifyPublicWeb({
      businessId: seed.business._id,
      nowProvider,
      resolveTxt: async () => {
        resolverEntered();
        return resolverResult;
      },
    });

    await entered;
    clockValue = new Date(challengeExpiresAt.getTime());
    releaseResolver([["agenda-verification=", raw]]);

    await assertCode(verification, PUBLIC_WEB_ERROR_CODES.CHALLENGE_EXPIRED);

    const stored = await BusinessConfig.findOne({ business: seed.business._id })
      .select("+publicWeb.challengeHash")
      .lean();
    assert.equal(stored.publicWeb.verificationStatus, "pending");
    assert.equal(stored.publicWeb.verifiedOrigin, null);
    assert.equal(stored.publicWeb.verifiedAt, null);
    assert.equal(stored.publicWeb.verificationValidUntil, null);
    assert.ok(stored.publicWeb.challengeHash);
    assert.equal(stored.publicWeb.trustGeneration, pending.trustGeneration);
    assert.equal(
      await resolveFreshPublicWebTrust({ businessId: seed.business._id, now: clockValue }),
      null,
    );
  });

  await t.test("proof observed strictly before challenge expiry uses proofObservedAt for trust freshness", async () => {
    const issuedAt = new Date("2041-01-01T00:00:00.000Z");
    const pending = await configurePending({
      businessId: seed.businessB._id,
      origin: "https://dns-before-expiry.example.test",
      now: issuedAt,
    });
    const raw = rawFromState(pending);
    const challengeExpiresAt = new Date(pending.dnsVerification.challengeExpiresAt);
    const requestObservedAt = new Date(issuedAt.getTime() + 1);
    const proofObservedAt = new Date(challengeExpiresAt.getTime() - 1);
    const observations = [requestObservedAt, proofObservedAt];
    let observationIndex = 0;

    const verified = await verifyPublicWeb({
      businessId: seed.businessB._id,
      nowProvider: () => new Date(observations[Math.min(observationIndex++, observations.length - 1)].getTime()),
      resolveTxt: async () => [["agenda-verification=", raw]],
    });

    assert.equal(observationIndex, 2);
    assert.equal(verified.verificationStatus, "verified");
    assert.equal(new Date(verified.verifiedAt).getTime(), proofObservedAt.getTime());
    assert.equal(
      new Date(verified.verificationValidUntil).getTime(),
      proofObservedAt.getTime() + PUBLIC_WEB_VERIFIED_TRUST_TTL_MS,
    );

    const trust = await resolveFreshPublicWebTrust({
      businessId: seed.businessB._id,
      now: proofObservedAt,
    });
    assert.equal(trust.origin, "https://dns-before-expiry.example.test");
  });
});

test.after(async () => {
  await teardown(null, null);
});
