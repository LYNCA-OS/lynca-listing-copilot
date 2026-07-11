const minimumDirectSlabConfidence = 0.86;

const colorTokens = Object.freeze(new Map([
  ["AQUA", "Aqua"],
  ["BLACK", "Black"],
  ["BLUE", "Blue"],
  ["BRONZE", "Bronze"],
  ["BROWN", "Brown"],
  ["GOLD", "Gold"],
  ["GREEN", "Green"],
  ["NEON", "Neon"],
  ["ORANGE", "Orange"],
  ["PINK", "Pink"],
  ["PURPLE", "Purple"],
  ["RAINBOW", "Rainbow"],
  ["RED", "Red"],
  ["SILVER", "Silver"],
  ["TEAL", "Teal"],
  ["VIOLET", "Violet"],
  ["WHITE", "White"],
  ["YELLOW", "Yellow"]
]));

const finishTokens = Object.freeze(new Map([
  ["ATOMIC", "Atomic"],
  ["CRACKED", "Cracked"],
  ["DISCO", "Disco"],
  ["FOIL", "Foil"],
  ["HOLO", "Holo"],
  ["HYPER", "Hyper"],
  ["ICE", "Ice"],
  ["INTERNATIONAL", "International"],
  ["LAVA", "Lava"],
  ["MOJO", "Mojo"],
  ["PRISM", "Prism"],
  ["PRIZM", "Prizm"],
  ["PULSAR", "Pulsar"],
  ["REF", "Refractor"],
  ["REFRACTOR", "Refractor"],
  ["REFRACTORS", "Refractor"],
  ["SAPPHIRE", "Sapphire"],
  ["SCOPE", "Scope"],
  ["SHIMMER", "Shimmer"],
  ["SPARKLE", "Sparkle"],
  ["SPECKLE", "Speckle"],
  ["STRIPE", "Stripe"],
  ["TIGER", "Tiger"],
  ["VINYL", "Vinyl"],
  ["WAVE", "Wave"],
  ["X-FRACTOR", "X-Fractor"],
  ["XFRACTOR", "X-Fractor"],
  ["ZEBRA", "Zebra"]
]));

function normalizeText(value) {
  return String(value ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function cropTypeForPatch(patch = {}) {
  return normalizeText(patch?.provenance?.crop_type || patch?.crop_type).toLowerCase();
}

function directSlabPatch(patch = {}) {
  const cropType = cropTypeForPatch(patch);
  return normalizeText(patch.source_type).toUpperCase() === "OCR"
    && ["grade_label", "grade_label_crop"].includes(cropType)
    && Number(patch.confidence || 0) >= minimumDirectSlabConfidence
    && normalizeText(patch.raw_text);
}

function normalizeParallelSuffix(value = "") {
  const rawTokens = normalizeText(value)
    .replace(/[.,;:]+$/g, "")
    .replace(/\bREF\.(?=\s|$)/gi, "REF")
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Z0-9]+|[^A-Z0-9-]+$/gi, ""))
    .filter(Boolean);
  if (!rawTokens.length || rawTokens.length > 5) return null;

  let hasSemanticToken = false;
  let surfaceColor = null;
  const normalizedTokens = [];
  for (const rawToken of rawTokens) {
    const key = rawToken.toUpperCase();
    if (colorTokens.has(key)) {
      surfaceColor ||= colorTokens.get(key);
      normalizedTokens.push(colorTokens.get(key));
      hasSemanticToken = true;
      continue;
    }
    if (finishTokens.has(key)) {
      normalizedTokens.push(finishTokens.get(key));
      hasSemanticToken = true;
      continue;
    }
    return null;
  }
  if (!hasSemanticToken) return null;
  return {
    parallel_exact: [...new Set(normalizedTokens)].join(" "),
    surface_color: surfaceColor
  };
}

function normalizeParallelPrefix(value = "") {
  const tokens = normalizeText(value)
    .replace(/\bREF\.(?=\s|$)/gi, "REF")
    .split(/\s+/)
    .filter(Boolean);
  let longest = null;
  for (let length = 1; length <= Math.min(5, tokens.length); length += 1) {
    const normalized = normalizeParallelSuffix(tokens.slice(0, length).join(" "));
    if (!normalized) break;
    longest = normalized;
  }
  return longest;
}

function candidatesFromRawText(rawText = "") {
  const lines = normalizeText(rawText)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    const separator = line.match(/\s[-–—]\s(.+)$/);
    if (!separator) continue;
    const normalized = normalizeParallelSuffix(separator[1]);
    if (normalized?.parallel_exact) candidates.push(normalized);
  }

  // OCR commonly flattens a slab label into one line and removes whitespace
  // around the field separator, for example:
  // `SPLTNG.IMG-BLACK SCOPE 10 PSA 65992325`. Only parse a semantic prefix
  // after an explicit label descriptor; never scan arbitrary card text for a
  // color/finish token. The known-token parser stops before grade/cert text.
  const flattened = lines.join(" ");
  const descriptor = /\b(?:(?:[A-Z0-9]{1,16}\s*\.)+[A-Z0-9]{1,16}|PARALLEL(?:\s+NAME)?)\s*[-–—:]\s*/gi;
  for (const match of flattened.matchAll(descriptor)) {
    const normalized = normalizeParallelPrefix(flattened.slice((match.index || 0) + match[0].length));
    if (normalized?.parallel_exact) candidates.push(normalized);
  }

  return [...new Map(candidates.map((candidate) => [candidate.parallel_exact.toUpperCase(), candidate])).values()];
}

export function extractDirectSlabLabelParallel(patches = []) {
  const values = new Map();
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!directSlabPatch(patch)) continue;
    for (const candidate of candidatesFromRawText(patch.raw_text)) {
      const key = candidate.parallel_exact.toUpperCase();
      const existing = values.get(key);
      const confidence = Number(patch.confidence || 0);
      if (existing && existing.confidence >= confidence) continue;
      values.set(key, {
        ...candidate,
        confidence,
        raw_text: normalizeText(patch.raw_text),
        source_image_id: patch.source_image_id || null,
        crop_id: patch.crop_id || null
      });
    }
  }
  const candidates = [...values.values()].sort((left, right) => right.confidence - left.confidence);
  return {
    verified: candidates.length === 1,
    conflict: candidates.length > 1,
    value: candidates.length === 1 ? candidates[0].parallel_exact : null,
    surface_color: candidates.length === 1 ? candidates[0].surface_color : null,
    confidence: candidates.length === 1 ? candidates[0].confidence : 0,
    raw_text: candidates.length === 1 ? candidates[0].raw_text : null,
    source_image_id: candidates.length === 1 ? candidates[0].source_image_id : null,
    crop_id: candidates.length === 1 ? candidates[0].crop_id : null,
    candidate_count: candidates.length,
    candidates
  };
}

export { minimumDirectSlabConfidence };
