// Evaluation-only same-response capture contract derived from the fresh150
// bare/canonical complementarity ledger. This file is intentionally outside
// the runtime path. Captured rows have no CSM, Composer, persistence, or
// production authority.

import { createHash } from "node:crypto";

export const FIELD_SPECIFIC_OBSERVATION_LANE_V2 = "field-specific-observation-lane-v2";
export const FIELD_SPECIFIC_OBSERVATION_SCHEMA_SUFFIX_V2 = "_field_observation_v2";
export const FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2 = 2;
export const FIELD_SPECIFIC_OBSERVATION_ROLES_V2 = Object.freeze([
  "identity_phrase", "finish_phrase", "commercial_marker", "exact_code"
]);

const REGIONS = Object.freeze(["slab_label", "card_front", "card_back", "front_symbol"]);
const BASES = Object.freeze(["printed_text", "visual_pattern"]);
const LEGAL_OR_NOISE = /(?:all rights reserved|copyright|©|statistics?|career|biograph|licensed by|trademark)/i;

const rowSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["text", "role", "region", "basis"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 64 },
    role: { type: "string", enum: [...FIELD_SPECIFIC_OBSERVATION_ROLES_V2] },
    region: { type: "string", enum: [...REGIONS] },
    basis: { type: "string", enum: [...BASES] }
  }
});

export const FIELD_SPECIFIC_OBSERVATION_PROPERTY_V2 = Object.freeze({
  type: "array",
  maxItems: FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2,
  items: rowSchema
});

export const FIELD_SPECIFIC_OBSERVATION_PROMPT_V2 = [
  "After canonical fields, independently fill `observation_candidates`; candidate rows cannot change canonical fields, title, or persistence.",
  "Return zero to two rows; do not fill capacity, and omit phrases whose meaningful words are already represented in canonical fields.",
  "Copy one complete contiguous phrase verbatim; never shorten, split, normalise, or join distant words.",
  "Roles: identity_phrase = fuller product/set/IP/card-name/subject/team/character/season; finish_phrase = printed parallel/finish or one short visible colour/pattern cue; commercial_marker = literal RC/Rookie/1st/SP/SSP/Redemption/VMAX; exact_code = literal checklist code/stamped fraction/grade with every character preserved.",
  "Use printed_text for copied words. visual_pattern is allowed only for finish_phrase. Never use world knowledge, biography, statistics, copyright/legal text, or generic artwork descriptions."
].join(" ");

