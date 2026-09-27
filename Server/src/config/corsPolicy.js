export const normalizeOrigin = (value) => {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
};

const normalizePath = (value = "") => {
  if (value.length > 1 && value.endsWith("/")) return value.slice(0, -1);
  return value;
};

const requestedCorsMethod = (req) => (
  req.method === "OPTIONS"
    ? (req.get("access-control-request-method") || "").toUpperCase()
    : req.method.toUpperCase()
);

const requestPath = (req) => normalizePath(
  req.path || new URL(req.originalUrl || "/", "http://local").pathname,
);

export const isBearerAuthorizedGuestConsumeRoute = (req) => (
  requestedCorsMethod(req) === "POST"
  && /^\/api\/guest-appointments\/(?:read|cancel|reschedule)$/u.test(requestPath(req))
);

export const isBearerAuthorizedGuestReadRoute = (req) => (
  requestedCorsMethod(req) === "POST"
  && requestPath(req) === "/api/guest-appointments/read"
);

export const isDynamicPublicHeadlessRoute = (req) => {
  const pathName = requestPath(req);
  const requestedMethod = requestedCorsMethod(req);
  if (requestedMethod === "GET" && /^\/api\/services(?:\/[^/]+)?$/u.test(pathName)) return true;
  if (requestedMethod === "GET" && pathName === "/api/users/workers") return true;
  if (requestedMethod === "GET" && pathName === "/api/availability/slots") return true;
  if (requestedMethod === "POST" && pathName === "/api/appointments") return true;
  if (requestedMethod === "POST" && /^\/api\/guest-appointments\/(?:read|cancel|reschedule)\/(?:challenge|verify)$/u.test(pathName)) return true;
  return false;
};
