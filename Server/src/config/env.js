import "dotenv/config";

// ─── Server ───
export const port = process.env.PORT || 3000;
export const nodeEnv = process.env.NODE_ENV || "development";

// ─── MongoDB ───
export const urlMongo = process.env.MONGO_URI;
export const passwordMongo = process.env.PASSWORD_MONGO;

// ─── Session ───
// IMPORTANT: Use a dedicated secret, NOT the MongoDB password
export const sessionSecret = process.env.SESSION_SECRET || process.env.PASSWORD_MONGO;

// ─── URLs ───
export const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
export const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4321";

// ─── Google OAuth ───
export const googleClientId = process.env.GOOGLE_CLIENT_ID;
export const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

// ─── CORS ───
// Comma-separated list of allowed origins, e.g. "http://localhost:4321,https://app.miagenda.cl"
export const corsOrigins = process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:4321";
