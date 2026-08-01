// Evaluation-only one-call treatment: canonical CSM/SEM fields plus a small,
// append-only ledger of exact image evidence. Nothing in this module is
// imported by the production thin path and no evidence row can mutate a
// canonical field.

import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest,
  parseCanonicalFields
} from "./canonical-fields.mjs";
import { finishCanonicalTitle } from "./thin-listing-path.mjs";
import {
  classifySemNumberBoundary,
  classifySemTerm
} from "../csm/sem-definition.mjs";

export const BOUNDED_EVIDENCE_V2_VERSION = "bounded-evidence-v2";
export const BOUNDED_EVIDENCE_V2_SCHEMA_NAME = "canonical_card_fields_bounded_evidence_v2";
// high100's per-card helpful schema-compression occurrences are
// max=4 / p95=2 (47 zero, 39 one, 9 two, 4 three, 1 four). Eight is therefore
// 2x the observed maximum for headroom, while remaining far below exhaustive's
// measured 13.83x output-token amplification.
export const BOUNDED_EVIDENCE_V2_MAX_ITEMS = 8;
export const BOUNDED_EVIDENCE_V2_MAX_TEXT_LENGTH = 96;
export const BOUNDED_EVIDENCE_V2_MAX_ROLE_LENGTH = 40;

export const BOUNDED_EVIDENCE_V2_IMAGES = Object.freeze(["image_1", "image_2"]);
export const BOUNDED_EVIDENCE_V2_REGIONS = Object.freeze([
  "slab_label", "card_front", "card_back", "holder_or_sticker", "unknown"
]);
export const BOUNDED_EVIDENCE_V2_SOURCES = Object.freeze([
  "printed_text", "stamped_text", "slab_label_text", "symbol_or_logo", "visual_property"
]);
export const BOUNDED_EVIDENCE_V2_UNCERTAINTY = Object.freeze([
  "none", "reading_uncertain", "semantic_role_uncertain", "visual_inference"
]);

const EVIDENCE_ROW_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["exact_text", "image", "region", "source", "advisory_role", "uncertainty"],
  properties: {
    exact_text: {
      type: "string",
      minLength: 1,
      maxLength: BOUNDED_EVIDENCE_V2_MAX_TEXT_LENGTH,
      description: "Literal text or concise literal visual phrase from the image. Preserve case, punctuation, slashes and leading zeroes; never normalize or expand it."
    },
    image: { type: "string", enum: [...BOUNDED_EVIDENCE_V2_IMAGES] },
    region: { type: "string", enum: [...BOUNDED_EVIDENCE_V2_REGIONS] },
    source: { type: "string", enum: [...BOUNDED_EVIDENCE_V2_SOURCES] },
    advisory_role: {
      type: "string",
      minLength: 1,
      maxLength: BOUNDED_EVIDENCE_V2_MAX_ROLE_LENGTH,
      description: "Open-set model suggestion only. It is never authority to choose or overwrite a canonical field."
    },
    uncertainty: { type: "string", enum: [...BOUNDED_EVIDENCE_V2_UNCERTAINTY] }
  }
});

export const BOUNDED_EVIDENCE_V2_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...CANONICAL_FIELDS_SCHEMA.required, "evidence_spans"],
  properties: {
    ...CANONICAL_FIELDS_SCHEMA.properties,
    evidence_spans: {
      type: "array",
      maxItems: BOUNDED_EVIDENCE_V2_MAX_ITEMS,
      items: EVIDENCE_ROW_SCHEMA,
      description: "A bounded append-only ledger of exact high-value evidence not safely represented by the canonical fields. Empty is valid."
    }
  }
});

export const BOUNDED_EVIDENCE_V2_PROMPT = [
  CANONICAL_FIELDS_PROMPT,
  "After the canonical fields, preserve a SMALL evidence_spans ledger for exact high-value facts you saw but could not safely type or fully retain.",
  "Every row is copy-only: keep exact_text verbatim, identify image and region, state whether its source is printed, stamped, slab-label, logo/symbol, or visual, and expose uncertainty.",
  "advisory_role is only your suggestion. It never selects a canonical field and must not cause you to rewrite one.",
  "Prioritize exact slab product/set/IP phrases, leading-zero stamped numbering, explicit 1st/Jersey/Redemption marks, and short rarity wording.",
  "A stamped current-copy serial is evidence for rendering only; do not use the ledger to set or overwrite fields.serial.",
  "Copyright years, colours, patterns, and any *-style finish description are candidates only. Preserve them only when commercially relevant and mark uncertainty honestly.",
  "Do not enumerate statistics, season tables, biographies, career prose, legal boilerplate, layout descriptions, uniforms, backgrounds, or repeated front/back text. Keep at most one concise copyright-year span.",
  `Return at most ${BOUNDED_EVIDENCE_V2_MAX_ITEMS} unique rows. Empty is better than noise.`
].join(" ");

