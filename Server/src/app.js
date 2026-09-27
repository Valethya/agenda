import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import __dirname from "./utils/dirname.js";
import routes from "./routes/index.js";
import healthRoutes from "./routes/health.routes.js";
import handleError from "./middleware/handleError.js";
import session from "express-session";
import rateLimit from "express-rate-limit";
import MongoStore from "connect-mongo";
import { urlMongo, sessionSecret, corsOrigins, frontendUrl, nodeEnv, trustProxyHops } from "./config/env.js";
import { sessionCookieOptionsFor } from "./config/sessionPolicy.js";
import {
  normalizeOrigin,
  isBearerAuthorizedGuestConsumeRoute,
  isBearerAuthorizedGuestReadRoute,
  isDynamicPublicHeadlessRoute,
} from "./config/corsPolicy.js";
import {
  PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT,
  PUBLIC_WEB_CORS_LOOKUP_RATE_WINDOW_MS,
} from "./config/publicWeb.constants.js";
import { publicOriginHasFreshTrust } from "./services/publicWeb.service.js";
import { AppError } from "./utils/appError.js";

export { isBearerAuthorizedGuestConsumeRoute, isBearerAuthorizedGuestReadRoute, isDynamicPublicHeadlessRoute };

export const app = express();
app.use("/agenda", express.static(path.resolve(__dirname, "../../client/build")));
app.use("/public", express.static(path.join(__dirname, "/public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (nodeEnv === "production") app.set("trust proxy", trustProxyHops);

const trustedPanelOrigin = normalizeOrigin(frontendUrl);
const compatibilityOrigins = new Set(
  [
    ...corsOrigins.split(",").map((origin) => normalizeOrigin(origin.trim())),
    trustedPanelOrigin,
  ].filter(Boolean),
);

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

export const sessionStore = MongoStore.create({ mongoUrl: urlMongo });
export const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: sessionCookieOptionsFor(nodeEnv),
});
app.use(sessionMiddleware);

const corsDenied = () => new AppError(
  "Origin no permitido por CORS",
  403,
  "CORS_ORIGIN_DENIED",
);

app.use(
  cors((req, callback) => {
    const rawOrigin = req.get("origin");
    if (!rawOrigin) return callback(null, { origin: false, credentials: false });

    const requestOrigin = normalizeOrigin(rawOrigin);
    if (!requestOrigin) return callback(corsDenied());

    if (isBearerAuthorizedGuestConsumeRoute(req)) {
      return callback(null, { origin: true, credentials: false });
    }

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

    if (!compatibilityOrigins.has(requestOrigin)) return callback(corsDenied());
    return callback(null, { origin: true, credentials: false });
  }),
);

app.use(helmet());
app.use("/health", healthRoutes);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  message: {
    status: "fail",
    statusCode: 429,
    code: "RATE_LIMITED",
    message: "Demasiadas peticiones desde esta dirección IP. Por favor, intente más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", globalLimiter, routes);
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use(handleError);

export default app;
