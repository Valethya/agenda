import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuthenticated, isSessionRevisionCurrent } from "../../src/middleware/auth.middleware.js";

const invoke = async (sessionRevision, persistedRevision, isActive = true) => {
  const req = {
    session: { user: { id: "test-user", sessionRevision } },
    tenantAuthority: { user: { isActive, sessionRevision: persistedRevision } },
  };
  let status = null;
  let nextCalled = false;
  const res = {
    status(code) { status = code; return this; },
    json(body) { return body; },
  };
  await isAuthenticated(req, res, () => { nextCalled = true; });
  return { status, nextCalled, authenticatedUser: req.authenticatedUser };
};

describe("password reset session invalidation", () => {
  it("accepts legacy sessions before first reset (revision 0)", async () => {
    const result = await invoke(undefined, 0);
    assert.equal(result.nextCalled, true);
    assert.equal(result.status, null);
  });
  it("rejects a pre-reset session after a password reset increments the revision", async () => {
    const result = await invoke(0, 1);
    assert.equal(result.status, 401);
    assert.equal(result.nextCalled, false);
  });
  it("accepts a new login with the latest revision", async () => {
    const result = await invoke(1, 1);
    assert.equal(result.nextCalled, true);
    assert.equal(result.status, null);
  });
  it("rejects stale sessions after multiple resets", async () => {
    const result = await invoke(1, 2);
    assert.equal(result.status, 401);
    assert.equal(result.nextCalled, false);
  });
  it("rejects inactive accounts regardless of revision", async () => {
    const result = await invoke(2, 2, false);
    assert.equal(result.status, 401);
  });
  it("rejects missing or malformed revision values", () => {
    assert.equal(isSessionRevisionCurrent({ sessionRevision: "1" }, { sessionRevision: 1 }), false);
    assert.equal(isSessionRevisionCurrent({ sessionRevision: -1 }, { sessionRevision: 1 }), false);
    assert.equal(isSessionRevisionCurrent(null, { sessionRevision: 1 }), false);
  });
});
