// Shared C1 retention contract. Every ClientContactVerification purpose is
// temporary evidence: runtime authority ends exactly at expiresAt and physical
// cleanup is eligible one hour later, independent of purpose.
export const CLIENT_CONTACT_VERIFICATION_RETENTION_MS = 60 * 60 * 1000;
export const CLIENT_CONTACT_VERIFICATION_RETENTION_SECONDS = CLIENT_CONTACT_VERIFICATION_RETENTION_MS / 1000;
