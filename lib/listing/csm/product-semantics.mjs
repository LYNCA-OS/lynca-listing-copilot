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

// Two vocabularies, one owner, deliberately not merged.
//
// `nonDistinctiveTokens` above answers "does this word help tell two PRODUCTS
// apart" and is used for catalogue comparison. The list below answers "may this
// word be dropped from a rendered TITLE", which is a different question with a
// different answer: `edition` is non-distinctive when comparing products, but
// "1st Edition" is a printed semantic value that must survive into a title.
// Merging them would silently delete real identity.
//
// Both live here because CSM owns the ontology. The Listing Copilot previously
// redeclared a subset of this as a private regex, which is exactly what COS-27
// forbids -- the application consumes CSM, it does not restate it.
//
// The membership is measured, not categorical. A sport name is filler when the
// writer's title omits it, and "Tennis" is why: it stays, because writers keep
// it. "Card" is filler except when it opens CSM's Lot grammar ("2 Card Lot"),
// where it is structure rather than description.
export const titleRenderFillerTokens = Object.freeze([
  "basketball",
  "football",
  "baseball",
  "hockey"
]);

/** Filler only outside the Lot grammar's opening bracket. */
export const titleRenderConditionalFiller = Object.freeze(["card", "cards"]);

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
