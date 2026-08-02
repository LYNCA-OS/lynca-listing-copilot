// Evaluation-only, same-response residual candidate lane.
//
// This module is intentionally not imported by the production thin path. It
// can add one bounded property to an existing canonical request, then parse
// that property without granting it CSM, Composer, or persistence authority.

import { createHash } from "node:crypto";

import { classifySemNumberBoundary } from "../csm/sem-definition.mjs";

export const RESIDUAL_EVIDENCE_LANE_V1_VERSION = "residual-evidence-lane-v1";
export const RESIDUAL_EVIDENCE_LANE_V1_SCHEMA_NAME_SUFFIX = "_residual_v1";
export const RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS = 4;
export const RESIDUAL_EVIDENCE_LANE_V1_MAX_TEXT_LENGTH = 64;

export const RESIDUAL_EVIDENCE_LANE_V1_TARGETS = Object.freeze([
  "identity", "subject", "card_name", "marker",
  "year", "card_number", "serial", "finish"
]);
export const RESIDUAL_EVIDENCE_LANE_V1_ANCHORS = Object.freeze([
  "slab_text", "front_text", "back_text", "front_symbol", "stamped_number",
  "visual", "visible_combination", "model_knowledge"
]);

export const RESIDUAL_EVIDENCE_LANE_V1_PROMPT_SUFFIX =
  "After canonical fields, emit up to 4 short `residual_evidence` rows for useful values absent from every canonical field. Preserve case, punctuation, slashes and leading zeroes for text/stamps. Set `target` and `anchor`; label nonliteral output `visual`, `visible_combination` or `model_knowledge`—never as text. Cover product/set/IP identity, subject, card name, rarity/component marker, year/season, checklist code, stamped serial or finish. Exclude statistics, biography, copyright/legal text, slogans, duplicates and team guesses. This append-only lane cannot change canonical fields. Return [] when none.";

export const RESIDUAL_EVIDENCE_LANE_V1_SCHEMA_PROPERTY = Object.freeze({
  type: "array",
  maxItems: RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["text", "target", "anchor"],
    properties: {
      text: { type: "string", minLength: 1, maxLength: RESIDUAL_EVIDENCE_LANE_V1_MAX_TEXT_LENGTH },
      target: { type: "string", enum: [...RESIDUAL_EVIDENCE_LANE_V1_TARGETS] },
      anchor: { type: "string", enum: [...RESIDUAL_EVIDENCE_LANE_V1_ANCHORS] }
    }
  }
});

const CANDIDATE_BRACKETS = Object.freeze({
  identity: ["product", "set", "ip_sport"],
  subject: ["subject"],
  card_name: ["card_name"],
  marker: ["descriptive_rarity", "search_optimization"],
  year: ["year"],
  card_number: ["card_number"],
  serial: ["numerical_rarity"],
  finish: ["print_finish"]
});
const ROW_KEYS = Object.freeze(["anchor", "target", "text"]);
const LITERAL_ANCHORS = new Set([
  "slab_text", "front_text", "back_text", "front_symbol", "stamped_number"
]);
const NON_LITERAL_ANCHORS = new Set(["visual", "visible_combination", "model_knowledge"]);
const LEGAL_OR_COPYRIGHT = /(?:©|\bcopyright\b|all rights reserved|registered trademark|licensed by|the topps company|panini america)/i;
const STAT_OR_BIOGRAPHY = /\b(?:career|born|height|weight|statistics?|games played|points per game|drafted by|college career)\b/i;
const SAFE_TEXT_MARKER = /^(?:RC|Rookie Card|Rated Rookie|SP|SSP|1st Bowman|1st Edition)$/i;
const YEAR = /^(?:19|20)\d{2}(?:-\d{2})?$/;
const TRACE_DISPOSITIONS = new Set([
  "candidate_only", "resolver_candidate", "same_value_format_candidate"
]);

const exactText = (value) => String(value ?? "").normalize("NFC").trim();
const normalizedText = (value) => exactText(value).toLocaleLowerCase("en-US").replace(/\s+/g, " ");
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const parseObject = (raw) => {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
};
const jsonClone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function canonicalValues(fields = {}) {
  return Object.entries(fields).flatMap(([name, value]) => {
    if (["grammar", "unreadable", "low_confidence"].includes(name)) return [];
    return (Array.isArray(value) ? value : [value]).map(exactText).filter(Boolean);
  });
}

