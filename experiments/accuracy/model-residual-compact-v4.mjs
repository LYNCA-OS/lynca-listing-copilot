// Evaluation-only compression candidates for the residual-v3 evidence lane.
// These selectors inspect model output only. They never read labels, mutate
// canonical fields, persist evidence, or authorize a Production title.

export const MODEL_RESIDUAL_COMPACT_V4 = "model-residual-compact-v4";
export const COMPACT_RESIDUAL_MODES_V4 = Object.freeze([
  "single_printed_phrase",
  "ranked_max1",
  "ranked_max2",
  "explicit_short_fields"
]);

const PRINTED_RARITY_MARKER = /^(?:1st\s+Bowman|1st\s+Edition|SP|SSP)$/i;
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const clone = (value) => structuredClone(value ?? {});

export const MODEL_RESIDUAL_RANKED_ITEM_SCHEMA_V4 = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["text", "role", "region", "basis"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 64 },
    role: { type: "string", enum: ["rarity_marker", "finish_phrase", "identity_phrase"] },
    region: { type: "string", enum: ["slab_label", "card_front", "card_back", "front_symbol"] },
    basis: { type: "string", const: "printed_text" }
  }
});

export const MODEL_RESIDUAL_EXPLICIT_SHORT_FIELDS_SCHEMA_V4 = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["rarity_marker", "slab_finish"],
  properties: {
    rarity_marker: {
      type: ["string", "null"],
      enum: ["1st Bowman", "1st Edition", "SP", "SSP", null],
      description: "Exact printed rarity marker missing from the canonical values; otherwise null."
    },
    slab_finish: {
      type: ["string", "null"],
      maxLength: 64,
      description: "One exact finish phrase printed on a slab label and missing from canonical values; otherwise null."
    }
  }
});

export const MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4 = Object.freeze({
  type: ["string", "null"],
  maxLength: 64,
  description: "One complete exact phrase printed in the supplied images but missing from canonical values. Priority: rarity marker, explicit finish, compatible Product extension, then another marketplace-worthy phrase; otherwise null."
});

const PRINTED_FINISH_FAMILY = /\b(?:refractor|prizm|prism|wave|mojo|shimmer|foil|holo|sparkle|speckle|vinyl|pulsar|raywave|parallel|cracked|ice|shock|geometric)\b/i;

function rankCandidate(row) {
  if (row?.basis !== "printed_text") return 0;
  if (PRINTED_RARITY_MARKER.test(clean(row.text))) return 1_000;
  if (row.role === "finish_phrase" && row.region === "slab_label") return 900;
  if (row.role === "finish_phrase") return 800;
  if (row.role === "commercial_marker") return 500;
  if (row.role === "identity_phrase"
    && ["slab_label", "card_front", "front_symbol"].includes(row.region)) return 400;
  if (row.role === "identity_phrase") return 300;
  if (row.role === "other_visible") return 200;
  if (row.role === "exact_code") return 100;
  return 0;
}

export function rankModelResidualCandidatesV4(candidates = []) {
  if (!Array.isArray(candidates)) return [];
  return candidates.map((candidate, sourceIndex) => ({
    candidate: clone(candidate),
    source_index: sourceIndex,
    score: rankCandidate(candidate)
  })).filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.source_index - right.source_index)
    .map(({ candidate }) => candidate);
}

export function selectRankedModelResidualCandidatesV4(candidates = [], { maxItems = 1 } = {}) {
  if (![1, 2].includes(maxItems)) throw new RangeError("compact_v4_max_items_must_be_1_or_2");
  return rankModelResidualCandidatesV4(candidates).slice(0, maxItems);
}

function normalizePrintedMarker(value) {
  const marker = clean(value);
  if (!PRINTED_RARITY_MARKER.test(marker)) return null;
  if (/^1st\s+Bowman$/i.test(marker)) return "1st Bowman";
  if (/^1st\s+Edition$/i.test(marker)) return "1st Edition";
  return marker.toUpperCase();
}

export function projectModelResidualExplicitShortFieldsV4(candidates = []) {
  const ranked = rankModelResidualCandidatesV4(candidates);
  const marker = ranked.find((row) => normalizePrintedMarker(row.text));
  const finish = ranked.find((row) => row.basis === "printed_text"
    && row.role === "finish_phrase" && row.region === "slab_label");
  return {
    rarity_marker: marker ? normalizePrintedMarker(marker.text) : null,
    slab_finish: finish ? clean(finish.text) : null
  };
}

export function projectModelResidualSinglePrintedPhraseV4(candidates = [], {
  canonicalFields = {}
} = {}) {
  const ranked = rankModelResidualCandidatesV4(candidates);
  const marker = ranked.find((row) => normalizePrintedMarker(row.text));
  const finish = ranked.find((row) => row.basis === "printed_text" && row.role === "finish_phrase");
  const productExtension = ranked.find((row) => row.basis === "printed_text"
    && strictIdentityExtension(row.text, canonicalFields));
  return clean((marker || finish || productExtension || ranked[0])?.text) || null;
}

