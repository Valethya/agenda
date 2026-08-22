import { AppError } from "../utils/appError.js";
import { browserOriginMatchesBusinessTrust } from "../services/publicWeb.service.js";

const denied = () => new AppError(
  "El origin del navegador no está autorizado para este negocio",
  403,
  "PUBLIC_WEB_BROWSER_ORIGIN_DENIED",
);

const bind = async (req, businessId, next) => {
  const origin = req.get("origin");
  // Non-browser/server-to-server callers preserve the 6.2.6-A headless contract.
  if (!origin) return next();

  try {
    const matches = await browserOriginMatchesBusinessTrust({ businessId, origin });
    if (!matches) return next(denied());
    return next();
  } catch {
    return next(denied());
  }
};

// Used after scopePublicBusiness has resolved the exact tenant.
export const bindResolvedPublicBusinessOrigin = (req, res, next) => (
  bind(req, req.businessId, next)
);

// C2 public endpoints intentionally keep their uniform no-Origin acceptance
// boundary. For browser requests only, bind the explicit validated businessId
// without turning Origin into a tenant selector.
export const bindExplicitPublicBusinessOrigin = (req, res, next) => (
  bind(req, req.body?.businessId, next)
);
