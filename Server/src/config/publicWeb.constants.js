export const PUBLIC_WEB_VERIFICATION_METHOD = "dns_txt";

// Pending DNS proof is intentionally short-lived and distinct from both C1/C2.
export const PUBLIC_WEB_CHALLENGE_TTL_MS = 15 * 60 * 1000;

// Verified public-web trust is re-proven explicitly every 30 days.
export const PUBLIC_WEB_VERIFIED_TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// DNS verification is fail-closed and bounded; no HTTP fallback exists.
export const PUBLIC_WEB_DNS_TIMEOUT_MS = 3 * 1000;

// Admin verification operations receive a dedicated limiter in addition to the
// application-wide limiter.
export const PUBLIC_WEB_VERIFICATION_RATE_WINDOW_MS = 15 * 60 * 1000;
export const PUBLIC_WEB_VERIFICATION_RATE_LIMIT = 20;

// A short persisted lease linearizes C2 outbound-send authorization against
// public-web revocation. The external send must begin while this lease is held.
export const PUBLIC_WEB_AUTHORITY_FENCE_TTL_MS = 2 * 60 * 1000;
