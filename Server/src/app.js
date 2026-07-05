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
import { urlMongo } from "./config/env.js";
import { passwordMongo } from "./config/env.js";
// EXPRESS

export const app = express();
app.use("/agenda", express.static(path.resolve(__dirname, "../../client/build")));

app.use("/public", express.static(path.join(__dirname, "/public")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export const sessionStore = MongoStore.create({
  mongoUrl: urlMongo,
});

app.use(
  session({
    secret: passwordMongo,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
    },
  }),
);

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "http://localhost:4321",
].filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      // Permitir cualquier puerto local en desarrollo
      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Bloqueado por CORS"));
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
