// Evaluation-only bounded open evidence, carried in the SAME Luna response as
// the canonical fields.
//
// This is deliberately not imported by the production thin path. The 100-card
// exhaustive audit found useful evidence, but also wrong-role colour, career
// biography, statistics and copyright collisions. The lane therefore retains
// a small exact ledger while a deterministic resolver owns the only field
// applications. CSM/SEM and the marketplace Composer keep their existing
// contracts.

import {
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest,
  parseCanonicalFields
} from "./canonical-fields.mjs";
import { finishCanonicalTitle } from "./thin-listing-path.mjs";
import { semCatalogTrustVerdict } from "../csm/sem-definition.mjs";

export const BOUNDED_OPEN_EVIDENCE_VERSION = "bounded-open-evidence-v1";
export const BOUNDED_OPEN_EVIDENCE_MAX_ITEMS = 6;
export const BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH = 64;
export const BOUNDED_OPEN_EVIDENCE_MAX_LABEL_LENGTH = 32;

export const BOUNDED_OPEN_EVIDENCE_REGIONS = Object.freeze([
  "slab_label", "card_front", "card_back"
]);
export const BOUNDED_OPEN_EVIDENCE_CONFIDENCE = Object.freeze([
  "high", "medium", "low"
]);

const OPEN_EVIDENCE_PROPERTY = Object.freeze({
  type: "array",
  maxItems: BOUNDED_OPEN_EVIDENCE_MAX_ITEMS,
  description: "At most six commercially useful exact printed spans that do not fit confidently in the canonical fields. This is evidence only, never permission to infer or rewrite a canonical field.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["span", "region", "label", "confidence"],
    properties: {
      span: {
        type: "string",
        minLength: 1,
        maxLength: BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH,
        description: "One exact visible printed span. Preserve case, punctuation, slashes and leading zeroes; never paraphrase."
      },
      region: { type: "string", enum: [...BOUNDED_OPEN_EVIDENCE_REGIONS] },
      label: {
        type: "string",
        minLength: 1,
        maxLength: BOUNDED_OPEN_EVIDENCE_MAX_LABEL_LENGTH,
        description: "A short open-set semantic label. Do not force a CSM field name."
      },
      confidence: { type: "string", enum: [...BOUNDED_OPEN_EVIDENCE_CONFIDENCE] }
    }
  }
});

export const BOUNDED_OPEN_EVIDENCE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...CANONICAL_FIELDS_SCHEMA.required, "open_evidence"],
  properties: {
    ...CANONICAL_FIELDS_SCHEMA.properties,
    open_evidence: OPEN_EVIDENCE_PROPERTY
  }
});

export const BOUNDED_OPEN_EVIDENCE_PROMPT = [
  CANONICAL_FIELDS_PROMPT,
  "After the canonical fields, you may copy a SMALL open_evidence ledger for high-value printed facts that you can see but cannot place confidently in those fields.",
  "Evidence permission is copy-only: each span must be literal printed text anchored to slab_label, card_front or card_back. Preserve punctuation and leading zeroes. Do not infer, expand, normalize or use general card knowledge.",
  "Keep only commercially useful identity evidence such as an exact stamped serial (especially one with a leading-zero numerator), an explicit printed 1st/Jersey/Redemption mark, or an extra printed product/set/IP phrase. Do not repeat a value already present in the canonical fields.",
  "Do NOT enumerate statistics, career or biography text, copyright/legal lines, generic colours of uniforms/backgrounds/artwork, or generic layout/decorative details.",
  `Return no more than ${BOUNDED_OPEN_EVIDENCE_MAX_ITEMS} evidence rows; each span is at most ${BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH} characters and each open label at most ${BOUNDED_OPEN_EVIDENCE_MAX_LABEL_LENGTH}. Empty is correct when no high-value unknown remains.`
].join(" ");

export function buildBoundedOpenEvidenceRequest(context = {}) {
  const request = buildCanonicalFieldsRequest(context);
  request.text.format = {
    type: "json_schema",
    name: "canonical_card_fields_bounded_evidence_v1",
    strict: true,
    schema: BOUNDED_OPEN_EVIDENCE_SCHEMA
  };
  request.input[0].content[0].text = BOUNDED_OPEN_EVIDENCE_PROMPT;
  return request;
}

