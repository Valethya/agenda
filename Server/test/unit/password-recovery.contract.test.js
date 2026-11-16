import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
describe("password recovery contract",()=>{
 it("links the recovery request from login",()=>{
  assert.match(read("../../../Client/src/pages/login.astro"),/href="\/forgot-password"/);
 });
 it("uses a hash rather than a raw reset token in persistent storage",()=>{
  const auth=read("../../src/services/auth.service.js");
  assert.match(auth,/crypto\.createHash\("sha256"\)/);
  assert.match(auth,/consumeResetToken\(tokenHash, hashedPassword\)/);
 });
 it("consumes the token in the same atomic write as the password",()=>{
  const repo=read("../../src/repositories/user.repository.js");
  assert.match(repo,/User\.findOneAndUpdate\(/);
  assert.match(repo,/\$unset: \{ resetPasswordToken:/);
 });
 it("invalidates existing sessions atomically on reset",()=>{
  const model=read("../../src/db/models/user.model.js");
  const repo=read("../../src/repositories/user.repository.js");
  const middleware=read("../../src/middleware/auth.middleware.js");
  const service=read("../../src/services/auth.service.js");
  assert.match(model,/sessionRevision:/);
  assert.match(repo,/\$inc: \{ sessionRevision: 1 \}/);
  assert.match(middleware,/isSessionRevisionCurrent\(req\.session\.user, user\)/);
  assert.match(service,/sessionUser\.sessionRevision/);
 });
 it("does not disclose account existence on mail provider failure",()=>{
  const controller=read("../../src/controllers/auth.controller.js");
  assert.match(controller,/export const forgotPassword/);
  assert.match(controller,/catch \(_error\)/);
  assert.match(controller,/Si el correo está registrado/);
 });
 it("uses sensitive email delivery and rate limits both public endpoints",()=>{
  assert.match(read("../../src/services/email/emailService.js"),/sendSensitiveMail\(\{ to: email, \.\.\.template \}\)/);
  const routes=read("../../src/routes/auth.routes.js");
  assert.match(routes,/\/forgot-password", authLimiter/);
  assert.match(routes,/\/reset-password", authLimiter/);
 });
});
