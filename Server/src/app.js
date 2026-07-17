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
import { urlMongo, sessionSecret, corsOrigins, nodeEnv } from "./config/env.js";
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

app.use(
  session({
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
  }),
);

// CORS - Whitelist de orígenes permitidos (soporta widgets SaaS embebidos)
const allowedOrigins = corsOrigins.split(",").map((o) => o.trim());
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Permitir requests sin origin (ej: apps móviles, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} no permitido por CORS`));
    },
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
