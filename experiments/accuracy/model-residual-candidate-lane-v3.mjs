// Evaluation-only schema side-channel. It adds candidate capacity without
// changing the canonical prompt, fields, title, persistence, or authority.

import { createHash } from "node:crypto";

export const MODEL_RESIDUAL_CANDIDATE_LANE_V3 = "model-residual-candidate-lane-v3";
export const MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3 = "residual_visible_evidence";
export const MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3 = 8;
export const MODEL_RESIDUAL_CANDIDATE_ROLES_V3 = Object.freeze([
  "identity_phrase", "finish_phrase", "commercial_marker", "exact_code", "other_visible"
]);

const REGIONS = Object.freeze(["slab_label", "card_front", "card_back", "front_symbol"]);
const BASES = Object.freeze(["printed_text", "visual_pattern"]);
const NOISE = /(?:all rights reserved|copyright|©|statistics?|career|biograph|licensed by|trademark)/i;
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const normal = (value) => clean(value).toLocaleLowerCase("en-US");
const clone = (value) => structuredClone(value ?? {});

export const MODEL_RESIDUAL_CANDIDATE_PROPERTY_SCHEMA_V3 = Object.freeze({
  type: "array",
  maxItems: MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3,
  description: "Candidate-only complete residual phrases visible in the supplied images. Copy contiguous text exactly. Roles route review only and never authorize canonical fields or title output. Keep complete product/set/identity phrases even when some words overlap canonical fields. Omit only an exact full-value duplicate, legal/biographical/statistical text, or unsupported inference.",
  items: {
    type: "object", additionalProperties: false,
    required: ["text", "role", "region", "basis"],
    properties: {
      text: { type: "string", minLength: 1, maxLength: 96 },
      role: { type: "string", enum: [...MODEL_RESIDUAL_CANDIDATE_ROLES_V3] },
      region: { type: "string", enum: [...REGIONS] },
      basis: { type: "string", enum: [...BASES] }
    }
  }
});

export function withModelResidualCandidateLaneV3(request, { enabled = false } = {}) {
  const next = clone(request);
  if (!enabled) return next;
  const schema = next?.text?.format?.schema;
  if (!schema?.properties || !Array.isArray(schema.required)
    || schema.properties[MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3]) throw new TypeError("invalid_canonical_schema");
  schema.properties = { [MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3]: clone(MODEL_RESIDUAL_CANDIDATE_PROPERTY_SCHEMA_V3),
    ...schema.properties };
  schema.required = [MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3, ...schema.required];
  return next;
}

export function splitModelResidualCandidateEnvelopeV3(raw) {
  let parsed = raw;
  if (typeof raw === "string") try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { canonical_payload: null, candidate_source: null, defect: "unparseable_envelope" };
  }
  const canonicalPayload = clone(parsed);
  const candidateSource = canonicalPayload[MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3];
  delete canonicalPayload[MODEL_RESIDUAL_CANDIDATE_PROPERTY_V3];
  return { canonical_payload: canonicalPayload, candidate_source: candidateSource, defect: null };
}

function canonicalExactValues(fields) {
  const values = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") return Object.values(value).forEach(visit);
    if (clean(value)) values.push(normal(value));
  };
  visit(fields);
  return new Set(values);
}

export function captureModelResidualCandidatesV3(raw, { canonicalFields = {} } = {}) {
  const envelope = splitModelResidualCandidateEnvelopeV3(raw);
  const source = envelope.candidate_source;
  const result = { schema_version: MODEL_RESIDUAL_CANDIDATE_LANE_V3, authority: "candidate_only",
    source_present: source !== null && source !== undefined, candidates: [], dropped: [], defects: [], field_updates: {},
    automatic_csm_admission: false, automatic_renderer_admission: false, persistence_authority: false };
  if (!Array.isArray(source)) {
    result.defects.push(source === null || source === undefined ? "required_candidate_array_missing" : "candidate_source_not_array");
    return result;
  }
  if (source.length > MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3) result.defects.push(`row_overflow:${source.length}`);
  const exactCanonical = canonicalExactValues(canonicalFields); const seen = new Set();
  for (const [index, value] of source.slice(0, MODEL_RESIDUAL_CANDIDATE_MAX_ROWS_V3).entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("|") !== "basis|region|role|text") {
      result.defects.push(`invalid_row_shape:${index}`); continue;
    }
    const row = { text: clean(value?.text), role: value?.role, region: value?.region, basis: value?.basis };
    const key = `${normal(row.text)}\0${row.role}`;
    if (!row.text || row.text.length > 96 || !MODEL_RESIDUAL_CANDIDATE_ROLES_V3.includes(row.role)
      || !REGIONS.includes(row.region) || !BASES.includes(row.basis)) {
      result.defects.push(`invalid_row:${index}`); continue;
    }
    if (NOISE.test(row.text) || (row.basis === "visual_pattern" && row.role !== "finish_phrase")) {
      result.dropped.push({ ...row, reason: "noise_or_invalid_visual_role" }); continue;
    }
    if (seen.has(key) || exactCanonical.has(normal(row.text))) {
      result.dropped.push({ ...row, reason: "exact_full_value_duplicate" }); continue;
    }
    seen.add(key);
    const candidateId = createHash("sha256").update(key).digest("hex").slice(0, 20);
    result.candidates.push({ candidate_id: `mrv3_${candidateId}`, ...row, authority: "candidate_only",
      resolver_route: row.role, replay_eligible: false, automatic_csm_admission: false,
      automatic_renderer_admission: false, persistence_authority: false });
  }
  return result;
}

export function routeModelResidualCandidatesV3(capture) {
  const queues = Object.fromEntries(MODEL_RESIDUAL_CANDIDATE_ROLES_V3.map((role) => [role, []]));
  for (const row of capture?.candidates || []) queues[row.role].push(clone(row));
  return { schema_version: "model-residual-candidate-routing-v3", authority: "candidate_only",
    queues, field_updates: {}, admission_proposals: [], automatic_admission: false };
}
