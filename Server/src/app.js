import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import __dirname from "./utils/dirname.js";
import routes from "./routes/index.js";
import logger from "./config/logger.js";
import handleError from "./middleware/handleError.js";
import session from "express-session";
import rateLimit from "express-rate-limit";
import MongoStore from "connect-mongo";
import { urlMongo, sessionSecret, corsOrigins, frontendUrl, nodeEnv } from "./config/env.js";
import {
  PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT,
  PUBLIC_WEB_CORS_LOOKUP_RATE_WINDOW_MS,
} from "./config/publicWeb.constants.js";
import { publicOriginHasFreshTrust } from "./services/publicWeb.service.js";
import { AppError } from "./utils/appError.js";
// EXPRESS

export const app = express();
app.use("/agenda", express.static(path.resolve(__dirname, "../../client/build")));
app.use("/public", express.static(path.join(__dirname, "/public")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (nodeEnv === "production") {
  app.set("trust proxy", 1);
}

const normalizeOrigin = (value) => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
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

// This exact C2 endpoint consumes an already-issued bearer. Its browser CORS
// permission is deliberately independent from current publicWeb freshness; the
// bearer remains the only authority and CORS stays credentialless.
export const isBearerAuthorizedGuestReadRoute = (req) => (
  requestedCorsMethod(req) === "POST"
  && requestPath(req) === "/api/guest-appointments/read"
);

// Public route classification is server-owned and method-sensitive. For OPTIONS
// we use Access-Control-Request-Method only; neither body nor future custom-header
// values participate in preflight eligibility. The bearer consume endpoint above
// is intentionally excluded from this fresh-publicWeb class.
export const isDynamicPublicHeadlessRoute = (req) => {
  const pathName = requestPath(req);
  const requestedMethod = requestedCorsMethod(req);

  if (requestedMethod === "GET" && /^\/api\/services(?:\/[^/]+)?$/u.test(pathName)) return true;
  if (requestedMethod === "GET" && pathName === "/api/users/workers") return true;
  if (requestedMethod === "GET" && pathName === "/api/availability/slots") return true;
  if (requestedMethod === "POST" && pathName === "/api/appointments") return true;
  if (requestedMethod === "POST" && /^\/api\/guest-appointments\/read\/(?:challenge|verify)$/u.test(pathName)) return true;
  return false;
};

const trustedPanelOrigin = normalizeOrigin(frontendUrl);
const compatibilityOrigins = new Set(
  [
    ...corsOrigins.split(",").map((origin) => normalizeOrigin(origin.trim())),
    trustedPanelOrigin,
  ].filter(Boolean),
);

// Dynamic public CORS performs a Mongo trust lookup before the global /api
// limiter. This admission limiter therefore executes first and bounds those
// lookups per IP with the same window/budget as the global API limiter. It skips
// panel policy, no-Origin requests, non-dynamic routes and bearer-authorized
// /read, none of which require a publicWeb lookup here.
export const publicWebCorsLookupLimiter = rateLimit({
  windowMs: PUBLIC_WEB_CORS_LOOKUP_RATE_WINDOW_MS,
  limit: PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT,
  skip: (req) => {
    if (!isDynamicPublicHeadlessRoute(req)) return true;
    const rawOrigin = req.get("origin");
    if (!rawOrigin) return true;
    const origin = normalizeOrigin(rawOrigin);
    if (origin && trustedPanelOrigin && origin === trustedPanelOrigin) return true;
    return false;
  },
  message: {
    status: "fail",
    statusCode: 429,
    code: "PUBLIC_WEB_CORS_RATE_LIMITED",
    message: "Demasiadas solicitudes de origen público. Por favor, intente más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(publicWebCorsLookupLimiter);

export const sessionStore = MongoStore.create({
  mongoUrl: urlMongo,
});

export const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24,
    secure: nodeEnv === "production",
    sameSite: nodeEnv === "production" ? "none" : "lax",
  },
});
app.use(sessionMiddleware);

const corsDenied = () => new AppError(
  "Origin no permitido por CORS",
  403,
  "CORS_ORIGIN_DENIED",
);

// CORS público y authority de sesión son conceptos distintos. Only FRONTEND_URL
// can receive credentialed panel CORS. The C2 bearer consume endpoint is checked
// first so even FRONTEND_URL receives a credentialless grant on that exact route.
app.use(
  cors((req, callback) => {
    const rawOrigin = req.get("origin");
    if (!rawOrigin) {
      return callback(null, { origin: false, credentials: false });
    }

    const requestOrigin = normalizeOrigin(rawOrigin);
    if (!requestOrigin) {
      return callback(corsDenied());
    }

    if (isBearerAuthorizedGuestReadRoute(req)) {
      return callback(null, { origin: true, credentials: false });
    }

    // Authenticated panel origin remains an independent, server-controlled
    // credentialed policy for every other route.
    if (trustedPanelOrigin && requestOrigin === trustedPanelOrigin) {
      return callback(null, { origin: true, credentials: true });
    }

    if (isDynamicPublicHeadlessRoute(req)) {
      return publicOriginHasFreshTrust({ origin: requestOrigin })
        .then((eligible) => {
          if (!eligible) return callback(corsDenied());
          return callback(null, { origin: true, credentials: false });
        })
        .catch(() => callback(corsDenied()));
    }

    if (!compatibilityOrigins.has(requestOrigin)) {
      return callback(corsDenied());
    }

    return callback(null, { origin: true, credentials: false });
  }),
);

// HELMET
app.use(helmet());

// RATE LIMITING (Protección DDoS)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 200, // Límite de 200 peticiones por ventana
  message: {
    status: "fail",
    statusCode: 429,
    code: "RATE_LIMITED",
    message: "Demasiadas peticiones desde esta dirección IP. Por favor, intente más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

//ROUTES
app.use("/api", globalLimiter, routes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// errores
app.use(handleError);

export default app;
