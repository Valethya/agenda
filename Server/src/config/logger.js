import winston from "winston";

const SENSITIVE_KEY_RE = /(?:authorization|cookie|password|passwd|secret|token|capability|challenge|api[_-]?key|mongo_uri|session)/iu;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu;
const MONGO_CREDENTIAL_RE = /(mongodb(?:\+srv)?:\/\/)[^\s@/]+@/giu;

export const redactLogValue = (value, key = "") => {
  if (SENSITIVE_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(BEARER_RE, "Bearer [REDACTED]")
      .replace(MONGO_CREDENTIAL_RE, "$1[REDACTED]@");
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactLogValue(childValue, childKey),
    ]));
  }
  return value;
};

const redactFormat = winston.format((info) => {
  const clean = redactLogValue({ ...info });
  Object.keys(info).forEach((key) => delete info[key]);
  Object.assign(info, clean);
  return info;
});

const production = process.env.NODE_ENV === "production";

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: production
    ? winston.format.combine(
      redactFormat(),
      winston.format.timestamp(),
      winston.format.json(),
    )
    : winston.format.combine(
      redactFormat(),
      winston.format.colorize(),
      winston.format.simple(),
    ),
  transports: [new winston.transports.Console()],
});

export default logger;