export function buildBoundedEvidenceV2Request(context = {}) {
  const request = buildCanonicalFieldsRequest(context);
  request.text.format = {
    type: "json_schema",
    name: BOUNDED_EVIDENCE_V2_SCHEMA_NAME,
    strict: true,
    schema: BOUNDED_EVIDENCE_V2_SCHEMA
  };
  request.input[0].content[0].text = BOUNDED_EVIDENCE_V2_PROMPT;
  return request;
}

const exactText = (value) => String(value ?? "").normalize("NFC").trim();
const cleanRole = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const normalizedEvidenceKey = (value) => exactText(value).toLowerCase().replace(/\s+/g, " ");

function rawObject(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

const STAT_OR_BIOGRAPHY_NOISE = /\b(?:career|born|college|drafted|height|weight|statistics?|season\s+(?:record|average)|games?|points?|rebounds?|assists?|innings?|yards?)\b/i;
const TABLE_NOISE = /^(?:yr|year|club|team|g|gp|mpg|fg%|ft%|reb|ast|stl|blk|pts|avg)(?:\s+(?:yr|year|club|team|g|gp|mpg|fg%|ft%|reb|ast|stl|blk|pts|avg))*$/i;
const LEGAL_NOISE = /\b(?:all rights reserved|trademark|patent|licensed by|terms and conditions)\b/i;
const COPYRIGHT = /(?:©|\bcopyright\b)/i;
const COPYRIGHT_YEAR = /(?:©|\bcopyright\b)[^0-9]{0,12}(?:19|20)\d{2}/i;
const VISUAL_CANDIDATE = /\b(?:red|blue|green|gold|silver|orange|purple|pink|black|white|yellow|teal|aqua|rainbow|pattern|border|geometric|sparkle|shimmer|refractor-style|prizm-style|foil-style|holo-style)\b/i;

function evidenceDisposition(row, fields) {
  const number = classifySemNumberBoundary(row.exact_text, {
    grammar: fields?.grammar,
    field: "serial"
  });
  const serial = serialFraction(row.exact_text);
  // A current-copy renderer overlay requires an actual stamped fraction. Plain
  // printed slash numbers are often TCG checklist codes (089/063), while zero or
  // numerator>denominator values cannot be a physical copy within a print run.
  if (number.boundary === "NUMERICAL_RARITY"
      && serial?.validCurrentCopy === true
      && row.source === "stamped_text") {
    const sem = classifySemTerm("serial_number");
    return {
      disposition: "current_copy_renderer_evidence",
      candidate_field: sem.canonical_field,
      promotion_allowed: false,
      reason: sem.reason
    };
  }
  if (COPYRIGHT_YEAR.test(row.exact_text)) {
    return {
      disposition: "candidate_only",
      candidate_field: "year",
      promotion_allowed: false,
      reason: "copyright_year_does_not_establish_release_year"
    };
  }
  if (TABLE_NOISE.test(row.exact_text) || STAT_OR_BIOGRAPHY_NOISE.test(row.exact_text)) {
    return { disposition: "excluded_noise", candidate_field: null, promotion_allowed: false, reason: "statistics_or_biography" };
  }
  if (LEGAL_NOISE.test(row.exact_text) || COPYRIGHT.test(row.exact_text)) {
    return { disposition: "excluded_noise", candidate_field: null, promotion_allowed: false, reason: "legal_or_copyright_noise" };
  }
  if (row.source === "visual_property"
      || row.uncertainty === "visual_inference"
      || VISUAL_CANDIDATE.test(row.exact_text)) {
    return { disposition: "candidate_only", candidate_field: "print_finish", promotion_allowed: false, reason: "visual_finish_requires_external_constraint" };
  }
  return {
    disposition: "append_only_evidence",
    candidate_field: null,
    promotion_allowed: false,
    reason: "advisory_role_is_not_semantic_authority"
  };
}

export function parseBoundedEvidenceV2(raw) {
  const parsed = rawObject(raw);
  const canonical = parseCanonicalFields(parsed ?? raw);
  const defects = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      fields: canonical.fields,
      field_defects: canonical.defects,
      evidence_spans: [],
      evidence_candidates: [],
      evidence_noise_dropped: [],
      evidence_defects: ["evidence_v2_unparseable"]
    };
  }
  const source = parsed.evidence_spans;
  if (source === undefined) {
    return {
      fields: canonical.fields,
      field_defects: canonical.defects,
      evidence_spans: [], evidence_candidates: [], evidence_noise_dropped: [], evidence_defects: []
    };
  }
  if (!Array.isArray(source)) {
    return {
      fields: canonical.fields,
      field_defects: canonical.defects,
      evidence_spans: [], evidence_candidates: [], evidence_noise_dropped: [],
      evidence_defects: ["evidence_v2_not_array"]
    };
  }
  if (source.length > BOUNDED_EVIDENCE_V2_MAX_ITEMS) {
    defects.push(`evidence_v2_overflow:${source.length - BOUNDED_EVIDENCE_V2_MAX_ITEMS}`);
  }

  const evidence_spans = [];
  const evidence_candidates = [];
  const evidence_noise_dropped = [];
  const seen = new Set();
  let copyrightYearSeen = false;
  for (const [index, rawRow] of source.slice(0, BOUNDED_EVIDENCE_V2_MAX_ITEMS).entries()) {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      defects.push(`evidence_v2_invalid_row:${index}`);
      continue;
    }
    const row = {
      exact_text: exactText(rawRow.exact_text),
      image: rawRow.image,
      region: rawRow.region,
      source: rawRow.source,
      advisory_role: cleanRole(rawRow.advisory_role),
      uncertainty: rawRow.uncertainty
    };
    if (!row.exact_text || row.exact_text.length > BOUNDED_EVIDENCE_V2_MAX_TEXT_LENGTH) {
      defects.push(`evidence_v2_invalid_exact_text:${index}`);
      continue;
    }
    if (!row.advisory_role || row.advisory_role.length > BOUNDED_EVIDENCE_V2_MAX_ROLE_LENGTH) {
      defects.push(`evidence_v2_invalid_advisory_role:${index}`);
      continue;
    }
    for (const [name, allowed] of [
      ["image", BOUNDED_EVIDENCE_V2_IMAGES],
      ["region", BOUNDED_EVIDENCE_V2_REGIONS],
      ["source", BOUNDED_EVIDENCE_V2_SOURCES],
      ["uncertainty", BOUNDED_EVIDENCE_V2_UNCERTAINTY]
    ]) {
      if (!allowed.includes(row[name])) defects.push(`evidence_v2_invalid_${name}:${index}`);
    }
    if (defects.some((value) => value.endsWith(`:${index}`))) continue;
    const duplicateKey = normalizedEvidenceKey(row.exact_text);
    if (seen.has(duplicateKey)) {
      evidence_noise_dropped.push({ ...row, reason: "duplicate_exact_text" });
      continue;
    }
    seen.add(duplicateKey);
    const disposition = evidenceDisposition(row, canonical.fields);
    const retained = { ...row, ...disposition };
    if (disposition.candidate_field === "year" && COPYRIGHT_YEAR.test(row.exact_text)) {
      if (copyrightYearSeen) {
        evidence_noise_dropped.push({ ...retained, reason: "duplicate_copyright_year_candidate" });
        continue;
      }
      copyrightYearSeen = true;
    }
    if (disposition.disposition === "excluded_noise") evidence_noise_dropped.push(retained);
    else {
      evidence_spans.push(retained);
      if (disposition.disposition === "candidate_only") evidence_candidates.push(retained);
    }
  }
  return {
    fields: canonical.fields,
    field_defects: canonical.defects,
    evidence_spans,
    evidence_candidates,
    evidence_noise_dropped,
    evidence_defects: defects
  };
}

