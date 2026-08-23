import BusinessConfig from "../db/models/businessConfig.model.js";
import Business from "../db/models/business.model.js";
import { PUBLIC_WEB_VERIFICATION_METHOD } from "../config/publicWeb.constants.js";

const BUSINESS_SUMMARY_PROJECTION = "_id name slug";
const PUBLIC_WEB_SECRET_SELECT = "+publicWeb.challengeHash +publicWeb.authorityFence.token";

export const PUBLIC_WEB_UNCONFIGURED_STATE = Object.freeze({
  websiteUrl: null,
  bookingUrl: null,
  verificationStatus: "unconfigured",
  verifiedOrigin: null,
  verifiedAt: null,
  verificationValidUntil: null,
  trustGeneration: 0,
  verificationMethod: PUBLIC_WEB_VERIFICATION_METHOD,
  challengeHash: null,
  challengeIssuedAt: null,
  challengeExpiresAt: null,
  verificationAttemptGeneration: 0,
  authorityFence: {
    token: null,
    trustGeneration: null,
    expiresAt: null,
  },
});

const cloneUnconfiguredState = () => ({
  ...PUBLIC_WEB_UNCONFIGURED_STATE,
  authorityFence: { ...PUBLIC_WEB_UNCONFIGURED_STATE.authorityFence },
});

// Obtener la configuración única del negocio
export const getConfig = async (businessId) => {
  return await BusinessConfig.findOne({ business: businessId })
    .populate("business", BUSINESS_SUMMARY_PROJECTION);
};

// Crear la configuración inicial por defecto
export const createDefaultConfig = async (defaultData) => {
  return await BusinessConfig.create(defaultData);
};

// Actualizar la configuración existente
export const updateConfig = async (id, updateData) => {
  return await BusinessConfig.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
    .populate("business", BUSINESS_SUMMARY_PROJECTION);
};

// Old BusinessConfig documents predate 6.2.6-B. Command paths may materialize
// the server-owned default state, while GET remains read-only and never calls it.
export const materializePublicWebDefaults = async (businessId) => {
  await BusinessConfig.updateOne(
    { business: businessId, publicWeb: { $exists: false } },
    { $set: { publicWeb: cloneUnconfiguredState() } },
    { runValidators: true },
  );
};

export const getConfigForPublicWebCommand = async (businessId) => (
  BusinessConfig.findOne({ business: businessId }).select(PUBLIC_WEB_SECRET_SELECT)
);

export const compareAndSetPublicWeb = async ({ businessId, match = {}, set = {}, unset = {} }) => {
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;

  return BusinessConfig.findOneAndUpdate(
    { business: businessId, ...match },
    update,
    { new: true, runValidators: true },
  ).select(PUBLIC_WEB_SECRET_SELECT);
};

export const findFreshTrustForBusiness = async ({ businessId, now }) => (
  BusinessConfig.findOne({
    business: businessId,
    "publicWeb.verificationStatus": "verified",
    "publicWeb.websiteUrl": { $type: "string" },
    "publicWeb.verifiedOrigin": { $type: "string" },
    "publicWeb.verificationValidUntil": { $gt: now },
    "publicWeb.trustGeneration": { $gte: 1 },
  }).select("business publicWeb.websiteUrl publicWeb.verifiedOrigin publicWeb.verificationValidUntil publicWeb.trustGeneration")
    .lean()
);

// Shared origins are valid, but preflight only needs existence of one active
// Business with fresh trust. The pipeline is deliberately bounded at one result;
// it never materializes the set of all Businesses sharing an Origin.
export const buildFreshTrustForOriginPipeline = ({ origin, now }) => [
  {
    $match: {
      "publicWeb.verifiedOrigin": origin,
      "publicWeb.verificationStatus": "verified",
      "publicWeb.verificationValidUntil": { $gt: now },
      "publicWeb.websiteUrl": origin,
      "publicWeb.trustGeneration": { $gte: 1 },
    },
  },
  {
    $lookup: {
      from: Business.collection.name,
      localField: "business",
      foreignField: "_id",
      as: "activeBusiness",
    },
  },
  { $unwind: "$activeBusiness" },
  { $match: { "activeBusiness.isActive": true } },
  { $limit: 1 },
  { $project: { _id: 1 } },
];

export const hasFreshTrustForOrigin = async ({ origin, now }) => {
  const matches = await BusinessConfig.aggregate(
    buildFreshTrustForOriginPipeline({ origin, now }),
  ).option({ allowDiskUse: false });
  return matches.length === 1;
};

const availableFenceMatch = (now) => ({
  $or: [
    { "publicWeb.authorityFence.expiresAt": null },
    { "publicWeb.authorityFence.expiresAt": { $exists: false } },
    { "publicWeb.authorityFence.expiresAt": { $lte: now } },
  ],
});

export const acquirePublicWebAuthorityFence = async ({
  businessId,
  trustedOrigin,
  trustGeneration,
  token,
  now,
  expiresAt,
}) => BusinessConfig.findOneAndUpdate(
  {
    business: businessId,
    "publicWeb.verificationStatus": "verified",
    "publicWeb.websiteUrl": trustedOrigin,
    "publicWeb.verifiedOrigin": trustedOrigin,
    "publicWeb.trustGeneration": trustGeneration,
    "publicWeb.verificationValidUntil": { $gt: now },
    ...availableFenceMatch(now),
  },
  {
    $set: {
      "publicWeb.authorityFence.token": token,
      "publicWeb.authorityFence.trustGeneration": trustGeneration,
      "publicWeb.authorityFence.expiresAt": expiresAt,
    },
  },
  { new: true, runValidators: true },
).select(PUBLIC_WEB_SECRET_SELECT);

export const confirmPublicWebAuthorityFence = async ({
  businessId,
  trustedOrigin,
  trustGeneration,
  token,
  now,
}) => BusinessConfig.exists({
  business: businessId,
  "publicWeb.verificationStatus": "verified",
  "publicWeb.websiteUrl": trustedOrigin,
  "publicWeb.verifiedOrigin": trustedOrigin,
  "publicWeb.trustGeneration": trustGeneration,
  "publicWeb.verificationValidUntil": { $gt: now },
  "publicWeb.authorityFence.token": token,
  "publicWeb.authorityFence.trustGeneration": trustGeneration,
  "publicWeb.authorityFence.expiresAt": { $gt: now },
});

export const releasePublicWebAuthorityFence = async ({ businessId, trustGeneration, token }) => (
  BusinessConfig.findOneAndUpdate(
    {
      business: businessId,
      "publicWeb.authorityFence.token": token,
      "publicWeb.authorityFence.trustGeneration": trustGeneration,
    },
    {
      $set: {
        "publicWeb.authorityFence.token": null,
        "publicWeb.authorityFence.trustGeneration": null,
        "publicWeb.authorityFence.expiresAt": null,
      },
    },
    { new: true, runValidators: true },
  )
);

export const noActiveAuthorityFenceMatch = (now) => availableFenceMatch(now);
