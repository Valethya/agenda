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

test("C1 reserves only inert lifecycle states; no consume/revoke workflow or bearer material is implemented", async () => {
  const model = await readServer("src/db/models/pendingOnboarding.model.js");
  const repository = await readServer("src/repositories/pendingOnboarding.repository.js");

  assert.match(model, /["']pending["'][\s\S]*["']consumed["'][\s\S]*["']revoked["']/u);
  assert.doesNotMatch(repository, /consume|revoke|reactivat|findOneAndUpdate|updateOne/u);
  assert.doesNotMatch(model, /secret|token|hash|capability|bearer/iu);
});

test("C1 introduces no HTTP onboarding/claim/consume routes and no email delivery", async () => {
  const routesIndex = await readServer("src/routes/index.js");
  const teamRoutes = await readServer("src/routes/adminTeam.routes.js");
  const emailService = await readServer("src/services/email/emailService.js");

  for (const source of [routesIndex, teamRoutes, emailService]) {
    assert.doesNotMatch(source, /pendingOnboarding|pending-onboarding/u);
  }
  assert.doesNotMatch(teamRoutes, /invite|claim|consume|reactivat/iu);
});

test("C1 introduces no D2 Add person UI or client API", async () => {
  const api = await readRepo("Client/src/services/api.ts");
  const teamView = await readRepo("Client/src/components/TeamView.tsx");

  for (const source of [api, teamView]) {
    assert.doesNotMatch(source, /pendingOnboarding|pending-onboarding|onboarding/u);
  }
  assert.doesNotMatch(teamView, /Añadir persona|Agregar persona|Invitar/iu);
});