function sameNumericFraction(left, right) {
  const parse = (value) => {
    const match = exactText(value).replace(/\s+/g, "").match(/^(\d{1,4})\/(\d{1,4})$/);
    return match ? [Number(match[1]), Number(match[2])] : null;
  };
  const a = parse(left);
  const b = parse(right);
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

function candidateDisposition(row, fields) {
  const base = {
    candidate_brackets: [...CANDIDATE_BRACKETS[row.target]],
    automatic_csm_admission: false,
    automatic_renderer_admission: false,
    replay_eligible: false
  };
  if (LEGAL_OR_COPYRIGHT.test(row.text)) {
    return { ...base, disposition: "rejected_noise", reason: "legal_or_copyright_text" };
  }
  if (STAT_OR_BIOGRAPHY.test(row.text)) {
    return { ...base, disposition: "rejected_noise", reason: "statistics_or_biography" };
  }
  if (NON_LITERAL_ANCHORS.has(row.anchor)) {
    return {
      ...base,
      disposition: "candidate_only",
      reason: row.anchor === "visual" ? "visual_requires_external_attestation"
        : row.anchor === "model_knowledge" ? "model_knowledge_requires_external_attestation"
          : "visible_combination_requires_role_resolution"
    };
  }
  if (!LITERAL_ANCHORS.has(row.anchor)) {
    return { ...base, disposition: "rejected_invalid", reason: "unsupported_anchor" };
  }

  if (row.target === "identity") {
    return { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "identity_bracket_requires_resolution" };
  }
  if (row.target === "subject") {
    const subjects = Array.isArray(fields.subjects) ? fields.subjects.filter(Boolean) : [];
    return subjects.length
      ? { ...base, disposition: "candidate_only", reason: "subject_conflict_requires_resolution" }
      : { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "literal_subject_for_empty_field" };
  }
  if (row.target === "card_name") {
    return fields.card_name
      ? { ...base, disposition: "candidate_only", reason: "card_name_conflict_requires_resolution" }
      : { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "literal_card_name_for_empty_field" };
  }
  if (row.target === "marker") {
    return SAFE_TEXT_MARKER.test(row.text) && ["slab_text", "front_text", "front_symbol"].includes(row.anchor)
      ? { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "bounded_literal_marker" }
      : { ...base, disposition: "candidate_only", reason: "component_or_rarity_role_requires_resolution" };
  }
  if (row.target === "year") {
    if (!YEAR.test(row.text)) return { ...base, disposition: "candidate_only", reason: "year_shape_not_exact" };
    if (row.anchor !== "slab_text") return { ...base, disposition: "candidate_only", reason: "non_slab_year_requires_identity_check" };
    return fields.year && normalizedText(fields.year) !== normalizedText(row.text)
      ? { ...base, disposition: "candidate_only", reason: "year_conflict_requires_resolution" }
      : { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "slab_year_for_empty_or_compatible_field" };
  }
  if (row.target === "card_number") {
    const boundary = classifySemNumberBoundary(row.text, {
      grammar: fields.grammar,
      field: "card_number",
      checklistContext: String(fields.grammar).toLowerCase() === "tcg"
    });
    if (boundary.boundary !== "CARD_NUMBER") {
      return { ...base, disposition: "candidate_only", reason: `card_number_boundary_${boundary.boundary.toLowerCase()}` };
    }
    return fields.card_number && normalizedText(fields.card_number) !== normalizedText(row.text)
      ? { ...base, disposition: "candidate_only", reason: "card_number_conflict_requires_resolution" }
      : { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "literal_card_number_for_empty_or_compatible_field" };
  }
  if (row.target === "serial") {
    const boundary = classifySemNumberBoundary(row.text, { grammar: fields.grammar, field: "serial" });
    if (boundary.boundary !== "NUMERICAL_RARITY" || row.anchor !== "stamped_number") {
      return { ...base, disposition: "candidate_only", reason: "serial_requires_stamped_current_copy_fraction" };
    }
    if (fields.serial && sameNumericFraction(fields.serial, row.text)) {
      return {
        ...base,
        disposition: "same_value_format_candidate",
        replay_eligible: normalizedText(fields.serial) !== normalizedText(row.text),
        reason: "same_numeric_value_formatting_only"
      };
    }
    return {
      ...base,
      disposition: "candidate_only",
      reason: fields.serial ? "serial_numeric_conflict" : "absent_serial_cannot_self_verify"
    };
  }
  if (row.target === "finish") {
    return row.anchor === "slab_text"
      ? { ...base, disposition: "resolver_candidate", replay_eligible: true, reason: "literal_slab_finish_requires_vocabulary_attestation" }
      : { ...base, disposition: "candidate_only", reason: "finish_requires_catalog_or_visual_attestation" };
  }
  return { ...base, disposition: "rejected_invalid", reason: "unsupported_target" };
}

export function buildResidualEvidenceLaneV1Schema(canonicalSchema) {
  if (!plainObject(canonicalSchema) || !plainObject(canonicalSchema.properties)
      || !Array.isArray(canonicalSchema.required)) {
    throw new TypeError("invalid_canonical_schema");
  }
  if (canonicalSchema.properties.residual_evidence
      || canonicalSchema.required.includes("residual_evidence")) {
    throw new TypeError("residual_evidence_already_present");
  }
  return {
    ...jsonClone(canonicalSchema),
    required: [...canonicalSchema.required, "residual_evidence"],
    properties: {
      ...jsonClone(canonicalSchema.properties),
      residual_evidence: jsonClone(RESIDUAL_EVIDENCE_LANE_V1_SCHEMA_PROPERTY)
    }
  };
}

export function buildResidualEvidenceLaneV1Prompt(canonicalPrompt) {
  const prompt = String(canonicalPrompt ?? "").trim();
  if (!prompt) throw new TypeError("invalid_canonical_prompt");
  return `${prompt} ${RESIDUAL_EVIDENCE_LANE_V1_PROMPT_SUFFIX}`;
}

/**
 * Clone and optionally extend one existing canonical request. This function
 * creates no request and performs no I/O. Callers must explicitly opt in.
 */
export function withResidualEvidenceLaneV1(request, { enabled = false } = {}) {
  const next = jsonClone(request);
  if (!enabled) return next;
  const format = next?.text?.format;
  const schema = format?.schema;
  const content = next?.input?.[0]?.content;
  const promptPart = Array.isArray(content) ? content.find((part) => part?.type === "input_text") : null;
  if (!plainObject(format) || !plainObject(schema) || !promptPart || typeof promptPart.text !== "string") {
    throw new TypeError("invalid_canonical_request");
  }
  format.schema = buildResidualEvidenceLaneV1Schema(schema);
  format.name = `${String(format.name || "canonical_card_fields")}${RESIDUAL_EVIDENCE_LANE_V1_SCHEMA_NAME_SUFFIX}`;
  promptPart.text = buildResidualEvidenceLaneV1Prompt(promptPart.text);
  return next;
}

export function residualEvidenceLaneV1Enabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.LYNCA_EVAL_RESIDUAL_EVIDENCE_V1 || "").trim().toLowerCase()
  );
}