const exactSpan = (value) => String(value ?? "").normalize("NFC").trim();
const cleanLabel = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const labelKey = (value) => cleanLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function rawObject(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Parse without silently shortening an exact span.
 *
 * The provider schema is the first bound. This second bound protects replays
 * and hand-built fixtures: an overlong/overflow row is rejected whole and the
 * defect names its index/count. Valid rows retain the literal span unchanged.
 */
export function parseBoundedOpenEvidence(raw) {
  const parsed = rawObject(raw);
  const canonical = parseCanonicalFields(parsed ?? raw);
  const defects = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fields: canonical.fields, field_defects: canonical.defects, open_evidence: [], evidence_defects: ["open_evidence_unparseable"] };
  }
  if (parsed.open_evidence === undefined) {
    return { fields: canonical.fields, field_defects: canonical.defects, open_evidence: [], evidence_defects: [] };
  }
  if (!Array.isArray(parsed.open_evidence)) {
    return { fields: canonical.fields, field_defects: canonical.defects, open_evidence: [], evidence_defects: ["open_evidence_not_array"] };
  }
  if (parsed.open_evidence.length > BOUNDED_OPEN_EVIDENCE_MAX_ITEMS) {
    defects.push(`open_evidence_overflow:${parsed.open_evidence.length - BOUNDED_OPEN_EVIDENCE_MAX_ITEMS}`);
  }

  const open_evidence = [];
  for (const [index, row] of parsed.open_evidence.slice(0, BOUNDED_OPEN_EVIDENCE_MAX_ITEMS).entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      defects.push(`open_evidence_invalid_row:${index}`);
      continue;
    }
    const span = exactSpan(row.span);
    const label = cleanLabel(row.label);
    if (!span) { defects.push(`open_evidence_empty_span:${index}`); continue; }
    if (span.length > BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH) {
      defects.push(`open_evidence_span_too_long:${index}:${span.length}`);
      continue;
    }
    if (!label) { defects.push(`open_evidence_empty_label:${index}`); continue; }
    if (label.length > BOUNDED_OPEN_EVIDENCE_MAX_LABEL_LENGTH) {
      defects.push(`open_evidence_label_too_long:${index}:${label.length}`);
      continue;
    }
    if (!BOUNDED_OPEN_EVIDENCE_REGIONS.includes(row.region)) {
      defects.push(`open_evidence_invalid_region:${index}`);
      continue;
    }
    if (!BOUNDED_OPEN_EVIDENCE_CONFIDENCE.includes(row.confidence)) {
      defects.push(`open_evidence_invalid_confidence:${index}`);
      continue;
    }
    open_evidence.push({ span, region: row.region, label, confidence: row.confidence });
  }
  return {
    fields: canonical.fields,
    field_defects: canonical.defects,
    open_evidence,
    evidence_defects: defects
  };
}

const EXCLUDED_ROLE_LABEL = /(?:^|_)(?:stat|statistics|career|biography|copyright|legal|rights|uniform|background|artwork|decorative|generic_color|generic_colour|layout|orientation)(?:_|$)/;
const SERIAL_LABEL = /^(?:stamped_number|stamped_serial|foil_stamped_serial|serial|serial_number|print_run|limited_numbering)$/;
const PRINTED_MARK_LABEL = /^(?:printed_mark|explicit_printed_mark|component_mark|card_type_mark|special_stamp|first_mark|jersey_mark|redemption_mark)$/;
const REGISTRY_LABEL = /(?:^|_)(?:product|set|ip|franchise|game)(?:_|$)/;

function exactLeadingZeroSerial(span) {
  const match = /^(\d{1,5})\/(\d{1,5})$/.exec(span);
  if (!match) return false;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return match[1].length > 1 && match[1].startsWith("0")
    && numerator > 0 && denominator > 0 && numerator <= denominator;
}

