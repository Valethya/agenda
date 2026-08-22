import crypto from "node:crypto";
import dns from "node:dns";
import { AppError } from "../utils/appError.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
import { getOrInitializeConfig } from "./businessConfig.service.js";
import {
  PUBLIC_WEB_AUTHORITY_FENCE_TTL_MS,
  PUBLIC_WEB_CHALLENGE_TTL_MS,
  PUBLIC_WEB_DNS_TIMEOUT_MS,
  PUBLIC_WEB_VERIFICATION_METHOD,
  PUBLIC_WEB_VERIFIED_TRUST_TTL_MS,
} from "../config/publicWeb.constants.js";
import {
  normalizePublicRequestOrigin,
  normalizePublicWebPair,
  PublicWebUrlPolicyError,
} from "../security/publicWebOrigin.js";
import { publicWebRecordName, serializePublicWebState } from "../security/publicWebState.js";

export const PUBLIC_WEB_ERROR_CODES = Object.freeze({
  INVALID_URL: "PUBLIC_WEB_INVALID_URL",
  ORIGIN_MISMATCH: "PUBLIC_WEB_ORIGIN_MISMATCH",
  UNCONFIGURED: "PUBLIC_WEB_UNCONFIGURED",
  NOT_PENDING: "PUBLIC_WEB_NOT_PENDING",
  REVERIFICATION_REQUIRED: "PUBLIC_WEB_REVERIFICATION_REQUIRED",
  CHALLENGE_EXPIRED: "PUBLIC_WEB_CHALLENGE_EXPIRED",
  VERIFICATION_NOT_PROVEN: "PUBLIC_WEB_VERIFICATION_NOT_PROVEN",
  STATE_CHANGED: "PUBLIC_WEB_STATE_CHANGED",
  TRUST_EXPIRED: "PUBLIC_WEB_TRUST_EXPIRED",
  DNS_UNAVAILABLE: "PUBLIC_WEB_DNS_UNAVAILABLE",
});

const publicWebError = (statusCode, code, message) => new AppError(message, statusCode, code);
const stateChanged = () => publicWebError(409, PUBLIC_WEB_ERROR_CODES.STATE_CHANGED, "El estado de publicWeb cambió; vuelve a intentar");

