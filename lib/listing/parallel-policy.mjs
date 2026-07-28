import { attestedParallelWording } from "./catalog/field-vocabulary-store.mjs";

// A colour absent from this list is silently discarded rather than printed, so
// the list is a cap on what the system can ever say. These additions are the
// colours production actually read and then lost, counted over 2,090 cards:
// teal 9, sapphire 9, rainbow 8, holo 7, multicolor 5, holographic 5. A card
// whose colour we can name is worth more than one whose colour we drop because
// the vocabulary predates it.
const surfaceColorTokens = Object.freeze([
  "aqua",
  "black",
  "blue",
  "bronze",
  "camo",
  "copper",
  "gold",
  "green",
  "holo",
  "holographic",
  "multicolor",
  "orange",
  "pink",
  "purple",
  "rainbow",
  "red",
  "sapphire",
  "silver",
  "teal",
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

export function looksLikeOpticalParallel(value, { product = "" } = {}) {
  const canonical = canonicalText(value);
  const optical = opticalParallelTokens.some((token) => {
    const target = canonicalText(token);
    return canonical === target || canonical.includes(target);
  });
  if (!optical) return false;
  // A shiny card is not evidence of a named parallel, which is why optical
  // wording is suppressed by default. But wording the catalog has actually
  // recorded for this field is a name, not an impression: "Green Lava
  // Refractor" appears 19 times in the catalog. Attested wording is therefore
  // not a guess. Parallel wording was reaching only 52% of reviewed titles, and
  // an unavailable vocabulary attests nothing, so this can only admit terms the
  // catalog vouches for.
  //
  // Redundancy is judged against the product line: "Gold Prizm" adds nothing to
  // "Panini Prizm", and no reviewed title writes it, while "Red Wave Prizm" and
  // "Gold Shimmer" are used because their qualifier is distinctive.
  if (!attestedParallelWording(value)) return true;
  const productTokens = new Set(canonicalText(product).split(" ").filter(Boolean));
  if (!productTokens.size) return false;
  const distinctive = canonical.split(" ").filter(Boolean)
    .some((word) => !productTokens.has(word) && !surfaceColorTokens.includes(word));
  return !distinctive;
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
  if (legacy && !looksLikeOpticalParallel(legacy, { product: resolved.product })) return legacy;

  const variation = normalizeText(resolved.variation);
  if (variation && !looksLikeOpticalParallel(variation, { product: resolved.product })) return variation;

  const legacyColor = safeSurfaceColor(resolved.parallel || resolved.parallel_family || resolved.variation);
  if (legacyColor) return legacyColor;

  return "";
}

// Compose the parallel identity from what was actually observed.
//
// The `parallel` field is filled on 39 of 4,527 production cards (0.9%), while
// surface_color is read on 2,090 (46%) and serial_denominator on 2,502 (55%).
// The observation succeeds and is then never assembled into an identity, which
// is why catalog_parallels has sat empty: nothing ever had a value to write.
//
// A card that no one has ever seen still carries its colour and its print run,
// and "Silver /75" is a sellable, correct, checkable name. Withholding it until
// someone publishes the manufacturer's proper noun for that parallel is the
// detour: it makes naming wait on the market, which is the opposite of the goal.
//
// So: emit the proper name when the vocabulary attests one, and otherwise emit
// the honest descriptive form. Never invent a proper noun.
export function composeParallel(resolved = {}) {
  const exact = normalizeText(resolved.parallel_exact);
  if (exact) return { value: exact, form: "EXACT", basis: ["parallel_exact"] };

  const color = safeSurfaceColor(resolved.surface_color);
  const family = normalizeText(resolved.parallel_family);
  const denominator = String(resolved.serial_denominator ?? resolved.numbered_to ?? "").trim();

  const named = [color, family].filter(Boolean).join(" ").trim();
  const basis = [color && "surface_color", family && "parallel_family"].filter(Boolean);

  if (named && denominator) {
    return { value: `${named} /${denominator}`, form: "DESCRIPTIVE", basis: [...basis, "serial_denominator"] };
  }
  if (named) return { value: named, form: "DESCRIPTIVE", basis };
  // A bare print run is still a real distinguishing fact about the card.
  if (denominator) return { value: `/${denominator}`, form: "PRINT_RUN_ONLY", basis: ["serial_denominator"] };
  return { value: "", form: "NONE", basis: [] };
}
