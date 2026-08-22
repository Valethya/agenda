import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example";

const [
  { default: app, sessionStore },
  { connectDB },
  fixtures,
  { default: BusinessConfig },
  { default: User },
  { default: Appointment },
  { createHash },
  publicWeb,
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/db/models/businessConfig.model.js"),
  import("../src/db/models/user.model.js"),
  import("../src/db/models/appointment.model.js"),
  import("../src/utils/password.js"),
  import("../src/services/publicWeb.service.js"),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;
const {
  PUBLIC_WEB_ERROR_CODES,
  configurePublicWeb,
  deletePublicWeb,
  publicOriginHasFreshTrust,
  reverifyPublicWeb,
  resolveFreshPublicWebTrust,
  rotatePublicWebChallenge,
  verifyPublicWeb,
} = publicWeb;

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api`;
const panelOrigin = "http://panel.example";
const originA = "https://a-public.example.test";
const originB = "https://b-public.example.test";
const sharedOrigin = "https://shared-public.example.test";

const rawFromState = (state) => {
  const value = state?.dnsVerification?.recordValue;
  assert.ok(typeof value === "string" && value.startsWith("agenda-verification="));
  return value.slice("agenda-verification=".length);
};

const assertCode = async (promise, code) => assert.rejects(
  promise,
  (error) => error?.code === code,
);

// Reuse successful sessions inside this mixed-boundary suite so authLimiter is
// not accidentally the object under test. Failed login attempts are never cached.
// The superadmin case runs in its own process/suite with the real limiter intact.
const successfulLogins = new Map();
const login = async (email, password) => {
  const key = `${email}\0${password}`;
  if (successfulLogins.has(key)) return successfulLogins.get(key);

  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: panelOrigin },
    body: JSON.stringify({ email, password }),
  });
  const result = { response, cookie: response.headers.get("set-cookie") };
  if ([200, 201].includes(response.status)) successfulLogins.set(key, result);
  return result;
};

const configureHttp = async (cookie, body, origin = panelOrigin) => fetch(`${baseUrl}/business-settings/public-web`, {
  method: "PUT",
  headers: {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const getSettingsHttp = async (cookie) => fetch(`${baseUrl}/business-settings`, {
  headers: { Cookie: cookie, Origin: panelOrigin },
});

const ensureUnconfigured = async (businessId) => {
  const config = await BusinessConfig.findOne({ business: businessId }).select("publicWeb");
  if (config?.publicWeb?.websiteUrl) await deletePublicWeb({ businessId });
};

const configurePending = async (businessId, origin, path = "/reservar", now = new Date()) => {
  await ensureUnconfigured(businessId);
  return configurePublicWeb({
    businessId,
    websiteUrl: origin,
    bookingUrl: `${origin}${path}`,
    now,
  });
};

const provePending = async (businessId, state, now = new Date()) => {
  const raw = rawFromState(state);
  return verifyPublicWeb({
    businessId,
    now,
    resolveTxt: async () => [["agenda-verification=", raw]],
  });
};

const configureVerified = async (businessId, origin, path = "/reservar", now = new Date()) => {
  const pending = await configurePending(businessId, origin, path, now);
  return provePending(businessId, pending, new Date(now.getTime() + 1));
};

const preflight = async ({ origin, method = "GET", path = "/services", requestHeaders = null }) => {
  const headers = {
    Origin: origin,
    "Access-Control-Request-Method": method,
  };
  if (requestHeaders) headers["Access-Control-Request-Headers"] = requestHeaders;
  return fetch(`${baseUrl}${path}`, { method: "OPTIONS", headers });
};

test("6.2.6-B public web trust lifecycle and browser boundary", async (t) => {
  await t.test("admin command materializes pending hash-only state and GET never re-exposes raw", async () => {
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);
    const admin = await login("test-admin@example.com", "passwordAdmin");
    assert.ok([200, 201].includes(admin.response.status));

    const response = await configureHttp(admin.cookie, {
      websiteUrl: `${originA}:443/`,
      bookingUrl: `${originA}:443/reservar`,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.payload.publicWeb.websiteUrl, originA);
    assert.equal(body.payload.publicWeb.bookingUrl, `${originA}/reservar`);
    assert.equal(body.payload.publicWeb.verificationStatus, "pending");
    assert.equal(body.payload.publicWeb.trustGeneration, 1);
    const raw = rawFromState(body.payload.publicWeb);

    const stored = await BusinessConfig.findOne({ business: seed.business._id }).select("+publicWeb.challengeHash").lean();
    assert.ok(stored.publicWeb.challengeHash);
    assert.notEqual(stored.publicWeb.challengeHash, raw);
    assert.equal(JSON.stringify(stored).includes(raw), false);

    const settings = await getSettingsHttp(admin.cookie);
    assert.equal(settings.status, 200);
    const settingsBody = await settings.json();
    assert.equal(settingsBody.payload.publicWeb.dnsVerification.recordValue, null);
    assert.equal(JSON.stringify(settingsBody).includes(raw), false);
  });

  await t.test("identical PUT is a no-op and same-origin booking path preserves generation/freshness", async () => {
    const before = await BusinessConfig.findOne({ business: seed.business._id }).select("+publicWeb.challengeHash").lean();
    const same = await configurePublicWeb({
      businessId: seed.business._id,
      websiteUrl: originA,
      bookingUrl: `${originA}/reservar`,
    });
    assert.equal(same.trustGeneration, before.publicWeb.trustGeneration);
    assert.equal(same.dnsVerification.recordValue, null);

    const verified = await provePending(seed.business._id, {
      ...same,
      dnsVerification: {
        ...same.dnsVerification,
        recordValue: null,
      },
    }).catch(() => null);
    assert.equal(verified, null, "identical PUT must not recover/re-expose the raw challenge");

    const rawState = await rotatePublicWebChallenge({ businessId: seed.business._id });
    const proven = await provePending(seed.business._id, rawState);
    const generation = proven.trustGeneration;
    const validUntil = new Date(proven.verificationValidUntil).getTime();

    const changedPath = await configurePublicWeb({
      businessId: seed.business._id,
      websiteUrl: originA,
      bookingUrl: `${originA}/otra-ruta`,
    });
    assert.equal(changedPath.verificationStatus, "verified");
    assert.equal(changedPath.trustGeneration, generation);
    assert.equal(new Date(changedPath.verificationValidUntil).getTime(), validUntil);
    assert.equal(changedPath.dnsVerification, null);
  });

  await t.test("DNS exact proof verifies; wrong/absent/error/timeout fail closed and verified cannot renew silently", async () => {
    const pending = await configurePending(seed.business._id, "https://dns-proof.example.test");
    const raw = rawFromState(pending);

    await assertCode(verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => [["agenda-verification=wrong"]],
    }), PUBLIC_WEB_ERROR_CODES.VERIFICATION_NOT_PROVEN);
    await assertCode(verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => [["unrelated=value"]],
    }), PUBLIC_WEB_ERROR_CODES.VERIFICATION_NOT_PROVEN);
    await assertCode(verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => { throw new Error("resolver details must stay private"); },
    }), PUBLIC_WEB_ERROR_CODES.DNS_UNAVAILABLE);
    await assertCode(verifyPublicWeb({
      businessId: seed.business._id,
      dnsTimeoutMs: 5,
      resolveTxt: async () => new Promise(() => {}),
    }), PUBLIC_WEB_ERROR_CODES.DNS_UNAVAILABLE);

    const verified = await verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => [["agenda-verification=", raw]],
    });
    assert.equal(verified.verificationStatus, "verified");
    assert.equal(verified.verifiedOrigin, "https://dns-proof.example.test");
    assert.ok(new Date(verified.verificationValidUntil) > new Date(verified.verifiedAt));

    await assertCode(verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => [["agenda-verification=", raw]],
    }), PUBLIC_WEB_ERROR_CODES.REVERIFICATION_REQUIRED);
  });

  await t.test("challenge expires exactly at challengeExpiresAt", async () => {
    const start = new Date("2030-01-01T00:00:00.000Z");
    const pending = await configurePending(seed.business._id, "https://expiry-proof.example.test", "/reservar", start);
    const exact = new Date(pending.dnsVerification.challengeExpiresAt);
    await assertCode(verifyPublicWeb({
      businessId: seed.business._id,
      now: exact,
      resolveTxt: async () => [[pending.dnsVerification.recordValue]],
    }), PUBLIC_WEB_ERROR_CODES.CHALLENGE_EXPIRED);
  });

  await t.test("stale DNS lookup after rotate cannot verify the new attempt", async () => {
    const pending = await configurePending(seed.business._id, "https://stale-rotate.example.test");
    const oldRaw = rawFromState(pending);
    let resolverEntered;
    const entered = new Promise((resolve) => { resolverEntered = resolve; });
    let releaseResolver;
    const result = new Promise((resolve) => { releaseResolver = resolve; });

    const verification = verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => {
        resolverEntered();
        return result;
      },
    });
    await entered;
    const rotated = await rotatePublicWebChallenge({ businessId: seed.business._id });
    assert.notEqual(rawFromState(rotated), oldRaw);
    releaseResolver([["agenda-verification=", oldRaw]]);
    await assertCode(verification, PUBLIC_WEB_ERROR_CODES.STATE_CHANGED);
  });

  await t.test("stale DNS lookup after origin change cannot verify the new configuration", async () => {
    const pending = await configurePending(seed.business._id, "https://stale-origin-a.example.test");
    const oldRaw = rawFromState(pending);
    let resolverEntered;
    const entered = new Promise((resolve) => { resolverEntered = resolve; });
    let releaseResolver;
    const result = new Promise((resolve) => { releaseResolver = resolve; });

    const verification = verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => {
        resolverEntered();
        return result;
      },
    });
    await entered;
    const changed = await configurePublicWeb({
      businessId: seed.business._id,
      websiteUrl: "https://stale-origin-b.example.test",
      bookingUrl: "https://stale-origin-b.example.test/reservar",
    });
    assert.equal(changed.trustGeneration, pending.trustGeneration + 1);
    releaseResolver([["agenda-verification=", oldRaw]]);
    await assertCode(verification, PUBLIC_WEB_ERROR_CODES.STATE_CHANGED);
  });

  await t.test("freshness is lazy and now == verificationValidUntil is invalid", async () => {
    const start = new Date("2035-01-01T00:00:00.000Z");
    const pending = await configurePending(seed.business._id, "https://freshness.example.test", "/reservar", start);
    const verified = await provePending(seed.business._id, pending, new Date(start.getTime() + 1));
    const validUntil = new Date(verified.verificationValidUntil);

    const before = await resolveFreshPublicWebTrust({
      businessId: seed.business._id,
      now: new Date(validUntil.getTime() - 1),
    });
    assert.equal(before.origin, "https://freshness.example.test");
    assert.equal(await resolveFreshPublicWebTrust({ businessId: seed.business._id, now: validUntil }), null);
    assert.equal(await publicOriginHasFreshTrust({ origin: "https://freshness.example.test", now: validUntil }), false);
  });

  await t.test("reverify advances trust generation and creates a fresh DNS attempt", async () => {
    const initial = await configureVerified(seed.business._id, "https://reverify.example.test");
    const pending = await reverifyPublicWeb({ businessId: seed.business._id });
    assert.equal(pending.verificationStatus, "pending");
    assert.equal(pending.trustGeneration, initial.trustGeneration + 1);
    assert.ok(pending.dnsVerification.recordValue);
    assert.equal(await resolveFreshPublicWebTrust({ businessId: seed.business._id }), null);
  });

  await t.test("delete/recreate preserves monotonic trust generation and prevents ABA", async () => {
    const pending = await configurePending(seed.business._id, "https://aba.example.test");
    const verified = await provePending(seed.business._id, pending);
    const generationN = verified.trustGeneration;
    const removed = await deletePublicWeb({ businessId: seed.business._id });
    assert.equal(removed.verificationStatus, "unconfigured");
    assert.equal(removed.trustGeneration, generationN + 1);

    const recreated = await configurePublicWeb({
      businessId: seed.business._id,
      websiteUrl: "https://aba.example.test",
      bookingUrl: "https://aba.example.test/reservar",
    });
    assert.equal(recreated.trustGeneration, generationN + 2);
    assert.notEqual(recreated.trustGeneration, generationN);

    const repeatedDelete = await deletePublicWeb({ businessId: seed.business._id });
    const repeatedDeleteAgain = await deletePublicWeb({ businessId: seed.business._id });
    assert.equal(repeatedDeleteAgain.trustGeneration, repeatedDelete.trustGeneration);
  });

  await t.test("HTTP authority is Membership-admin + trusted panel origin, not legacy owner/role", async () => {
    await ensureUnconfigured(seed.business._id);
    await ensureUnconfigured(seed.businessB._id);

    const adminA = await login("test-admin@example.com", "passwordAdmin");
    const workerA = await login("test-worker@example.com", "passwordWorker");
    const adminB = await login("user-b@example.com", "passwordUserB");
    assert.ok([200, 201].includes(adminA.response.status));
    assert.ok([200, 201].includes(workerA.response.status));
    assert.ok([200, 201].includes(adminB.response.status));

    const adminAllowed = await configureHttp(adminA.cookie, {
      websiteUrl: originA,
      bookingUrl: `${originA}/reservar`,
    });
    assert.equal(adminAllowed.status, 200);

    const workerDenied = await configureHttp(workerA.cookie, {
      websiteUrl: "https://worker-must-not-configure.example.test",
      bookingUrl: "https://worker-must-not-configure.example.test/reservar",
    });
    assert.equal(workerDenied.status, 403);

    const crossTenantBody = await configureHttp(adminB.cookie, {
      websiteUrl: originB,
      bookingUrl: `${originB}/reservar`,
      businessId: seed.business._id.toString(),
    });
    assert.equal(crossTenantBody.status, 400);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.businessB._id }), 0);

    const wrongPanelOrigin = await configureHttp(adminA.cookie, {
      websiteUrl: originA,
      bookingUrl: `${originA}/reservar`,
    }, "https://untrusted-panel.example.test");
    assert.equal(wrongPanelOrigin.status, 403);

    const ownerPassword = await createHash("owner-no-membership");
    const owner = await User.create({
      firstName: "Owner",
      lastName: "WithoutMembership",
      email: [`owner-no-membership-${Date.now()}@example.test`],
      phone: [],
      password: ownerPassword,
      role: "admin",
      business: seed.business._id,
      isActive: true,
    });
    await seed.business.updateOne({ $set: { owner: owner._id } });
    const ownerLogin = await login(owner.email[0], "owner-no-membership");
    assert.equal(ownerLogin.response.status, 401);
  });

  await t.test("preflight eligibility is credentialless and independent of future tenant values", async () => {
    await configureVerified(seed.business._id, originA);
    const allowed = await preflight({
      origin: originA,
      method: "POST",
      path: "/appointments",
      requestHeaders: "content-type,x-business-id",
    });
    assert.ok([200, 204].includes(allowed.status));
    assert.equal(allowed.headers.get("access-control-allow-origin"), originA);
    assert.equal(allowed.headers.get("access-control-allow-credentials"), null);

    const unknown = await preflight({ origin: "https://unknown-public.example.test" });
    assert.equal(unknown.status, 403);
    assert.equal(unknown.headers.get("access-control-allow-origin"), null);

    const config = await BusinessConfig.findOne({ business: seed.business._id });
    await BusinessConfig.updateOne(
      { _id: config._id },
      { $set: { "publicWeb.verificationValidUntil": new Date() } },
    );
    const expired = await preflight({ origin: originA });
    assert.equal(expired.status, 403);
    assert.equal(expired.headers.get("access-control-allow-origin"), null);
  });

  await t.test("shared origin supports multiple Businesses while actual requests remain tenant-scoped", async () => {
    await configureVerified(seed.business._id, sharedOrigin, "/a/reservar");
    await configureVerified(seed.businessB._id, sharedOrigin, "/b/reservar");

    const preflightShared = await preflight({ origin: sharedOrigin });
    assert.ok([200, 204].includes(preflightShared.status));
    assert.equal(preflightShared.headers.get("access-control-allow-origin"), sharedOrigin);
    assert.equal(preflightShared.headers.get("access-control-allow-credentials"), null);

    const responseA = await fetch(`${baseUrl}/services?businessId=${seed.business._id}`, {
      headers: { Origin: sharedOrigin },
    });
    assert.equal(responseA.status, 200);
    const bodyA = await responseA.json();
    assert.ok(bodyA.payload.some((service) => service.id === seed.service._id.toString()));

    const responseB = await fetch(`${baseUrl}/services?businessId=${seed.businessB._id}`, {
      headers: { Origin: sharedOrigin },
    });
    assert.equal(responseB.status, 200);
    const bodyB = await responseB.json();
    assert.equal(bodyB.payload.some((service) => service.id === seed.service._id.toString()), false);
  });

  await t.test("preflight grant never substitutes actual Business binding and mismatch mutates nothing", async () => {
    await configureVerified(seed.business._id, originA);
    await configureVerified(seed.businessB._id, originB);

    const eligible = await preflight({ origin: originA, method: "POST", path: "/appointments" });
    assert.ok([200, 204].includes(eligible.status));
    assert.equal(eligible.headers.get("access-control-allow-origin"), originA);

    const before = await Appointment.countDocuments({ business: seed.businessB._id });
    const mismatch = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { Origin: originA, "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: seed.businessB._id.toString() }),
    });
    assert.equal(mismatch.status, 403);
    assert.equal(await Appointment.countDocuments({ business: seed.businessB._id }), before);
  });

  await t.test("no-Origin headless calls continue while publicWeb cannot credential internal routes", async () => {
    const noOrigin = await fetch(`${baseUrl}/services?businessId=${seed.business._id}`);
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);

    const admin = await login("test-admin@example.com", "passwordAdmin");
    const publicCookieAttempt = await fetch(`${baseUrl}/business-settings`, {
      headers: { Origin: originA, Cookie: admin.cookie },
    });
    assert.equal(publicCookieAttempt.status, 403);
    assert.equal(publicCookieAttempt.headers.get("access-control-allow-credentials"), null);

    const panelPreflight = await preflight({ origin: panelOrigin, method: "GET", path: "/services" });
    assert.ok([200, 204].includes(panelPreflight.status));
    assert.equal(panelPreflight.headers.get("access-control-allow-origin"), panelOrigin);
    assert.equal(panelPreflight.headers.get("access-control-allow-credentials"), "true");
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
