import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, "../..");
const repoRoot = path.resolve(serverRoot, "..");
const readServer = (relativePath) => fs.readFile(path.join(serverRoot, relativePath), "utf8");
const readRepo = (relativePath) => fs.readFile(path.join(repoRoot, relativePath), "utf8");

test("C1 model stores the canonical tenant onboarding envelope without copying durable authority", async () => {
  const model = await readServer("src/db/models/pendingOnboarding.model.js");

  assert.match(model, /business:[\s\S]*ref:\s*["']Business["'][\s\S]*required:/u);
  assert.match(model, /issuer:[\s\S]*ref:\s*["']User["'][\s\S]*required:/u);
  assert.match(model, /PENDING_ONBOARDING_CHANNEL\s*=\s*["']email["']/u);
  assert.match(model, /PENDING_ONBOARDING_PURPOSE\s*=\s*["']tenant-onboarding["']/u);
  assert.match(model, /expiresAt:[\s\S]*type:\s*Date[\s\S]*required:/u);
  assert.match(model, /PENDING_ONBOARDING_ROLES[\s\S]*["']admin["'][\s\S]*["']worker["']/u);
  assert.match(model, /isBookable:[\s\S]*type:\s*Boolean[\s\S]*required:/u);
  assert.doesNotMatch(model, /issuerRole|issuerMembershipRole|authoritySnapshot/u);
  assert.doesNotMatch(model, /isBookable[\s\S]{0,160}role\s*===/u);
  assert.match(model, /timestamps:\s*true/u);
  assert.match(model, /autoIndex:\s*process\.env\.NODE_ENV\s*===\s*["']test["']/u);
});

test("C1 email normalization remains conservative and deterministic", async () => {
  const model = await readServer("src/db/models/pendingOnboarding.model.js");

  assert.match(model, /value\.trim\(\)\.toLowerCase\(\)/u);
  assert.doesNotMatch(model, /gmail|googlemail|\+tag|replace\([^\n]*\./iu);
});

test("C1 declares a tenant-scoped partial unique persistence constraint for pending only", async () => {
  const model = await readServer("src/db/models/pendingOnboarding.model.js");
  const migration = await readServer("scripts/migrations/pending-onboarding-storage.js");

  for (const source of [model, migration]) {
    assert.match(source, /business:\s*1[\s\S]*email:\s*1/u);
    assert.match(source, /unique:\s*true/u);
    assert.match(source, /partialFilterExpression:\s*(?:Object\.freeze\()?\{\s*status:\s*["']pending["']\s*\}/u);
    assert.match(source, /pending_onboarding_business_email_pending_unique/u);
  }

  assert.doesNotMatch(model, /index\(\s*\{\s*email:\s*1\s*\}/u);
});

test("C1 canonical creation fixes scope and least privilege server-side", async () => {
  const repository = await readServer("src/repositories/pendingOnboarding.repository.js");

  assert.match(repository, /CANONICAL_INITIAL_ROLE\s*=\s*["']worker["']/u);
  assert.match(repository, /CANONICAL_INITIAL_BOOKABILITY\s*=\s*false/u);
  assert.match(repository, /business:\s*scopedBusinessId/u);
  assert.match(repository, /issuer:\s*scopedIssuerUserId/u);
  assert.match(repository, /channel:\s*PENDING_ONBOARDING_CHANNEL/u);
  assert.match(repository, /purpose:\s*PENDING_ONBOARDING_PURPOSE/u);
  assert.match(repository, /role:\s*CANONICAL_INITIAL_ROLE/u);
  assert.match(repository, /isBookable:\s*CANONICAL_INITIAL_BOOKABILITY/u);
  assert.match(repository, /status:\s*["']pending["']/u);
  assert.match(repository, /Membership\.exists[\s\S]*role:\s*["']admin["'][\s\S]*isActive:\s*true/u);
  assert.match(repository, /User\.exists[\s\S]*isActive:\s*true/u);
});

test("C1 repository never binds the target email to User and never creates User/Membership", async () => {
  const repository = await readServer("src/repositories/pendingOnboarding.repository.js");

  assert.doesNotMatch(repository, /findByEmail|createUser|createMembership/u);
  assert.doesNotMatch(repository, /User\.create|Membership\.create/u);
  assert.match(repository, /PendingOnboarding\.create/u);
  assert.doesNotMatch(repository, /email[\s\S]{0,120}User\.(?:find|exists)/u);
});

test("C1 creation keeps lifecycle inert; C2 operations may specialize separate repository functions", async () => {
  const model = await readServer("src/db/models/pendingOnboarding.model.js");
  const repository = await readServer("src/repositories/pendingOnboarding.repository.js");
  const createStart = repository.indexOf("export const createPendingForBusiness");
  const createEnd = repository.indexOf("export const revokeExpiredPendingForBusinessEmail");
  const c1Creation = repository.slice(createStart, createEnd);

  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.match(model, /["']pending["'][\s\S]*["']consumed["'][\s\S]*["']revoked["']/u);
  assert.doesNotMatch(c1Creation, /consume|revoke|reactivat|findOneAndUpdate|updateOne/u);
  assert.doesNotMatch(model, /secret|token|hash|capability|bearer/iu);
});

test("D2 consumes C1 issuance without moving onboarding authority into the client", async () => {
  const teamView = await readRepo("Client/src/components/TeamView.tsx");
  const onboardingRules = await readRepo("Client/src/features/team/teamOnboardingRules.ts");

  assert.match(teamView, /TEAM_ADD_PERSON_LABEL/u);
  assert.match(teamView, /apiFetch\(TEAM_ONBOARDING_ENDPOINT/u);
  assert.match(onboardingRules, /TEAM_ONBOARDING_ENDPOINT\s*=\s*["']\/team\/onboardings["']/u);
  assert.match(onboardingRules, /return\s*\{\s*email\s*\}/u);
  assert.doesNotMatch(onboardingRules, /role|isBookable|isActive|businessId|userId|password/u);
  assert.doesNotMatch(teamView, /createUser|createMembership|\/consume|\/bind|getWorkers|users\/workers/u);
});