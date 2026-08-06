// Evaluation-only capture lane for the largest fresh-150 recall families.
// Four independent arrays prevent identity, markers, serials, and parallel
// cues from competing for one small residual budget. Nothing in this module
// grants CSM, Composer, persistence, or production authority.

export const FIELD_SPECIFIC_OBSERVATION_LANE_V1 = "field-specific-observation-lane-v1";
export const FIELD_SPECIFIC_OBSERVATION_SCHEMA_SUFFIX = "_field_observation_v1";

const REGIONS = Object.freeze(["slab_label", "card_front", "card_back", "front_symbol"]);
// Seven rows is the hard maximum, but each semantic lane has reserved space.
// The earlier generic max-8/10 ledgers invited filler; more than two complete
// phrases in any one lane has no measured coverage justification.
const MAX = Object.freeze({ identity_phrases: 2, printed_markers: 2, stamped_serials: 1, parallel_cues: 2 });
const SERIAL = /^\d{1,4}\/\d{1,4}$/;

const literalRow = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["text", "region"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 96 },
    region: { type: "string", enum: [...REGIONS] }
  }
});

export const FIELD_SPECIFIC_OBSERVATION_PROPERTY_V1 = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["identity_phrases", "printed_markers", "stamped_serials", "parallel_cues"],
  properties: {
    identity_phrases: {
      type: "array", maxItems: MAX.identity_phrases, items: literalRow
    },
    printed_markers: {
      type: "array", maxItems: MAX.printed_markers, items: literalRow
    },
    stamped_serials: {
      type: "array", maxItems: MAX.stamped_serials, items: literalRow
    },
    parallel_cues: {
      type: "array", maxItems: MAX.parallel_cues,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "region", "basis"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 96 },
          region: { type: "string", enum: [...REGIONS] },
          basis: { type: "string", enum: ["printed_text", "visual_pattern"] }
        }
      }
    }
  }
});

export const FIELD_SPECIFIC_OBSERVATION_PROMPT_V1 = [
  "After canonical fields, fill `observation_candidates` independently; these rows cannot change canonical fields.",
  "Copy complete visible phrases without shortening or splitting them.",
  "In `identity_phrases`, preserve the fullest printed product, set, IP, insert, or card-name phrase from the slab, front, back, or logo; exclude subjects, teams, biography, statistics, copyright and legal text.",
  "In `printed_markers`, copy literal commercial markers such as RC, Rookie Card, Rated Rookie, SP, SSP, Case Hit, 1st Bowman, or 1st Edition only when the words or symbol are visible.",
  "In `stamped_serials`, copy each visible limited-print fraction exactly, including leading zeroes; never infer or normalise a digit.",
  "In `parallel_cues`, preserve a literal printed finish/parallel phrase when present; otherwise give one short visual pattern cue and label it `visual_pattern` rather than pretending it was printed.",
  "Do not use world knowledge. Use an empty array for a lane with no candidate."
].join(" ");

const clone = (value) => JSON.parse(JSON.stringify(value));
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const normal = (value) => clean(value).toLocaleLowerCase("en-US");

export function buildFieldSpecificObservationSchemaV1(canonicalSchema) {
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
      observation_candidates: clone(FIELD_SPECIFIC_OBSERVATION_PROPERTY_V1)
    }
  };
}

export function withFieldSpecificObservationLaneV1(request, { enabled = false } = {}) {
  const next = clone(request);
  if (!enabled) return next;
  const format = next?.text?.format;
  const promptPart = next?.input?.[0]?.content?.find?.((part) => part?.type === "input_text");
  if (!plainObject(format?.schema) || !promptPart || typeof promptPart.text !== "string") {
    throw new TypeError("invalid_canonical_request");
  }
  format.schema = buildFieldSpecificObservationSchemaV1(format.schema);
  format.name = `${String(format.name || "canonical_card_fields")}${FIELD_SPECIFIC_OBSERVATION_SCHEMA_SUFFIX}`;
  promptPart.text = `${promptPart.text.trim()} ${FIELD_SPECIFIC_OBSERVATION_PROMPT_V1}`;
  return next;
}

function canonicalValues(fields) {
  return Object.values(fields ?? {}).flatMap((value) => Array.isArray(value) ? value : [value])
    .map(clean).filter(Boolean);
}

function parseRow(raw, role, index, defects) {
  const expected = role === "parallel_cues" ? ["basis", "region", "text"] : ["region", "text"];
  if (!plainObject(raw) || Object.keys(raw).sort().join("|") !== expected.join("|")) {
    defects.push(`field_observation_invalid_row:${role}:${index}`);
    return null;
  }
  const row = { text: clean(raw.text), region: raw.region };
  if (!row.text || row.text.length > 96 || !REGIONS.includes(row.region)) {
    defects.push(`field_observation_invalid_value:${role}:${index}`);
    return null;
  }
  if (role === "parallel_cues") {
    if (!["printed_text", "visual_pattern"].includes(raw.basis)) {
      defects.push(`field_observation_invalid_basis:${index}`);
      return null;
    }
    row.basis = raw.basis;
  }
  return row;
}

export function parseFieldSpecificObservationLaneV1(raw, { canonicalFields = {} } = {}) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  const empty = {
    schema_version: FIELD_SPECIFIC_OBSERVATION_LANE_V1,
    source_present: false,
    candidates: [], dropped: [], defects: [], field_updates: {},
    canonical_fields_unchanged: true, automatic_csm_admission: false
  };
  if (!plainObject(parsed)) return { ...empty, defects: ["field_observation_unparseable"] };
  if (!Object.prototype.hasOwnProperty.call(parsed, "observation_candidates")) return empty;
  const source = parsed.observation_candidates;
  if (!plainObject(source)) return { ...empty, source_present: true, defects: ["field_observation_not_object"] };

  const defects = [];
  const dropped = [];
  const candidates = [];
  const represented = new Set(canonicalValues(canonicalFields).map(normal));
  const seen = new Set();
  for (const role of Object.keys(MAX)) {
    const rows = source[role];
    if (!Array.isArray(rows)) {
      defects.push(`field_observation_missing_array:${role}`);
      continue;
    }
    if (rows.length > MAX[role]) defects.push(`field_observation_overflow:${role}:${rows.length - MAX[role]}`);
    for (const [index, rawRow] of rows.slice(0, MAX[role]).entries()) {
      const row = parseRow(rawRow, role, index, defects);
      if (!row) continue;
      const key = `${role}:${normal(row.text)}`;
      if (seen.has(key)) {
        dropped.push({ role, ...row, disposition: "rejected_duplicate" });
        continue;
      }
      seen.add(key);
      if (represented.has(normal(row.text))) {
        dropped.push({ role, ...row, disposition: "already_canonical" });
        continue;
      }
      if (role === "stamped_serials" && !SERIAL.test(row.text)) {
        dropped.push({ role, ...row, disposition: "rejected_invalid_serial_shape" });
        continue;
      }
      candidates.push({
        role, ...row,
        disposition: "candidate_only",
        reason: `${role}_requires_resolution`,
        replay_eligible: false,
        automatic_csm_admission: false,
        automatic_renderer_admission: false,
        authority: "candidate_only"
      });
    }
  }
  return {
    ...empty,
    source_present: true,
    candidates,
    replay_candidates: candidates.filter((row) => row.replay_eligible),
    dropped,
    defects
  };
}