function sameText(left, right) {
  return exactText(left).toLowerCase() === exactText(right).toLowerCase();
}

function addUnique(values, value) {
  return values.some((item) => sameText(item, value)) ? values : [...values, value];
}

function serialFraction(value) {
  const match = exactText(value).replace(/\s*\/\s*/g, "/").match(/^(\d{1,5})\/(\d{1,5})$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return {
    normalized: [String(numerator), String(denominator)],
    validCurrentCopy: numerator >= 1 && denominator >= 1 && numerator <= denominator
  };
}

function sameSerialFraction(left, right) {
  const leftParts = serialFraction(left);
  const rightParts = serialFraction(right);
  return Boolean(leftParts && rightParts
    && leftParts.normalized[0] === rightParts.normalized[0]
    && leftParts.normalized[1] === rightParts.normalized[1]);
}

/**
 * Minimal evaluation resolver. It ignores advisory_role entirely and only
 * accepts an unambiguous literal mark from printed/stamped/slab text. The
 * canonical object is never mutated: Composer receives a temporary overlay,
 * and exact current-copy serial evidence replaces only that renderer overlay.
 */
export function resolveBoundedEvidenceV2ForEvaluation(fields = {}, evidenceSpans = [], options = {}) {
  const overlay = {
    ...fields,
    attributes: [...(fields.attributes || [])],
    components: [...(fields.components || [])]
  };
  const promotions = [];
  let rendererSerialResolved = false;
  for (const evidence of evidenceSpans) {
    const exact = evidence.exact_text;
    const sourceAnchored = evidence.source !== "visual_property"
      && evidence.uncertainty === "none";
    if (!sourceAnchored) continue;
    if (evidence.disposition === "current_copy_renderer_evidence") {
      if (rendererSerialResolved) continue;
      rendererSerialResolved = true;
      const canonicalSerial = exactText(fields.serial);
      if (canonicalSerial && !sameSerialFraction(canonicalSerial, exact)) {
        promotions.push({
          exact_text: exact,
          target: "current_copy_renderer",
          canonical_field_written: null,
          reason: "sem_serial_evidence_renderer_only",
          blocked: "conflict",
          canonical_serial: canonicalSerial
        });
        continue;
      }
      // Replace only in the temporary renderer overlay. This preserves exact
      // leading zeroes while applying only Composer's slash-spacing rule; the
      // evidence ledger itself retains the raw exact_text unchanged.
      overlay.serial = exact.replace(/\s*\/\s*/g, "/");
      promotions.push({
        exact_text: exact,
        target: "current_copy_renderer",
        canonical_field_written: null,
        reason: "sem_serial_evidence_renderer_only"
      });
      continue;
    }
    if (/^1st(?:\s+Bowman|\s+Edition)?$/i.test(exact)) {
      if (!overlay.descriptive_rarity || sameText(overlay.descriptive_rarity, exact)) {
        overlay.descriptive_rarity = exact;
        promotions.push({
          exact_text: exact,
          target: "descriptive_rarity",
          canonical_field_written: "evaluation_overlay_only",
          reason: "literal_first_mark"
        });
      }
      continue;
    }
    if (/^Jersey$/i.test(exact)) {
      overlay.attributes = addUnique(overlay.attributes, "Jersey");
      overlay.components = addUnique(overlay.components, "Jersey");
      promotions.push({
        exact_text: exact,
        target: "observable_components",
        canonical_field_written: "evaluation_overlay_only",
        reason: "literal_jersey_mark"
      });
    }
  }
  const composed = finishCanonicalTitle(overlay, options);
  const title = composed.title;
  return {
    ...composed,
    title,
    length: title.length,
    promotions,
    overlay_fields: overlay
  };
}

/** Evidence never mutates the returned canonical fields; v2 emits both titles. */
export function finishBoundedEvidenceV2Title(payload, options = {}) {
  const parsed = parseBoundedEvidenceV2(payload);
  const canonical = finishCanonicalTitle(parsed.fields, options);
  const candidate = resolveBoundedEvidenceV2ForEvaluation(parsed.fields, parsed.evidence_spans, options);
  return {
    ...candidate,
    fields: canonical.fields,
    raw_length: typeof payload === "string" ? payload.length : JSON.stringify(payload ?? {}).length,
    field_defects: [...new Set([...(parsed.field_defects || []), ...(canonical.field_defects || [])])],
    canonical_fields_before_evidence: parsed.fields,
    canonical_control_title: canonical.title,
    canonical_control_length: canonical.length,
    evidence_schema_version: BOUNDED_EVIDENCE_V2_VERSION,
    evidence_spans: parsed.evidence_spans,
    evidence_candidates: parsed.evidence_candidates,
    evidence_noise_dropped: parsed.evidence_noise_dropped,
    evidence_defects: parsed.evidence_defects,
    evidence_promotions: candidate.promotions,
    production_promoted: false
  };
}
