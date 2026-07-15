const publisherPrefixes = Object.freeze([
  "upper deck",
  "wizards of the coast",
  "cryptozoic",
  "cardsmiths",
  "kakawow",
  "bowman",
  "donruss",
  "panini",
  "pokemon",
  "topps",
  "fleer",
  "leaf",
  "skybox"
]);

const nonDistinctiveTokens = new Set([
  "and",
  "base",
  "baseball",
  "basketball",
  "cards",
  "collection",
  "edition",
  "football",
  "hockey",
  "panini",
  "pokemon",
  "series",
  "skybox",
  "soccer",
  "the",
  "topps",
  "trading",
  "upper",
  "deck",
  "bowman",
  "donruss",
  "fleer",
  "leaf"
]);

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingReleaseYear(value) {
  return value.replace(/^(?:19|20)\d{2}(?:(?:\s*[-/]\s*|\s+)(?:\d{2}|(?:19|20)\d{2}))?\s+/, "").trim();
}

function publisherRemainder(value) {
  const prefix = publisherPrefixes.find((item) => value === item || value.startsWith(`${item} `));
  return prefix ? value.slice(prefix.length).trim() : value;
}

function stripGenericSportSuffix(value) {
  const match = value.match(/\s+(baseball|basketball|football|hockey|soccer)(?:\s+(?:trading\s+)?cards?)?$/);
  if (!match) return value;
  if (match[1] === "soccer" && /\bfifa\s*$/.test(value.slice(0, match.index))) return value;
  const withoutSuffix = value.slice(0, match.index).trim();
  return publisherRemainder(withoutSuffix) ? withoutSuffix : value;
}

export function productSemanticKey(value) {
  return stripLeadingReleaseYear(normalizedText(value));
}

export function productProxyComparisonKey(value) {
  return stripGenericSportSuffix(productSemanticKey(value));
}

export function productsSemanticallyEquivalent(left, right) {
  const leftKey = productSemanticKey(left);
  const rightKey = productSemanticKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function productsProxyCompatible(left, right) {
  const leftKey = productProxyComparisonKey(left);
  const rightKey = productProxyComparisonKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function sharedDistinctiveProductTokens(left, right) {
  const tokensFor = (value) => new Set(productSemanticKey(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !nonDistinctiveTokens.has(token)));
  const leftTokens = tokensFor(left);
  const rightTokens = tokensFor(right);
  return [...leftTokens].filter((token) => rightTokens.has(token));
}
