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
// EXPRESS

export const app = express();
app.use("/agenda", express.static(path.resolve(__dirname, "../../client/build")));

app.use("/public", express.static(path.join(__dirname, "/public")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export const sessionStore = MongoStore.create({
  mongoUrl: urlMongo,
});

if (nodeEnv === "production") {
  app.set("trust proxy", 1);
}

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

const normalizeOrigin = (value) => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

// CORS público y authority de sesión son conceptos distintos. CORS_ORIGINS puede
// contener consumidores headless, pero sólo FRONTEND_URL recibe permiso explícito
// para respuestas credentialed del navegador. Las rutas de sesión/superadmin
// además aplican su propia frontera server-controlled.
const trustedPanelOrigin = normalizeOrigin(frontendUrl);
const allowedOrigins = new Set(
  [
    ...corsOrigins.split(",").map((origin) => normalizeOrigin(origin.trim())),
    trustedPanelOrigin,
  ].filter(Boolean),
);

app.use(
  cors((req, callback) => {
    const rawOrigin = req.get("origin");
    if (!rawOrigin) {
      return callback(null, { origin: false, credentials: false });
    }

    const requestOrigin = normalizeOrigin(rawOrigin);
    if (!requestOrigin || !allowedOrigins.has(requestOrigin)) {
      return callback(new Error(`Origin ${rawOrigin} no permitido por CORS`));
    }

    return callback(null, {
      origin: true,
      credentials: Boolean(trustedPanelOrigin && requestOrigin === trustedPanelOrigin),
    });
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