/** Parse, dedupe, and partition candidates. No branch returns field updates. */
export function parseResidualEvidenceLaneV1(raw, { canonicalFields = {} } = {}) {
  const parsed = parseObject(raw);
  const empty = {
    schema_version: RESIDUAL_EVIDENCE_LANE_V1_VERSION,
    source_present: false,
    candidates: [],
    replay_candidates: [],
    dropped: [],
    defects: [],
    field_updates: {},
    canonical_fields_unchanged: true
  };
  if (!plainObject(parsed)) return { ...empty, defects: ["residual_v1_unparseable"] };
  if (!Object.prototype.hasOwnProperty.call(parsed, "residual_evidence")) return empty;
  if (!Array.isArray(parsed.residual_evidence)) {
    return { ...empty, source_present: true, defects: ["residual_v1_not_array"] };
  }

  const defects = [];
  const candidates = [];
  const dropped = [];
  const seen = new Set();
  const represented = new Set(canonicalValues(canonicalFields).map(normalizedText));
  if (parsed.residual_evidence.length > RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS) {
    defects.push(`residual_v1_overflow:${parsed.residual_evidence.length - RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS}`);
  }
  for (const [index, rawRow] of parsed.residual_evidence
    .slice(0, RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS).entries()) {
    if (!plainObject(rawRow)) {
      defects.push(`residual_v1_invalid_row:${index}`);
      continue;
    }
    const keys = Object.keys(rawRow).sort();
    if (keys.length !== ROW_KEYS.length || keys.some((key, position) => key !== ROW_KEYS[position])) {
      defects.push(`residual_v1_extra_or_missing_property:${index}`);
      continue;
    }
    const row = { text: exactText(rawRow.text), target: rawRow.target, anchor: rawRow.anchor };
    if (!row.text || row.text.length > RESIDUAL_EVIDENCE_LANE_V1_MAX_TEXT_LENGTH
        || /[\u0000-\u001f\u007f]/.test(row.text)) {
      defects.push(`residual_v1_invalid_text:${index}`);
      continue;
    }
    if (!RESIDUAL_EVIDENCE_LANE_V1_TARGETS.includes(row.target)) {
      defects.push(`residual_v1_invalid_target:${index}`);
      continue;
    }
    if (!RESIDUAL_EVIDENCE_LANE_V1_ANCHORS.includes(row.anchor)) {
      defects.push(`residual_v1_invalid_anchor:${index}`);
      continue;
    }
    const key = normalizedText(row.text);
    if (seen.has(key)) {
      dropped.push({ ...row, disposition: "rejected_duplicate", reason: "duplicate_residual_text" });
      continue;
    }
    seen.add(key);
    if (represented.has(key)) {
      dropped.push({ ...row, disposition: "already_canonical", reason: "already_represented_in_canonical_fields" });
      continue;
    }
    const candidate = { ...row, ...candidateDisposition(row, canonicalFields) };
    if (candidate.disposition.startsWith("rejected_")) dropped.push(candidate);
    else candidates.push(candidate);
  }

  return {
    schema_version: RESIDUAL_EVIDENCE_LANE_V1_VERSION,
    source_present: true,
    candidates,
    replay_candidates: candidates.filter((candidate) => candidate.replay_eligible),
    dropped,
    defects,
    field_updates: {},
    canonical_fields_unchanged: true
  };
}