export function inflateModelResidualExplicitShortFieldsV4(fields = {}) {
  const rows = [];
  const marker = normalizePrintedMarker(fields?.rarity_marker);
  if (marker) rows.push({
    text: marker,
    role: "identity_phrase",
    region: "card_front",
    basis: "printed_text"
  });
  const finish = clean(fields?.slab_finish);
  if (finish) rows.push({
    text: finish,
    role: "finish_phrase",
    region: "slab_label",
    basis: "printed_text"
  });
  return rows;
}

function textTokenSet(value) {
  return new Set(clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+/g) || []);
}

function strictIdentityExtension(phrase, canonicalFields = {}) {
  const candidate = textTokenSet(phrase);
  const product = textTokenSet(canonicalFields.product);
  if (!product.size || candidate.size <= product.size) return false;
  return [...product].every((token) => candidate.has(token));
}

function textOutsideCanonicalProduct(phrase, canonicalFields = {}) {
  const product = clean(canonicalFields.product);
  if (!product) return clean(phrase);
  const pattern = product.split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return clean(phrase).replace(new RegExp(`(?:^|\\s)${pattern}(?=$|\\s)`, "i"), " ");
}

export function inferModelResidualSinglePrintedPhraseRouteV4(value, {
  canonicalFields = {}
} = {}) {
  const text = clean(value);
  if (!text) return { text: "", route: "empty", ambiguous: false, candidate: null };
  const marker = normalizePrintedMarker(text);
  // A finish word embedded inside the exact canonical Product phrase is
  // identity text, not an explicit finish claim (for example Product=`Prizm
  // Baseball` inside `2018 Panini Prizm Baseball`).
  const finish = PRINTED_FINISH_FAMILY.test(textOutsideCanonicalProduct(text, canonicalFields));
  // An exact closed marker is already a complete semantic phrase. `1st Bowman`
  // may also be a token superset of Product=`Bowman`, but treating that as two
  // roles would be lexical double counting, not genuine ambiguity.
  const productExtension = !marker && strictIdentityExtension(text, canonicalFields);
  const routes = [marker && "marker", finish && "finish", productExtension && "product_extension"]
    .filter(Boolean);
  if (routes.length > 1) {
    return { text, route: "ambiguous", ambiguous: true, candidate: {
      text, role: "other_visible", region: "card_front", basis: "printed_text"
    } };
  }
  const route = routes[0] || "other_visible";
  const role = route === "finish" ? "finish_phrase"
    : ["marker", "product_extension"].includes(route) ? "identity_phrase" : "other_visible";
  const region = route === "finish" && /^AUTO[-\s]/i.test(text) ? "slab_label"
    : route === "marker" ? "front_symbol" : "card_front";
  return { text, route, ambiguous: false, candidate: { text, role, region, basis: "printed_text" } };
}

export function inflateModelResidualSinglePrintedPhraseV4(value, options = {}) {
  const inferred = inferModelResidualSinglePrintedPhraseRouteV4(value, options);
  return inferred.candidate ? [inferred.candidate] : [];
}

export function compactModelResidualCandidatesV4(candidates = [], { mode, canonicalFields = {} } = {}) {
  if (mode === "single_printed_phrase") return inflateModelResidualSinglePrintedPhraseV4(
    projectModelResidualSinglePrintedPhraseV4(candidates, { canonicalFields }), { canonicalFields }
  );
  if (mode === "ranked_max1") return selectRankedModelResidualCandidatesV4(candidates,
    { maxItems: 1 });
  if (mode === "ranked_max2") return selectRankedModelResidualCandidatesV4(candidates,
    { maxItems: 2 });
  if (mode === "explicit_short_fields") return inflateModelResidualExplicitShortFieldsV4(
    projectModelResidualExplicitShortFieldsV4(candidates)
  );
  throw new TypeError(`compact_v4_mode_invalid:${mode || "missing"}`);
}

export function serializeModelResidualCompactV4(candidates = [], { mode, canonicalFields = {} } = {}) {
  if (mode === "single_printed_phrase") {
    return JSON.stringify({
      residual_printed_phrase: projectModelResidualSinglePrintedPhraseV4(candidates,
        { canonicalFields })
    });
  }
  if (mode === "explicit_short_fields") {
    return JSON.stringify(projectModelResidualExplicitShortFieldsV4(candidates));
  }
  const maxItems = mode === "ranked_max1" ? 1 : mode === "ranked_max2" ? 2 : null;
  if (!maxItems) throw new TypeError(`compact_v4_mode_invalid:${mode || "missing"}`);
  const titleEvidence = selectRankedModelResidualCandidatesV4(candidates, { maxItems })
    .map(({ text, role, region, basis }) => ({ text, role, region, basis }));
  return JSON.stringify({ title_evidence: titleEvidence });
}
