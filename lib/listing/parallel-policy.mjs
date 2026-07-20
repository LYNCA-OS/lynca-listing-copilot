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

const surfaceColorModifiers = new Set([
  "bright",
  "dark",
  "deep",
  "light",
  "neon"
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
  const canonicalTokens = canonical.split(" ").filter(Boolean);
  if (canonicalTokens.length === 2
    && surfaceColorModifiers.has(canonicalTokens[0])
    && surfaceColorTokens.includes(canonicalTokens[1])) {
    return titleCaseToken(canonical);
  }
  const colors = colorTokensIn(text);
  return colors.length === 1 ? titleCaseToken(colors[0]) : "";
}

// Decompose a raw parallel/surface phrase into its optical finish family.
// Providers read finishes as one phrase ("Gold Refractor", "Blue Sparkle
// Refractor", "Cracked Ice"); the color belongs in surface_color and the
// finish words belong in parallel_family, but historically the finish half
// was simply dropped by safeSurfaceColor. Matching is restricted to the
// curated opticalParallelTokens vocabulary (word-wise, preserving original
// order, bigrams like "cracked ice" included) so arbitrary provider prose can
// never leak into the title through this path.
export function extractParallelFamily(...values) {
  for (const value of values) {
    const canonical = canonicalText(value);
    if (!canonical) continue;
    const words = canonical.split(" ").filter(Boolean);
    const matched = [];
    for (let index = 0; index < words.length; index += 1) {
      const bigram = index + 1 < words.length ? `${words[index]} ${words[index + 1]}` : "";
      if (bigram && opticalParallelTokens.includes(bigram)) {
        matched.push(bigram);
        index += 1;
        continue;
      }
      const word = words[index];
      if (opticalParallelTokens.some((token) => !token.includes(" ") && (word === token || word.includes(token)))) {
        matched.push(word);
      }
    }
    if (matched.length) return matched.map(titleCaseToken).join(" ");
  }
  return "";
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
  const family = normalizeText(resolved.parallel_family);
  if (surfaceColor && family) return `${surfaceColor} ${family}`;
  if (surfaceColor) return surfaceColor;
  if (family) return family;

  const legacy = normalizeText(resolved.parallel);
  if (legacy && !looksLikeOpticalParallel(legacy)) return legacy;

  const variation = normalizeText(resolved.variation);
  if (variation && !looksLikeOpticalParallel(variation)) return variation;

  const legacyColor = safeSurfaceColor(resolved.parallel || resolved.parallel_family || resolved.variation);
  if (legacyColor) return legacyColor;

  return "";
}