/**
 * JSONB-safe trace envelope. It deliberately has no canonical_value,
 * selected_candidate_id, permission=can_apply, or field update shape.
 */
export function toResidualEvidenceCandidateTraceV1({
  tenantId = "", recognitionSessionId, candidates = []
} = {}) {
  const session = exactText(recognitionSessionId);
  if (!session) throw new TypeError("missing_recognition_session_id");
  if (!Array.isArray(candidates)) throw new TypeError("invalid_trace_candidates");
  if (candidates.length > RESIDUAL_EVIDENCE_LANE_V1_MAX_ITEMS) throw new TypeError("residual_trace_overflow");
  const rows = candidates.map((candidate, ordinal) => {
    const text = exactText(candidate?.text);
    if (!text || text.length > RESIDUAL_EVIDENCE_LANE_V1_MAX_TEXT_LENGTH
        || /[\u0000-\u001f\u007f]/.test(text)) throw new TypeError(`invalid_trace_text:${ordinal}`);
    if (!RESIDUAL_EVIDENCE_LANE_V1_TARGETS.includes(candidate?.target)) {
      throw new TypeError(`invalid_trace_target:${ordinal}`);
    }
    if (!RESIDUAL_EVIDENCE_LANE_V1_ANCHORS.includes(candidate?.anchor)) {
      throw new TypeError(`invalid_trace_anchor:${ordinal}`);
    }
    if (!TRACE_DISPOSITIONS.has(candidate?.disposition)) {
      throw new TypeError(`invalid_trace_disposition:${ordinal}`);
    }
    const stable = {
      schema_version: RESIDUAL_EVIDENCE_LANE_V1_VERSION,
      recognition_session_id: session,
      ordinal,
      text,
      target: candidate.target,
      anchor: candidate.anchor,
      candidate_brackets: [...CANDIDATE_BRACKETS[candidate.target]],
      disposition: candidate.disposition,
      reason: exactText(candidate.reason).slice(0, 120),
      replay_eligible: candidate.replay_eligible === true
        && ["resolver_candidate", "same_value_format_candidate"].includes(candidate.disposition),
      automatic_csm_admission: false,
      automatic_renderer_admission: false,
      authority: "candidate_only",
      source: "luna_same_response"
    };
    return { id: sha256(stable).slice(0, 32), tenant_id: exactText(tenantId) || null, ...stable };
  });
  return {
    schema_version: RESIDUAL_EVIDENCE_LANE_V1_VERSION,
    authority: "candidate_only",
    production_promoted: false,
    rows
  };
}