function sameText(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function candidate(evidence, reason) {
  return { evidence, disposition: "candidate_only", field: null, reason };
}

function promoted(evidence, field, reason) {
  return { evidence, disposition: "promoted_eval_overlay", field, reason };
}

function authoritativeRegistryMatch(evidence, registry) {
  const entries = Array.isArray(registry) ? registry : registry?.entries;
  if (!Array.isArray(entries)) return { match: null, verdict: null };
  const match = entries.find((entry) => exactSpan(entry?.span) === evidence.span
    && entry?.region === evidence.region
    && labelKey(entry?.label) === labelKey(evidence.label));
  if (!match) return { match: null, verdict: null };
  const verdict = semCatalogTrustVerdict({
    sourceType: match.source_type,
    sourceTrust: match.source_trust,
    anchorAgreement: match.anchor_agreement,
    directConflicts: match.direct_conflicts,
    materialConflicts: match.material_conflicts
  });
  return { match, verdict };
}

/**
 * Resolver v1: the allow-list is intentionally much smaller than the lane.
 * Product/set/IP evidence stays candidate-only unless an exact registry entry
 * also passes CSM's existing catalog trust verdict. No colour, biography or
 * layout observation can become a field through this resolver.
 */
export function resolveBoundedOpenEvidence(fields = {}, openEvidence = [], { authoritativeRegistry = null } = {}) {
  const resolved = {
    ...fields,
    attributes: [...(fields.attributes || [])],
    components: [...(fields.components || [])],
    subjects: [...(fields.subjects || [])],
    unreadable: [...(fields.unreadable || [])],
    low_confidence: [...(fields.low_confidence || [])]
  };
  const decisions = [];

  for (const evidence of openEvidence) {
    const key = labelKey(evidence.label);
    if (EXCLUDED_ROLE_LABEL.test(key)) {
      decisions.push({ evidence, disposition: "excluded", field: null, reason: "wrong_or_low_value_role" });
      continue;
    }
    if (evidence.confidence !== "high") {
      decisions.push(candidate(evidence, "high_confidence_required"));
      continue;
    }

    if (SERIAL_LABEL.test(key)) {
      if (!exactLeadingZeroSerial(evidence.span)) {
        decisions.push(candidate(evidence, "exact_leading_zero_stamped_serial_required"));
      } else if (!resolved.serial) {
        resolved.serial = evidence.span;
        decisions.push(promoted(evidence, "serial", "exact_high_confidence_stamped_serial"));
      } else if (sameText(resolved.serial, evidence.span)) {
        decisions.push({ evidence, disposition: "already_canonical", field: "serial", reason: "same_value" });
      } else {
        decisions.push(candidate(evidence, "canonical_serial_conflict"));
      }
      continue;
    }

    if (PRINTED_MARK_LABEL.test(key)) {
      if (/^1st(?:\s+Bowman|\s+Edition)?$/i.test(evidence.span)) {
        if (!resolved.descriptive_rarity) {
          resolved.descriptive_rarity = evidence.span;
          decisions.push(promoted(evidence, "descriptive_rarity", "explicit_printed_first_mark"));
        } else if (sameText(resolved.descriptive_rarity, evidence.span)) {
          decisions.push({ evidence, disposition: "already_canonical", field: "descriptive_rarity", reason: "same_value" });
        } else decisions.push(candidate(evidence, "canonical_descriptive_rarity_conflict"));
        continue;
      }
      if (/^Jersey$/i.test(evidence.span)) {
        if (!resolved.attributes.some((value) => sameText(value, "Jersey"))) resolved.attributes.push("Jersey");
        if (!resolved.components.some((value) => sameText(value, "Jersey"))) resolved.components.push("Jersey");
        decisions.push(promoted(evidence, "components", "explicit_printed_jersey_mark"));
        continue;
      }
      if (/^Redemption(?:\s+Card)?$/i.test(evidence.span)) {
        if (!resolved.card_name) {
          resolved.card_name = evidence.span;
          decisions.push(promoted(evidence, "card_name", "explicit_printed_redemption_mark"));
        } else if (sameText(resolved.card_name, evidence.span)) {
          decisions.push({ evidence, disposition: "already_canonical", field: "card_name", reason: "same_value" });
        } else decisions.push(candidate(evidence, "canonical_card_name_conflict"));
        continue;
      }
      decisions.push(candidate(evidence, "printed_mark_not_in_v1_allowlist"));
      continue;
    }

    if (REGISTRY_LABEL.test(key)) {
      const { match, verdict } = authoritativeRegistryMatch(evidence, authoritativeRegistry);
      if (!match) {
        decisions.push(candidate(evidence, "authoritative_registry_required"));
        continue;
      }
      if (!verdict?.allowed) {
        decisions.push(candidate(evidence, `authoritative_registry_rejected:${verdict?.reason || "unknown"}`));
        continue;
      }
      const field = match.field === "ip_sport" ? "ip" : match.field;
      if (!["product", "set", "ip"].includes(field)) {
        decisions.push(candidate(evidence, "authoritative_registry_field_not_allowed"));
        continue;
      }
      const value = exactSpan(match.value || evidence.span);
      if (!value) {
        decisions.push(candidate(evidence, "authoritative_registry_value_missing"));
      } else if (!resolved[field]) {
        resolved[field] = value;
        decisions.push(promoted(evidence, field, "authoritative_registry_exact_anchor"));
      } else if (sameText(resolved[field], value)) {
        decisions.push({ evidence, disposition: "already_canonical", field, reason: "same_value" });
      } else {
        decisions.push(candidate(evidence, `canonical_${field}_conflict`));
      }
      continue;
    }
    decisions.push(candidate(evidence, "no_v1_promotion_rule"));
  }
  return { fields: resolved, decisions, resolver_version: BOUNDED_OPEN_EVIDENCE_VERSION };
}

/** One-call treatment finisher for the offline paired harness only. */
export function finishBoundedOpenEvidenceTitle(payload, options = {}) {
  const parsed = parseBoundedOpenEvidence(payload);
  const resolution = resolveBoundedOpenEvidence(parsed.fields, parsed.open_evidence);
  const finished = finishCanonicalTitle(resolution.fields, options);
  return {
    ...finished,
    raw_length: typeof payload === "string" ? payload.length : JSON.stringify(payload ?? {}).length,
    field_defects: [...new Set([...(parsed.field_defects || []), ...(finished.field_defects || [])])],
    canonical_fields_before_evidence: parsed.fields,
    open_evidence: parsed.open_evidence,
    evidence_defects: parsed.evidence_defects,
    evidence_resolution: resolution.decisions,
    evidence_resolver_version: resolution.resolver_version,
    production_promoted: false
  };
}
