import { PUBLIC_WEB_VERIFICATION_METHOD } from "../config/publicWeb.constants.js";

export const publicWebRecordName = (origin) => {
  const url = new URL(origin);
  return `_agenda-verification.${url.hostname}`;
};

export const publicWebDefaultState = (trustGeneration = 0) => ({
  websiteUrl: null,
  bookingUrl: null,
  verificationStatus: "unconfigured",
  verificationMethod: PUBLIC_WEB_VERIFICATION_METHOD,
  verifiedOrigin: null,
  verifiedAt: null,
  verificationValidUntil: null,
  trustGeneration,
  dnsVerification: null,
});

export const serializePublicWebState = (publicWeb, { rawChallenge = null } = {}) => {
  if (!publicWeb || publicWeb.verificationStatus === "unconfigured" || !publicWeb.websiteUrl) {
    return publicWebDefaultState(publicWeb?.trustGeneration ?? 0);
  }

  const pending = publicWeb.verificationStatus === "pending";
  return {
    websiteUrl: publicWeb.websiteUrl,
    bookingUrl: publicWeb.bookingUrl,
    verificationStatus: publicWeb.verificationStatus,
    verificationMethod: publicWeb.verificationMethod ?? PUBLIC_WEB_VERIFICATION_METHOD,
    verifiedOrigin: publicWeb.verifiedOrigin ?? null,
    verifiedAt: publicWeb.verifiedAt ?? null,
    verificationValidUntil: publicWeb.verificationValidUntil ?? null,
    trustGeneration: publicWeb.trustGeneration ?? 0,
    dnsVerification: pending ? {
      recordType: "TXT",
      recordName: publicWebRecordName(publicWeb.websiteUrl),
      recordValue: rawChallenge ? `agenda-verification=${rawChallenge}` : null,
      challengeExpiresAt: publicWeb.challengeExpiresAt ?? null,
    } : null,
  };
};
