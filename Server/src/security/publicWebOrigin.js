import net from "node:net";

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class PublicWebUrlPolicyError extends TypeError {
  constructor(reason = "invalid_url") {
    super("Public web URL is not allowed");
    this.code = reason;
  }
}

const invalid = (reason) => {
  throw new PublicWebUrlPolicyError(reason);
};

const requireStringUrl = (value) => {
  if (typeof value !== "string") invalid("invalid_url");
  const trimmed = value.trim();
  if (!trimmed) invalid("invalid_url");
  return trimmed;
};

const validateDnsHostname = (hostnameValue) => {
  const hostname = hostnameValue.toLowerCase();
  const ipCandidate = hostname.replace(/^\[/u, "").replace(/\]$/u, "");

  if (
    !hostname
    || hostname.includes("*")
    || net.isIP(ipCandidate) !== 0
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || !hostname.includes(".")
    || hostname.length > 253
    || hostname.startsWith(".")
    || hostname.endsWith(".")
  ) {
    invalid("invalid_hostname");
  }

  const labels = hostname.split(".");
  if (labels.some((label) => label.length > 63 || !DNS_LABEL_RE.test(label))) {
    invalid("invalid_hostname");
  }

  return hostname;
};

const parsePublicHttpsUrl = (value) => {
  const candidate = requireStringUrl(value);
  let url;
  try {
    url = new URL(candidate);
  } catch {
    invalid("invalid_url");
  }

  if (
    url.protocol !== "https:"
    || url.port !== ""
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    invalid("invalid_url");
  }

  validateDnsHostname(url.hostname);
  return url;
};

export const normalizePublicWebsiteUrl = (value) => {
  const url = parsePublicHttpsUrl(value);
  if (url.pathname !== "/" && url.pathname !== "") invalid("website_path_not_allowed");
  return url.origin;
};

export const normalizePublicBookingUrl = (value, expectedOrigin) => {
  const url = parsePublicHttpsUrl(value);
  if (typeof expectedOrigin !== "string" || url.origin !== expectedOrigin) {
    invalid("origin_mismatch");
  }
  return `${url.origin}${url.pathname || "/"}`;
};

export const normalizePublicWebPair = ({ websiteUrl, bookingUrl }) => {
  const website = normalizePublicWebsiteUrl(websiteUrl);
  const booking = normalizePublicBookingUrl(bookingUrl, website);
  return { websiteUrl: website, bookingUrl: booking, origin: website };
};

// Browser Origin is already an origin by specification. We still parse and
// require the exact canonical origin form so arbitrary URL paths/query/fragment
// never become part of the trust comparison.
export const normalizePublicRequestOrigin = (value) => {
  const url = parsePublicHttpsUrl(value);
  if ((url.pathname !== "/" && url.pathname !== "") || url.origin !== `${url.protocol}//${url.host}`) {
    invalid("invalid_origin");
  }
  return url.origin;
};
