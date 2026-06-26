const surfaceColorTokens = Object.freeze([
  "black",
  "blue",
  "bronze",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);

const opticalParallelTokens = Object.freeze([
  "cracked ice",
  "foil",
  "fractor",
  "geometric",
  "hyper",
  "lava",
  "mojo",
  "mosaic",
  "prism",
  "prizm",
  "refractor",
  "shimmer",
  "sparkle",
  "speckle",
  "velocity",
  "wave",
  "x-fractor",
  "xfractor"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseToken(value) {
  return String(value || "").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function colorTokensIn(value) {
  const tokens = new Set(canonicalText(value).split(" ").filter(Boolean));
  return surfaceColorTokens.filter((token) => tokens.has(token));
}

export function safeSurfaceColor(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const canonical = canonicalText(text);
  if (surfaceColorTokens.includes(canonical)) return titleCaseToken(canonical);
  const colors = colorTokensIn(text);
  return colors.length === 1 ? titleCaseToken(colors[0]) : "";
}

export function looksLikeOpticalParallel(value) {
  const canonical = canonicalText(value);
  return opticalParallelTokens.some((token) => {
    const target = canonicalText(token);
    return canonical === target || canonical.includes(target);
  });
}

export function titleParallelText(resolved = {}) {
  const exact = normalizeText(resolved.parallel_exact);
  if (exact) return exact;

  const surfaceColor = safeSurfaceColor(resolved.surface_color);
  if (surfaceColor) return surfaceColor;

  const legacy = normalizeText(resolved.parallel);
  if (legacy && !looksLikeOpticalParallel(legacy)) return legacy;

  const variation = normalizeText(resolved.variation);
  if (variation && !looksLikeOpticalParallel(variation)) return variation;

  const legacyColor = safeSurfaceColor(resolved.parallel || resolved.parallel_family || resolved.variation);
  if (legacyColor) return legacyColor;

  return "";
}