const clone = (value) => JSON.parse(JSON.stringify(value));
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const normal = (value) => clean(value).toLocaleLowerCase("en-US");
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const tokens = (value) => normal(value).split(/[^a-z0-9/']+/).filter(Boolean);

function scalarValues(value) {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (plainObject(value)) return Object.values(value).flatMap(scalarValues);
  const text = clean(value);
  return text ? [text] : [];
}

function canonicalTokenSet(fields) {
  return new Set(Object.values(fields || {}).flatMap(scalarValues).flatMap(tokens));
}

function candidateId(row) {
  return `obs2_${createHash("sha256").update(`${row.role}\0${normal(row.text)}\0${row.region}\0${row.basis}`).digest("hex").slice(0, 20)}`;
}

export function buildFieldSpecificObservationSchemaV2(canonicalSchema) {
  if (!plainObject(canonicalSchema?.properties) || !Array.isArray(canonicalSchema?.required)) {
    throw new TypeError("invalid_canonical_schema");
  }
  if (canonicalSchema.properties.observation_candidates
      || canonicalSchema.required.includes("observation_candidates")) {
    throw new TypeError("observation_candidates_already_present");
  }
  return {
    ...clone(canonicalSchema),
    required: [...canonicalSchema.required, "observation_candidates"],
    properties: {
      ...clone(canonicalSchema.properties),
      observation_candidates: clone(FIELD_SPECIFIC_OBSERVATION_PROPERTY_V2)
    }
  };
}

export function withFieldSpecificObservationLaneV2(request, { enabled = false } = {}) {
  const next = clone(request);
  if (!enabled) return next;
  const format = next?.text?.format;
  const promptPart = next?.input?.[0]?.content?.find?.((part) => part?.type === "input_text");
  if (!plainObject(format?.schema) || !promptPart || typeof promptPart.text !== "string") {
    throw new TypeError("invalid_canonical_request");
  }
  format.schema = buildFieldSpecificObservationSchemaV2(format.schema);
  format.name = `${String(format.name || "canonical_card_fields")}${FIELD_SPECIFIC_OBSERVATION_SCHEMA_SUFFIX_V2}`;
  promptPart.text = `${promptPart.text.trim()} ${FIELD_SPECIFIC_OBSERVATION_PROMPT_V2}`;
  return next;
}

function emptyCapture() {
  return {
    schema_version: FIELD_SPECIFIC_OBSERVATION_LANE_V2,
    source_present: false,
    candidates: [],
    dropped: [],
    defects: [],
    field_updates: {},
    admission_proposals: [],
    canonical_fields_unchanged: true,
    automatic_csm_admission: false,
    automatic_renderer_admission: false,
    persistence_authority: false
  };
}

export function captureFieldSpecificObservationLaneV2(raw, { canonicalFields = {} } = {}) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  const empty = emptyCapture();
  if (!plainObject(parsed)) return { ...empty, defects: ["field_observation_v2_unparseable"] };
  if (!Object.prototype.hasOwnProperty.call(parsed, "observation_candidates")) return empty;
  const source = parsed.observation_candidates;
  if (!Array.isArray(source)) {
    return { ...empty, source_present: true, defects: ["field_observation_v2_not_array"] };
  }

  const defects = [];
  const dropped = [];
  const candidates = [];
  const represented = canonicalTokenSet(canonicalFields);
  const seenText = new Set();
  if (source.length > FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2) {
    defects.push(`field_observation_v2_overflow:${source.length - FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2}`);
  }

  for (const [index, rawRow] of source.slice(0, FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2).entries()) {
    const exactKeys = ["basis", "region", "role", "text"];
    if (!plainObject(rawRow) || Object.keys(rawRow).sort().join("|") !== exactKeys.join("|")) {
      defects.push(`field_observation_v2_invalid_row:${index}`);
      continue;
    }
    const row = {
      text: clean(rawRow.text),
      role: rawRow.role,
      region: rawRow.region,
      basis: rawRow.basis
    };
    if (!row.text || row.text.length > 64 || /[\u0000-\u001f\u007f]/.test(row.text)
        || !FIELD_SPECIFIC_OBSERVATION_ROLES_V2.includes(row.role)
        || !REGIONS.includes(row.region) || !BASES.includes(row.basis)) {
      defects.push(`field_observation_v2_invalid_value:${index}`);
      continue;
    }
    if (LEGAL_OR_NOISE.test(row.text)) {
      dropped.push({ ...row, disposition: "rejected_legal_biography_or_statistics" });
      continue;
    }
    if (row.basis === "visual_pattern" && row.role !== "finish_phrase") {
      dropped.push({ ...row, disposition: "rejected_visual_basis_for_non_finish" });
      continue;
    }
    const textKey = normal(row.text);
    if (seenText.has(textKey)) {
      dropped.push({ ...row, disposition: "rejected_duplicate_or_role_conflict" });
      continue;
    }
    seenText.add(textKey);
    const rowTokens = tokens(row.text);
    if (rowTokens.length && rowTokens.every((token) => represented.has(token))) {
      dropped.push({ ...row, disposition: "already_represented_in_canonical_fields" });
      continue;
    }
    candidates.push({
      candidate_id: candidateId(row),
      ...row,
      disposition: "captured_candidate_only",
      authority: "candidate_only",
      replay_eligible: false,
      automatic_csm_admission: false,
      automatic_renderer_admission: false,
      persistence_authority: false
    });
  }

  return {
    ...empty,
    source_present: true,
    candidates,
    dropped,
    defects
  };
}

export function toFieldSpecificObservationTraceV2(capture) {
  const rows = Array.isArray(capture?.candidates) ? capture.candidates : [];
  return {
    schema_version: "field-specific-observation-trace-v2",
    authority: "capture_only",
    automatic_csm_admission: false,
    automatic_renderer_admission: false,
    field_updates: {},
    candidates: rows.map((row) => ({
      candidate_id: row.candidate_id,
      text: row.text,
      role: row.role,
      region: row.region,
      basis: row.basis,
      authority: "candidate_only"
    }))
  };
}
