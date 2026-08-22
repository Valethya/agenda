import test from "node:test";
import assert from "node:assert/strict";
import BusinessConfig from "../../src/db/models/businessConfig.model.js";
import {
  PUBLIC_WEB_CHALLENGE_TTL_MS,
  PUBLIC_WEB_DNS_TIMEOUT_MS,
  PUBLIC_WEB_VERIFIED_TRUST_TTL_MS,
} from "../../src/config/publicWeb.constants.js";
import {
  normalizePublicBookingUrl,
  normalizePublicRequestOrigin,
  normalizePublicWebsiteUrl,
  normalizePublicWebPair,
} from "../../src/security/publicWebOrigin.js";
import { serializePublicWebState } from "../../src/security/publicWebState.js";
import {
  configurePublicWebSchema,
  emptyPublicWebCommandSchema,
  updateBusinessConfigSchema,
} from "../../src/validations/common.validation.js";

test("6.2.6-B public web contract", async (t) => {
  await t.test("TTL domains remain explicit and distinct", () => {
    assert.equal(PUBLIC_WEB_CHALLENGE_TTL_MS, 15 * 60 * 1000);
    assert.equal(PUBLIC_WEB_VERIFIED_TRUST_TTL_MS, 30 * 24 * 60 * 60 * 1000);
    assert.equal(PUBLIC_WEB_DNS_TIMEOUT_MS, 3000);
    assert.notEqual(PUBLIC_WEB_CHALLENGE_TTL_MS, PUBLIC_WEB_VERIFIED_TRUST_TTL_MS);
  });

  await t.test("websiteUrl enforces absolute HTTPS/443 origin policy", () => {
    for (const value of [
      "http://negocio.cl",
      "https://user:pass@negocio.cl",
      "https://negocio.cl/path",
      "https://negocio.cl?x=1",
      "https://negocio.cl/#fragment",
      "https://negocio.cl:8443",
      "https://127.0.0.1",
      "https://[::1]",
      "https://localhost",
      "https://negocio",
      "https://*.negocio.cl",
    ]) {
      assert.throws(() => normalizePublicWebsiteUrl(value));
    }

    assert.equal(normalizePublicWebsiteUrl("https://NEGOCIO.cl:443/"), "https://negocio.cl");
  });

  await t.test("bookingUrl permits path but requires the exact canonical origin", () => {
    assert.equal(
      normalizePublicBookingUrl("https://negocio.cl:443/a/reservar", "https://negocio.cl"),
      "https://negocio.cl/a/reservar",
    );
    assert.throws(() => normalizePublicBookingUrl("https://otro.cl/reservar", "https://negocio.cl"));
    assert.throws(() => normalizePublicBookingUrl("https://sub.negocio.cl/reservar", "https://negocio.cl"));
    assert.throws(() => normalizePublicBookingUrl("https://negocio.cl:8443/reservar", "https://negocio.cl"));
    assert.throws(() => normalizePublicBookingUrl("https://negocio.cl/reservar?q=1", "https://negocio.cl"));
  });

  await t.test("request Origin normalization accepts only a canonical HTTPS origin", () => {
    assert.equal(normalizePublicRequestOrigin("https://estudio.cl:443"), "https://estudio.cl");
    for (const value of ["http://estudio.cl", "https://estudio.cl/path", "https://localhost", "null"] ) {
      assert.throws(() => normalizePublicRequestOrigin(value));
    }
  });

  await t.test("pair normalization is same-origin and deterministic", () => {
    assert.deepEqual(normalizePublicWebPair({
      websiteUrl: "https://Estudio.cl:443/",
      bookingUrl: "https://estudio.cl/a/reservar",
    }), {
      websiteUrl: "https://estudio.cl",
      bookingUrl: "https://estudio.cl/a/reservar",
      origin: "https://estudio.cl",
    });
  });

  await t.test("trust fields are server-owned and generic Business Settings cannot mutate them", () => {
    assert.equal(configurePublicWebSchema.safeParse({
      body: { websiteUrl: "https://negocio.cl", bookingUrl: "https://negocio.cl/reservar" },
    }).success, true);
    assert.equal(configurePublicWebSchema.safeParse({
      body: {
        websiteUrl: "https://negocio.cl",
        bookingUrl: "https://negocio.cl/reservar",
        trustGeneration: 99,
      },
    }).success, false);
    assert.equal(updateBusinessConfigSchema.safeParse({
      body: { publicWeb: { verificationStatus: "verified" } },
    }).success, false);
    assert.equal(emptyPublicWebCommandSchema.safeParse({ body: {} }).success, true);
    assert.equal(emptyPublicWebCommandSchema.safeParse({ body: { force: true } }).success, false);
  });

  await t.test("schema keeps DNS secret/fence server-only and shared origins non-unique", () => {
    assert.equal(BusinessConfig.schema.path("publicWeb.challengeHash").options.select, false);
    assert.equal(BusinessConfig.schema.path("publicWeb.authorityFence.token").options.select, false);
    assert.ok(BusinessConfig.schema.path("publicWeb.verificationAttemptGeneration"));
    assert.ok(BusinessConfig.schema.path("publicWeb.trustGeneration"));

    const originIndex = BusinessConfig.schema.indexes().find(([fields]) => fields["publicWeb.verifiedOrigin"] === 1);
    assert.ok(originIndex);
    assert.notEqual(originIndex[1].unique, true);
  });

  await t.test("read projection never exposes challenge hash, attempt generation or fence", () => {
    const raw = "secret-one-time";
    const projected = serializePublicWebState({
      websiteUrl: "https://negocio.cl",
      bookingUrl: "https://negocio.cl/reservar",
      verificationStatus: "pending",
      verificationMethod: "dns_txt",
      verifiedOrigin: null,
      verifiedAt: null,
      verificationValidUntil: null,
      trustGeneration: 2,
      challengeHash: "deadbeef",
      challengeExpiresAt: new Date("2030-01-01T00:15:00.000Z"),
      verificationAttemptGeneration: 8,
      authorityFence: { token: "private", trustGeneration: 2 },
    });
    const serialized = JSON.stringify(projected);
    assert.equal(serialized.includes("deadbeef"), false);
    assert.equal(serialized.includes("private"), false);
    assert.equal(Object.hasOwn(projected, "verificationAttemptGeneration"), false);
    assert.equal(projected.dnsVerification.recordValue, null);

    const oneTime = serializePublicWebState({
      websiteUrl: "https://negocio.cl",
      bookingUrl: "https://negocio.cl/reservar",
      verificationStatus: "pending",
      trustGeneration: 2,
      challengeExpiresAt: new Date("2030-01-01T00:15:00.000Z"),
    }, { rawChallenge: raw });
    assert.equal(oneTime.dnsVerification.recordValue, `agenda-verification=${raw}`);
  });
});
