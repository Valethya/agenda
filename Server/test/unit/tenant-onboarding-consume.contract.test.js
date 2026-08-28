import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  consumeTenantOnboardingSchema,
} from "../../src/validations/tenantOnboarding.validation.js";

const validId = "0123456789abcdef01234567";
const servicePath = fileURLToPath(new URL(
  "../../src/services/tenantOnboardingConsume.service.js",
  import.meta.url,
));

const parseConsume = (body) => consumeTenantOnboardingSchema.parse({
  params: { onboardingId: validId },
  body,
});

test("C3 claimant input is onboardingId only", () => {
  assert.deepEqual(parseConsume(undefined).body, {});
  assert.deepEqual(parseConsume({}).body, {});

  for (const [field, value] of [
    ["userId", validId],
    ["businessId", validId],
    ["role", "admin"],
    ["isBookable", true],
    ["isActive", false],
    ["issuedBy", validId],
    ["email", "claimant@example.com"],
    ["challengeSecret", "x"],
    ["password", "password"],
  ]) {
    assert.throws(
      () => parseConsume({ [field]: value }),
      undefined,
      `${field} must not be accepted by C3`,
    );
  }
});

test("C3 source consumes persisted binding, fixes privilege and fences issuer activity", async () => {
  const source = await readFile(servicePath, "utf8");

  assert.match(source, /user:\s*binding\.user/u);
  assert.match(source, /business:\s*pending\.business/u);
  assert.match(source, /role:\s*CANONICAL_INITIAL_ROLE/u);
  assert.match(source, /isActive:\s*true/u);
  assert.match(source, /isBookable:\s*CANONICAL_INITIAL_BOOKABILITY/u);
  assert.match(source, /CANONICAL_INITIAL_ROLE\s*=\s*"worker"/u);
  assert.match(source, /CANONICAL_INITIAL_BOOKABILITY\s*=\s*false/u);

  assert.match(source, /User\.findOneAndUpdate\(/u);
  assert.match(source, /\{\s*_id:\s*issuerId,\s*isActive:\s*true\s*\}/u);
  assert.match(source, /\$currentDate:\s*\{\s*updatedAt:\s*true\s*\}/u);
  assert.match(source, /timestamps:\s*false/u);

  assert.doesNotMatch(source, /findByEmail/u);
  assert.doesNotMatch(source, /resolveControlledUser/u);
  assert.doesNotMatch(source, /User\.findOne\s*\(/u);
  assert.doesNotMatch(source, /Shift|Service\.workers|Appointment|jsonwebtoken|JWT/u);
});
