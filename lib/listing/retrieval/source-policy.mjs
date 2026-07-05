import { retrievalSourceTypes, retrievalTrustTiers } from "./retrieval-contract.mjs";

const defaultOfficialDomains = [
  "topps.com",
  "paniniamerica.net",
  "upperdeck.com",
  "psacard.com",
  "beckett.com",
  "cgccards.com",
  "sgccard.com"
];

const defaultMarketplaceDomains = [
  "ebay.com"
];

const defaultTrustedStructuredDomains = [];

const defaultGradingDomains = [
  "psacard.com",
  "beckett.com",
  "cgccards.com",
  "sgccard.com"
];

const defaultBlockedDomains = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0"
];

function normalizeDomain(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase()
    .trim();
}

function envList(value) {
  return String(value || "")
    .split(",")
    .map(normalizeDomain)
    .filter(Boolean);
}

function domainMatches(domain, candidates = []) {
  const normalized = normalizeDomain(domain);
  return candidates.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`));
}

export function defaultSourcePolicy(env = process.env) {
  return {
    official_domains: [...new Set([...defaultOfficialDomains, ...envList(env.RETRIEVAL_OFFICIAL_DOMAINS)])],
    trusted_structured_domains: [...new Set([
      ...defaultTrustedStructuredDomains,
      ...envList(env.RETRIEVAL_TRUSTED_STRUCTURED_DOMAINS)
    ])],
    grading_domains: [...new Set([...defaultGradingDomains, ...envList(env.RETRIEVAL_GRADING_DOMAINS)])],
    marketplace_domains: [...new Set([...defaultMarketplaceDomains, ...envList(env.RETRIEVAL_MARKETPLACE_DOMAINS)])],
    blocked_domains: [...new Set([...defaultBlockedDomains, ...envList(env.RETRIEVAL_BLOCKED_DOMAINS)])],
    max_fetch_bytes: Number(env.RETRIEVAL_SOURCE_MAX_BYTES || 200_000),
    max_text_chars: Number(env.RETRIEVAL_SOURCE_MAX_TEXT_CHARS || 12_000),
    timeout_ms: Number(env.RETRIEVAL_SOURCE_TIMEOUT_MS || 8000),
    max_retries: Number(env.RETRIEVAL_SOURCE_MAX_RETRIES || 1),
    retry_base_ms: Number(env.RETRIEVAL_SOURCE_RETRY_BASE_MS || 250)
  };
}

export function classifySourceUrl(sourceUrl, {
  sourceType = null,
  policy = defaultSourcePolicy()
} = {}) {
  let domain = "";
  try {
    domain = normalizeDomain(new URL(sourceUrl).hostname);
  } catch {
    domain = normalizeDomain(sourceUrl);
  }

  const blocked = domainMatches(domain, policy.blocked_domains);
  const official = domainMatches(domain, policy.official_domains);
  const trustedStructured = domainMatches(domain, policy.trusted_structured_domains);
  const grading = domainMatches(domain, policy.grading_domains);
  const marketplace = domainMatches(domain, policy.marketplace_domains);
  const normalizedSourceType = sourceType || (
    grading
      ? retrievalSourceTypes.OFFICIAL_GRADING_DATA
      : official
      ? retrievalSourceTypes.OFFICIAL_PRODUCT_PAGE
      : marketplace
        ? retrievalSourceTypes.MARKETPLACE
        : trustedStructured
          ? retrievalSourceTypes.STRUCTURED_DATABASE
          : retrievalSourceTypes.OPEN_WEB
  );
  const trustTier = normalizedSourceType === retrievalSourceTypes.MARKETPLACE
    ? retrievalTrustTiers.MARKET_REFERENCE
    : official || grading
      ? retrievalTrustTiers.OFFICIAL
      : trustedStructured
        ? retrievalTrustTiers.STRUCTURED
        : retrievalTrustTiers.OPEN_WEB;

  return {
    domain,
    blocked,
    source_type: normalizedSourceType,
    trust_tier: trustTier
  };
}

export function assertSourceAllowed(sourceUrl, options = {}) {
  const classification = classifySourceUrl(sourceUrl, options);
  if (classification.blocked) {
    const error = new Error(`Blocked retrieval source domain: ${classification.domain}`);
    error.code = "retrieval_source_blocked";
    error.domain = classification.domain;
    throw error;
  }

  return classification;
}
