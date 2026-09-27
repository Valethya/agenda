import "dotenv/config";
import { assertProductionConfig } from "./productionConfig.js";

// Validate production before any consumer can construct sessions, transports or
// listeners from unsafe fallbacks. Development/test keep their historical local
// defaults so existing workflows remain intact.
export const productionConfig = assertProductionConfig(process.env);

// ─── Server ───
export const port = Number(process.env.PORT || 3000);
export const nodeEnv = process.env.NODE_ENV || "development";
export const trustProxyHops = nodeEnv === "production"
  ? productionConfig.trustProxyHops
  : Number(process.env.TRUST_PROXY_HOPS || 1);

// ─── MongoDB ───
export const urlMongo = process.env.MONGO_URI;
export const passwordMongo = process.env.PASSWORD_MONGO;

// ─── Session ───
// Production requires a dedicated SESSION_SECRET. PASSWORD_MONGO fallback is
// development compatibility only and is rejected by production validation.
export const sessionSecret = process.env.SESSION_SECRET
  || (nodeEnv === "production" ? undefined : process.env.PASSWORD_MONGO);

// ─── URLs ───
export const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
export const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4321";

// ─── Google OAuth ───
export const googleClientId = process.env.GOOGLE_CLIENT_ID;
export const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

// ─── CORS ───
// Comma-separated list of allowed origins. Production requires an explicit list
// and validation ensures FRONTEND_URL is included without wildcard/local origins.
export const corsOrigins = process.env.CORS_ORIGINS
  || (nodeEnv === "production" ? "" : process.env.FRONTEND_URL || "http://localhost:4321");

// ─── Optional modules ───
export const paymentRoutesEnabled = process.env.ENABLE_PAYMENTS === "true";
