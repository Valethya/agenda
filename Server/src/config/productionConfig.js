const PLACEHOLDER_RE = /^(?:changeme|change-me|secret|password|example|test|development|dev)$/iu;
const LOCAL_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/u;

const fail = (message) => {
  const error = new Error(`PRODUCTION_CONFIG_INVALID: ${message}`);
  error.code = "PRODUCTION_CONFIG_INVALID";
  return error;
};

const requireValue = (env, key) => {
  const value = env[key]?.trim?.();
  if (!value) throw fail(`${key} is required`);
  return value;
};

const assertSecret = (env, key, { minLength = 32 } = {}) => {
  const value = requireValue(env, key);
  if (value.length < minLength || PLACEHOLDER_RE.test(value)) {
    throw fail(`${key} must be a non-placeholder secret of at least ${minLength} characters`);
  }
  return value;
};

const assertHttpsUrl = (env, key) => {
  const raw = requireValue(env, key);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw fail(`${key} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:") throw fail(`${key} must use https in production`);
  if (parsed.username || parsed.password) throw fail(`${key} must not contain credentials`);
  if (LOCAL_HOST_RE.test(parsed.hostname)) throw fail(`${key} must not target a local host in production`);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw fail(`${key} must be an origin URL without path, query or fragment`);
  }
  return parsed.origin;
};

const assertMongoUri = (env) => {
  const value = requireValue(env, "MONGO_URI");
  if (!/^mongodb(?:\+srv)?:\/\//u.test(value)) throw fail("MONGO_URI must be a MongoDB connection URI");
  if (/mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?(?:localhost|127\.|0\.0\.0\.0|\[::1\])/iu.test(value)) {
    throw fail("MONGO_URI must not target a local MongoDB host in production");
  }
  if (!/\/[^/?]+(?:\?|$)/u.test(value)) throw fail("MONGO_URI must select an explicit database name");
  return value;
};

const assertEmail = (env, key) => {
  const value = requireValue(env, key);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) throw fail(`${key} must be a valid email address`);
  return value;
};

const assertPositiveInt = (env, key, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = requireValue(env, key);
  if (!/^\d+$/u.test(raw)) throw fail(`${key} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(`${key} is outside the supported range`);
  return value;
};

const parseOrigins = (env) => {
  const raw = requireValue(env, "CORS_ORIGINS");
  const origins = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (origins.length === 0) throw fail("CORS_ORIGINS must contain at least one origin");
  if (origins.some((origin) => origin === "*")) throw fail("CORS_ORIGINS must not contain a wildcard");
  const normalized = origins.map((origin) => {
    let parsed;
    try { parsed = new URL(origin); } catch { throw fail("CORS_ORIGINS contains an invalid URL"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw fail("CORS_ORIGINS must contain https origins only");
    }
    if (LOCAL_HOST_RE.test(parsed.hostname)) throw fail("CORS_ORIGINS must not contain local origins in production");
    return parsed.origin;
  });
  return [...new Set(normalized)];
};

export const validateProductionConfig = (env = process.env) => {
  if ((env.NODE_ENV || "development") !== "production") return { production: false };

  const mongoUri = assertMongoUri(env);
  const sessionSecret = assertSecret(env, "SESSION_SECRET", { minLength: 32 });
  if (env.PASSWORD_MONGO && sessionSecret === env.PASSWORD_MONGO) {
    throw fail("SESSION_SECRET must be independent from PASSWORD_MONGO");
  }

  const frontendOrigin = assertHttpsUrl(env, "FRONTEND_URL");
  const backendOrigin = assertHttpsUrl(env, "BACKEND_URL");
  const corsOrigins = parseOrigins(env);
  if (!corsOrigins.includes(frontendOrigin)) throw fail("CORS_ORIGINS must include FRONTEND_URL");

  assertSecret(env, "RESEND_API_KEY", { minLength: 20 });
  assertEmail(env, "SMTP_FROM_EMAIL");
  const trustProxyHops = assertPositiveInt(env, "TRUST_PROXY_HOPS", { min: 1, max: 8 });

  return Object.freeze({
    production: true,
    mongoUri,
    frontendOrigin,
    backendOrigin,
    corsOrigins,
    trustProxyHops,
  });
};

export const assertProductionConfig = (env = process.env) => validateProductionConfig(env);