const requireDate = (value, name = "date") => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${name} inválido`);
  return value;
};

const asId = (value) => (value?._id ?? value)?.toString?.() || "";

const hashChallenge = ({ businessId, origin, attemptGeneration, raw }) => crypto
  .createHash("sha256")
  .update(asId(businessId), "utf8").update("\0", "utf8")
  .update(origin, "utf8").update("\0", "utf8")
  .update(String(attemptGeneration), "utf8").update("\0", "utf8")
  .update(raw, "utf8")
  .digest("hex");

const sameHash = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || !/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

const issueChallenge = ({ businessId, origin, attemptGeneration, now }) => {
  const raw = crypto.randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashChallenge({ businessId, origin, attemptGeneration, raw }),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + PUBLIC_WEB_CHALLENGE_TTL_MS),
  };
};

const normalizePairOrThrow = (payload) => {
  try {
    return normalizePublicWebPair(payload);
  } catch (error) {
    if (!(error instanceof PublicWebUrlPolicyError)) throw error;
    const mismatch = error.code === "origin_mismatch";
    throw publicWebError(
      400,
      mismatch ? PUBLIC_WEB_ERROR_CODES.ORIGIN_MISMATCH : PUBLIC_WEB_ERROR_CODES.INVALID_URL,
      mismatch ? "bookingUrl debe usar exactamente el mismo origin que websiteUrl" : "La URL pública no cumple la política requerida",
    );
  }
};

const getCommandConfig = async (businessId) => {
  await getOrInitializeConfig(businessId);
  await businessConfigRepository.materializePublicWebDefaults(businessId);
  const config = await businessConfigRepository.getConfigForPublicWebCommand(businessId);
  if (!config) throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.UNCONFIGURED, "No existe configuración para el negocio");
  return config;
};

const normalizedStatus = (publicWeb) => publicWeb?.verificationStatus ?? "unconfigured";
const numericGeneration = (value) => Number.isInteger(value) && value >= 0 ? value : 0;

const snapshotMatch = (publicWeb) => ({
  "publicWeb.verificationStatus": normalizedStatus(publicWeb),
  "publicWeb.trustGeneration": numericGeneration(publicWeb?.trustGeneration),
  "publicWeb.verificationAttemptGeneration": numericGeneration(publicWeb?.verificationAttemptGeneration),
});

const noActiveFence = (now) => businessConfigRepository.noActiveAuthorityFenceMatch(now);

const challengeSet = ({ normalized, trustGeneration, attemptGeneration, challenge }) => ({
  "publicWeb.websiteUrl": normalized.websiteUrl,
  "publicWeb.bookingUrl": normalized.bookingUrl,
  "publicWeb.verificationStatus": "pending",
  "publicWeb.verifiedOrigin": null,
  "publicWeb.verifiedAt": null,
  "publicWeb.verificationValidUntil": null,
  "publicWeb.trustGeneration": trustGeneration,
  "publicWeb.verificationMethod": PUBLIC_WEB_VERIFICATION_METHOD,
  "publicWeb.challengeHash": challenge.hash,
  "publicWeb.challengeIssuedAt": challenge.issuedAt,
  "publicWeb.challengeExpiresAt": challenge.expiresAt,
  "publicWeb.verificationAttemptGeneration": attemptGeneration,
  "publicWeb.authorityFence.token": null,
  "publicWeb.authorityFence.trustGeneration": null,
  "publicWeb.authorityFence.expiresAt": null,
});

export const configurePublicWeb = async ({ businessId, websiteUrl, bookingUrl, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  const normalized = normalizePairOrThrow({ websiteUrl, bookingUrl });
  const config = await getCommandConfig(businessId);
  const current = config.publicWeb;
  const currentOrigin = current?.websiteUrl ?? null;
  const currentBooking = current?.bookingUrl ?? null;

  if (currentOrigin === normalized.origin) {
    if (currentBooking === normalized.bookingUrl) {
      return serializePublicWebState(current);
    }

    const updated = await businessConfigRepository.compareAndSetPublicWeb({
      businessId,
      match: {
        ...snapshotMatch(current),
        "publicWeb.websiteUrl": currentOrigin,
        "publicWeb.bookingUrl": currentBooking,
      },
      set: { "publicWeb.bookingUrl": normalized.bookingUrl },
    });
    if (!updated) throw stateChanged();
    return serializePublicWebState(updated.publicWeb);
  }

  const trustGeneration = numericGeneration(current?.trustGeneration) + 1;
  const attemptGeneration = numericGeneration(current?.verificationAttemptGeneration) + 1;
  const challenge = issueChallenge({ businessId, origin: normalized.origin, attemptGeneration, now: scopedNow });
  const updated = await businessConfigRepository.compareAndSetPublicWeb({
    businessId,
    match: {
      ...snapshotMatch(current),
      ...noActiveFence(scopedNow),
    },
    set: challengeSet({ normalized, trustGeneration, attemptGeneration, challenge }),
  });
  if (!updated) throw stateChanged();
  return serializePublicWebState(updated.publicWeb, { rawChallenge: challenge.raw });
};

export const reverifyPublicWeb = async ({ businessId, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  const config = await getCommandConfig(businessId);
  const current = config.publicWeb;
  if (!current?.websiteUrl || normalizedStatus(current) === "unconfigured") {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.UNCONFIGURED, "Public web no está configurado");
  }
  if (normalizedStatus(current) === "pending") {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.NOT_PENDING, "Ya existe una verificación DNS pendiente; rota el challenge si perdiste el valor raw");
  }

  const trustGeneration = numericGeneration(current.trustGeneration) + 1;
  const attemptGeneration = numericGeneration(current.verificationAttemptGeneration) + 1;
  const normalized = normalizePairOrThrow({ websiteUrl: current.websiteUrl, bookingUrl: current.bookingUrl });
  const challenge = issueChallenge({ businessId, origin: normalized.origin, attemptGeneration, now: scopedNow });
  const updated = await businessConfigRepository.compareAndSetPublicWeb({
    businessId,
    match: {
      ...snapshotMatch(current),
      "publicWeb.websiteUrl": current.websiteUrl,
      ...noActiveFence(scopedNow),
    },
    set: challengeSet({ normalized, trustGeneration, attemptGeneration, challenge }),
  });
  if (!updated) throw stateChanged();
  return serializePublicWebState(updated.publicWeb, { rawChallenge: challenge.raw });
};

export const rotatePublicWebChallenge = async ({ businessId, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  const config = await getCommandConfig(businessId);
  const current = config.publicWeb;
  if (!current?.websiteUrl || normalizedStatus(current) === "unconfigured") {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.UNCONFIGURED, "Public web no está configurado");
  }
  if (normalizedStatus(current) !== "pending") {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.NOT_PENDING, "No existe una verificación DNS pendiente");
  }

  const attemptGeneration = numericGeneration(current.verificationAttemptGeneration) + 1;
  const challenge = issueChallenge({ businessId, origin: current.websiteUrl, attemptGeneration, now: scopedNow });
  const updated = await businessConfigRepository.compareAndSetPublicWeb({
    businessId,
    match: {
      ...snapshotMatch(current),
      "publicWeb.websiteUrl": current.websiteUrl,
    },
    set: {
      "publicWeb.challengeHash": challenge.hash,
      "publicWeb.challengeIssuedAt": challenge.issuedAt,
      "publicWeb.challengeExpiresAt": challenge.expiresAt,
      "publicWeb.verificationAttemptGeneration": attemptGeneration,
    },
  });
  if (!updated) throw stateChanged();
  return serializePublicWebState(updated.publicWeb, { rawChallenge: challenge.raw });
};

const defaultResolveTxt = (recordName) => dns.promises.resolveTxt(recordName);

const resolveTxtBounded = async ({ recordName, resolveTxt, timeoutMs }) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => resolveTxt(recordName)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const txtProofMatches = ({ records, businessId, origin, attemptGeneration, challengeHash }) => {
  if (!Array.isArray(records)) return false;
  for (const rr of records) {
    const value = Array.isArray(rr) ? rr.join("") : String(rr ?? "");
    if (!value.startsWith("agenda-verification=")) continue;
    const raw = value.slice("agenda-verification=".length);
    if (!raw) continue;
    const candidate = hashChallenge({ businessId, origin, attemptGeneration, raw });
    if (sameHash(candidate, challengeHash)) return true;
  }
  return false;
};

export const verifyPublicWeb = async ({
  businessId,
  now = new Date(),
  resolveTxt = defaultResolveTxt,
  dnsTimeoutMs = PUBLIC_WEB_DNS_TIMEOUT_MS,
}) => {
  const scopedNow = requireDate(now, "now");
  const config = await getCommandConfig(businessId);
  const current = config.publicWeb;
  if (!current?.websiteUrl || normalizedStatus(current) === "unconfigured") {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.UNCONFIGURED, "Public web no está configurado");
  }
  if (normalizedStatus(current) !== "pending") {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.REVERIFICATION_REQUIRED, "Inicia re-verification antes de verificar nuevamente");
  }
  if (!(current.challengeExpiresAt instanceof Date) || current.challengeExpiresAt.getTime() <= scopedNow.getTime() || !current.challengeHash) {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.CHALLENGE_EXPIRED, "El challenge DNS ya expiró");
  }

  const snapshot = {
    origin: current.websiteUrl,
    challengeHash: current.challengeHash,
    attemptGeneration: current.verificationAttemptGeneration,
    trustGeneration: current.trustGeneration,
    challengeExpiresAt: current.challengeExpiresAt,
  };

  let records;
  try {
    records = await resolveTxtBounded({
      recordName: publicWebRecordName(snapshot.origin),
      resolveTxt,
      timeoutMs: dnsTimeoutMs,
    });
  } catch {
    throw publicWebError(503, PUBLIC_WEB_ERROR_CODES.DNS_UNAVAILABLE, "No fue posible comprobar el registro DNS");
  }

  if (!txtProofMatches({
    records,
    businessId,
    origin: snapshot.origin,
    attemptGeneration: snapshot.attemptGeneration,
    challengeHash: snapshot.challengeHash,
  })) {
    throw publicWebError(409, PUBLIC_WEB_ERROR_CODES.VERIFICATION_NOT_PROVEN, "No se pudo demostrar el control DNS requerido");
  }

  const validUntil = new Date(scopedNow.getTime() + PUBLIC_WEB_VERIFIED_TRUST_TTL_MS);
  const updated = await businessConfigRepository.compareAndSetPublicWeb({
    businessId,
    match: {
      "publicWeb.verificationStatus": "pending",
      "publicWeb.websiteUrl": snapshot.origin,
      "publicWeb.challengeHash": snapshot.challengeHash,
      "publicWeb.challengeExpiresAt": { $gt: scopedNow },
      "publicWeb.verificationAttemptGeneration": snapshot.attemptGeneration,
      "publicWeb.trustGeneration": snapshot.trustGeneration,
    },
    set: {
      "publicWeb.verificationStatus": "verified",
      "publicWeb.verifiedOrigin": snapshot.origin,
      "publicWeb.verifiedAt": scopedNow,
      "publicWeb.verificationValidUntil": validUntil,
      "publicWeb.challengeHash": null,
      "publicWeb.challengeIssuedAt": null,
      "publicWeb.challengeExpiresAt": null,
    },
  });
  if (!updated) throw stateChanged();
  return serializePublicWebState(updated.publicWeb);
};

export const deletePublicWeb = async ({ businessId, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  const config = await getCommandConfig(businessId);
  const current = config.publicWeb;
  if (!current?.websiteUrl || normalizedStatus(current) === "unconfigured") {
    return serializePublicWebState(current);
  }

  const trustGeneration = numericGeneration(current.trustGeneration) + 1;
  const updated = await businessConfigRepository.compareAndSetPublicWeb({
    businessId,
    match: {
      ...snapshotMatch(current),
      "publicWeb.websiteUrl": current.websiteUrl,
      ...noActiveFence(scopedNow),
    },
    set: {
      "publicWeb.websiteUrl": null,
      "publicWeb.bookingUrl": null,
      "publicWeb.verificationStatus": "unconfigured",
      "publicWeb.verifiedOrigin": null,
      "publicWeb.verifiedAt": null,
      "publicWeb.verificationValidUntil": null,
      "publicWeb.trustGeneration": trustGeneration,
      "publicWeb.verificationMethod": PUBLIC_WEB_VERIFICATION_METHOD,
      "publicWeb.challengeHash": null,
      "publicWeb.challengeIssuedAt": null,
      "publicWeb.challengeExpiresAt": null,
      "publicWeb.authorityFence.token": null,
      "publicWeb.authorityFence.trustGeneration": null,
      "publicWeb.authorityFence.expiresAt": null,
    },
  });
  if (!updated) throw stateChanged();
  return serializePublicWebState(updated.publicWeb);
};

export const resolveFreshPublicWebTrust = async ({ businessId, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  const [business, config] = await Promise.all([
    businessRepository.findById(businessId),
    businessConfigRepository.findFreshTrustForBusiness({ businessId, now: scopedNow }),
  ]);
  if (!business?.isActive || !config?.publicWeb) return null;
  const publicWeb = config.publicWeb;
  if (publicWeb.websiteUrl !== publicWeb.verifiedOrigin) return null;
  return {
    origin: publicWeb.verifiedOrigin,
    trustGeneration: publicWeb.trustGeneration,
    verificationValidUntil: publicWeb.verificationValidUntil,
  };
};

export const publicOriginHasFreshTrust = async ({ origin, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  let normalized;
  try {
    normalized = normalizePublicRequestOrigin(origin);
  } catch {
    return false;
  }
  return businessConfigRepository.hasFreshTrustForOrigin({ origin: normalized, now: scopedNow });
};

export const browserOriginMatchesBusinessTrust = async ({ businessId, origin, now = new Date() }) => {
  let normalized;
  try {
    normalized = normalizePublicRequestOrigin(origin);
  } catch {
    return false;
  }
  const trust = await resolveFreshPublicWebTrust({ businessId, now });
  return Boolean(trust && trust.origin === normalized);
};

export const acquirePublicWebSendFence = async ({ businessId, trust, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  if (!trust?.origin || !Number.isInteger(trust.trustGeneration) || trust.trustGeneration < 1) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(scopedNow.getTime() + PUBLIC_WEB_AUTHORITY_FENCE_TTL_MS);
  const acquired = await businessConfigRepository.acquirePublicWebAuthorityFence({
    businessId,
    trustedOrigin: trust.origin,
    trustGeneration: trust.trustGeneration,
    token,
    now: scopedNow,
    expiresAt,
  });
  return acquired ? { token, expiresAt, trust } : null;
};

export const confirmPublicWebSendFence = async ({ businessId, fence, now = new Date() }) => {
  const scopedNow = requireDate(now, "now");
  if (!fence?.token || !fence?.trust) return false;
  return Boolean(await businessConfigRepository.confirmPublicWebAuthorityFence({
    businessId,
    trustedOrigin: fence.trust.origin,
    trustGeneration: fence.trust.trustGeneration,
    token: fence.token,
    now: scopedNow,
  }));
};

export const releasePublicWebSendFence = async ({ businessId, fence }) => {
  if (!fence?.token || !fence?.trust?.trustGeneration) return;
  await businessConfigRepository.releasePublicWebAuthorityFence({
    businessId,
    trustGeneration: fence.trust.trustGeneration,
    token: fence.token,
  });
};
