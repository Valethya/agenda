import { frontendUrl } from "../config/env.js";
import { ForbiddenError } from "../utils/appError.js";

const AUTHENTICATED_ORIGIN_MESSAGE = "Origen no autorizado para utilizar una sesión autenticada";

const trustedAuthenticatedOrigin = (() => {
  try {
    return new URL(frontendUrl).origin;
  } catch {
    return null;
  }
})();

export const assertTrustedAuthenticatedOrigin = (req) => {
  const rawOrigin = req.get("origin");

  // Same-origin requests, non-browser clients and server tooling may omit Origin.
  // This boundary is deliberately narrower than the full CSRF design deferred to 6.3.
  if (!rawOrigin) return;

  let requestOrigin = null;
  try {
    requestOrigin = new URL(rawOrigin).origin;
  } catch {
    throw new ForbiddenError(AUTHENTICATED_ORIGIN_MESSAGE);
  }

  if (!trustedAuthenticatedOrigin || requestOrigin !== trustedAuthenticatedOrigin) {
    throw new ForbiddenError(AUTHENTICATED_ORIGIN_MESSAGE);
  }
};

export const requireTrustedAuthenticatedOrigin = (req, res, next) => {
  try {
    assertTrustedAuthenticatedOrigin(req);
    next();
  } catch (error) {
    next(error);
  }
};
