import { createHash } from "node:crypto";

export const COLLECTIBLE_SEMANTIC_STATE_VERSION = "collectible-semantic-state-v1";

const STATE_KEYS = Object.freeze([
  "schema_version",
  "state_id",
  "grammar",
  "source_inventory_sha256",
  "facts",
  "relationships",
  "uncertainties",
  "canonical_projection"
]);
const FACT_KEYS = Object.freeze([
  "fact_id", "concept", "canonical_path", "value", "status", "confidence", "source_ids"
]);
const RELATIONSHIP_KEYS = Object.freeze([
  "relationship_id", "predicate", "subject_fact_id", "object_fact_id", "source_ids"
]);
const UNCERTAINTY_KEYS = Object.freeze([
  "uncertainty_id", "concept", "alternative_fact_ids", "source_ids", "reason_code"
]);
const GRAMMARS = new Set(["standard", "tcg", "lot"]);
const FACT_STATUSES = new Set(["SUPPORTED", "CONFLICTED"]);
const CONFIDENCE = new Set(["HIGH", "MEDIUM", "LOW"]);
const CANONICAL_META_FIELDS = new Set(["low_confidence", "unreadable"]);

const text = Object.freeze({ type: "string" });
const textList = Object.freeze({ type: "array", items: text });
export const COLLECTIBLE_CANONICAL_PROJECTION_SCHEMA_V1 = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "year", "ip_sport", "language", "manufacturer", "product", "set", "subjects", "team",
    "card_name", "release_variant", "print_finish", "descriptive_rarity", "card_number",
    "serial", "components", "search_optimization", "grading_info", "special_stamp",
    "description", "grammar", "lot_count", "low_confidence", "unreadable"
  ]),
  properties: Object.freeze({
    year: text,
    ip_sport: text,
    language: text,
    manufacturer: text,
    product: text,
    set: text,
    subjects: textList,
    team: text,
    card_name: text,
    release_variant: text,
    print_finish: text,
    descriptive_rarity: text,
    card_number: text,
    serial: text,
    components: textList,
    search_optimization: textList,
    grading_info: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["company", "card_grade", "auto_grade", "grade_type"]),
      properties: Object.freeze({
        company: text,
        card_grade: text,
        auto_grade: text,
        grade_type: text
      })
    }),
    special_stamp: text,
    description: text,
    grammar: Object.freeze({ type: "string", enum: Object.freeze(["standard", "tcg", "lot"]) }),
    lot_count: text,
    low_confidence: textList,
    unreadable: textList
  })
});
const canonicalFields = new Set(Object.keys(COLLECTIBLE_CANONICAL_PROJECTION_SCHEMA_V1.properties));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("semantic_state_value_not_plain");
    }
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError("semantic_state_value_undefined");
      return [key, canonicalValue(value[key])];
    }));
  }
  throw new TypeError("semantic_state_value_invalid");
}

export function canonicalSemanticStateJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256SemanticState(value) {
  return createHash("sha256").update(canonicalSemanticStateJson(value)).digest("hex");
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, code) {
  if (!plainObject(value)
      || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(code);
  }
}

function requiredText(value, code, { max = 240, allowEmpty = false } = {}) {
  if (typeof value !== "string" || value !== value.trim()
      || (!allowEmpty && !value) || value.length > max) {
    throw new TypeError(code);
  }
  return value;
}

function exactStringArray(value, code, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min
      || value.some((entry) => typeof entry !== "string" || !entry || entry !== entry.trim())
      || new Set(value).size !== value.length) {
    throw new TypeError(code);
  }
  return value;
}

function assertSchemaValue(value, schema, path) {
  if (schema.type === "string") {
    if (typeof value !== "string") throw new TypeError(`semantic_state_projection_type:${path}`);
    if (schema.enum && !schema.enum.includes(value)) {
      throw new TypeError(`semantic_state_projection_enum:${path}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new TypeError(`semantic_state_projection_type:${path}`);
    value.forEach((entry, index) => assertSchemaValue(entry, schema.items, `${path}[${index}]`));
    return;
  }
  if (schema.type === "object") {
    if (!plainObject(value)) throw new TypeError(`semantic_state_projection_type:${path}`);
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw new TypeError(`semantic_state_projection_required:${path}.${key}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          throw new TypeError(`semantic_state_projection_extra:${path}.${key}`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) assertSchemaValue(child, properties[key], `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`semantic_state_projection_schema:${path}`);
}

export function canonicalProjectionAtoms(projection, { allowPartial = false } = {}) {
  if (allowPartial) {
    if (!plainObject(projection)) throw new TypeError("semantic_state_projection_type:canonical_projection");
    for (const [field, value] of Object.entries(projection)) {
      const schema = COLLECTIBLE_CANONICAL_PROJECTION_SCHEMA_V1.properties[field];
      if (!schema) throw new TypeError(`semantic_state_projection_extra:canonical_projection.${field}`);
      assertSchemaValue(value, schema, `canonical_projection.${field}`);
    }
  } else {
    assertSchemaValue(
      projection,
      COLLECTIBLE_CANONICAL_PROJECTION_SCHEMA_V1,
      "canonical_projection"
    );
  }
  const atoms = [];
  for (const [field, value] of Object.entries(projection)) {
    if (CANONICAL_META_FIELDS.has(field)) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const text = String(entry ?? "").trim();
        if (text) atoms.push(Object.freeze({ canonical_path: `${field}[]`, value: text }));
      }
      continue;
    }
    if (plainObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const text = String(entry ?? "").trim();
        if (text) atoms.push(Object.freeze({ canonical_path: `${field}.${key}`, value: text }));
      }
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) atoms.push(Object.freeze({ canonical_path: field, value: text }));
  }
  return Object.freeze(atoms);
}

function validCanonicalPath(path) {
  if (!path) return true;
  const root = path.replace(/\[\]$/, "").split(".")[0];
  return canonicalFields.has(root) && !CANONICAL_META_FIELDS.has(root);
}

function validateFact(fact, index, sourceIds) {
  exactKeys(fact, FACT_KEYS, `semantic_state_fact_shape:${index}`);
  const factId = requiredText(fact.fact_id, `semantic_state_fact_id:${index}`, { max: 120 });
  requiredText(fact.concept, `semantic_state_fact_concept:${index}`);
  const canonicalPath = requiredText(
    fact.canonical_path,
    `semantic_state_fact_canonical_path:${index}`,
    { max: 120, allowEmpty: true }
  );
  if (!validCanonicalPath(canonicalPath)) {
    throw new TypeError(`semantic_state_fact_canonical_path:${index}`);
  }
  requiredText(fact.value, `semantic_state_fact_value:${index}`, { max: 500 });
  if (!FACT_STATUSES.has(fact.status)) throw new TypeError(`semantic_state_fact_status:${index}`);
  if (!CONFIDENCE.has(fact.confidence)) throw new TypeError(`semantic_state_fact_confidence:${index}`);
  exactStringArray(fact.source_ids, `semantic_state_fact_sources:${index}`, { min: 1 });
  if (fact.source_ids.some((sourceId) => !sourceIds.has(sourceId))) {
    throw new TypeError(`semantic_state_fact_unknown_source:${index}`);
  }
  if (fact.status === "CONFLICTED" && canonicalPath) {
    throw new TypeError(`semantic_state_conflict_cannot_project:${index}`);
  }
  return factId;
}

function validateRelationships(rows, factIds, sourceIds) {
  const ids = new Set();
  rows.forEach((row, index) => {
    exactKeys(row, RELATIONSHIP_KEYS, `semantic_state_relationship_shape:${index}`);
    const id = requiredText(row.relationship_id, `semantic_state_relationship_id:${index}`, { max: 120 });
    if (ids.has(id)) throw new TypeError(`semantic_state_duplicate_relationship:${index}`);
    ids.add(id);
    requiredText(row.predicate, `semantic_state_relationship_predicate:${index}`);
    for (const key of ["subject_fact_id", "object_fact_id"]) {
      requiredText(row[key], `semantic_state_relationship_${key}:${index}`, { max: 120 });
      if (!factIds.has(row[key])) throw new TypeError(`semantic_state_relationship_unknown_fact:${index}`);
    }
    exactStringArray(row.source_ids, `semantic_state_relationship_sources:${index}`, { min: 1 });
    if (row.source_ids.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new TypeError(`semantic_state_relationship_unknown_source:${index}`);
    }
  });
}

function validateUncertainties(rows, factIds, sourceIds) {
  const ids = new Set();
  rows.forEach((row, index) => {
    exactKeys(row, UNCERTAINTY_KEYS, `semantic_state_uncertainty_shape:${index}`);
    const id = requiredText(row.uncertainty_id, `semantic_state_uncertainty_id:${index}`, { max: 120 });
    if (ids.has(id)) throw new TypeError(`semantic_state_duplicate_uncertainty:${index}`);
    ids.add(id);
    requiredText(row.concept, `semantic_state_uncertainty_concept:${index}`);
    requiredText(row.reason_code, `semantic_state_uncertainty_reason:${index}`, { max: 120 });
    exactStringArray(
      row.alternative_fact_ids,
      `semantic_state_uncertainty_alternatives:${index}`,
      { min: 1 }
    );
    if (row.alternative_fact_ids.some((factId) => !factIds.has(factId))) {
      throw new TypeError(`semantic_state_uncertainty_unknown_fact:${index}`);
    }
    exactStringArray(row.source_ids, `semantic_state_uncertainty_sources:${index}`, { min: 1 });
    if (row.source_ids.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new TypeError(`semantic_state_uncertainty_unknown_source:${index}`);
    }
  });
}

function atomKey({ canonical_path: path, value }) {
  return `${path}\0${value}`;
}

/**
 * Validate one model-produced state without changing it. Canonical fields are
 * a lineage-checked projection of supported facts; open facts remain legal and
 * are deliberately not squeezed into that projection.
 */
export function validateCollectibleSemanticStateV1(state, {
  sourceIds = [],
  sourceInventorySha256 = null
} = {}) {
  exactKeys(state, STATE_KEYS, "semantic_state_shape");
  if (state.schema_version !== COLLECTIBLE_SEMANTIC_STATE_VERSION) {
    throw new TypeError("semantic_state_version");
  }
  if (!/^css_[a-zA-Z0-9._:-]{1,120}$/.test(state.state_id)) {
    throw new TypeError("semantic_state_id");
  }
  if (!GRAMMARS.has(state.grammar)) throw new TypeError("semantic_state_grammar");
  if (!/^[0-9a-f]{64}$/.test(state.source_inventory_sha256)
      || (sourceInventorySha256 !== null
        && state.source_inventory_sha256 !== sourceInventorySha256)) {
    throw new TypeError("semantic_state_source_inventory_sha256");
  }
  if (!Array.isArray(state.facts) || !Array.isArray(state.relationships)
      || !Array.isArray(state.uncertainties)) {
    throw new TypeError("semantic_state_arrays");
  }
  const allowedSourceIds = new Set(sourceIds);
  if (!allowedSourceIds.size) throw new TypeError("semantic_state_source_inventory_empty");
  const factIds = new Set();
  state.facts.forEach((fact, index) => {
    const id = validateFact(fact, index, allowedSourceIds);
    if (factIds.has(id)) throw new TypeError(`semantic_state_duplicate_fact:${index}`);
    factIds.add(id);
  });
  validateRelationships(state.relationships, factIds, allowedSourceIds);
  validateUncertainties(state.uncertainties, factIds, allowedSourceIds);
  assertSchemaValue(
    state.canonical_projection,
    COLLECTIBLE_CANONICAL_PROJECTION_SCHEMA_V1,
    "canonical_projection"
  );
  if (state.canonical_projection.grammar !== state.grammar) {
    throw new TypeError("semantic_state_projection_grammar");
  }

  const expectedAtoms = canonicalProjectionAtoms(state.canonical_projection).map(atomKey).sort();
  const actualAtoms = state.facts.filter((fact) => (
    fact.status === "SUPPORTED" && fact.canonical_path
  )).map((fact) => atomKey(fact)).sort();
  if (expectedAtoms.join("\0") !== actualAtoms.join("\0")) {
    throw new TypeError("semantic_state_projection_lineage");
  }
  return deepFreeze(canonicalValue(state));
}

const canonicalProjectionSchema = canonicalValue(COLLECTIBLE_CANONICAL_PROJECTION_SCHEMA_V1);

export const COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1 = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: [...STATE_KEYS],
  properties: {
    schema_version: { type: "string", enum: [COLLECTIBLE_SEMANTIC_STATE_VERSION] },
    state_id: { type: "string", pattern: "^css_[a-zA-Z0-9._:-]{1,120}$" },
    grammar: { type: "string", enum: [...GRAMMARS] },
    source_inventory_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    facts: {
      type: "array",
      maxItems: 128,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...FACT_KEYS],
        properties: {
          fact_id: { type: "string", minLength: 1, maxLength: 120 },
          concept: { type: "string", minLength: 1, maxLength: 240 },
          canonical_path: { type: "string", maxLength: 120 },
          value: { type: "string", minLength: 1, maxLength: 500 },
          status: { type: "string", enum: [...FACT_STATUSES] },
          confidence: { type: "string", enum: [...CONFIDENCE] },
          source_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }
        }
      }
    },
    relationships: {
      type: "array",
      maxItems: 128,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...RELATIONSHIP_KEYS],
        properties: {
          relationship_id: { type: "string", minLength: 1, maxLength: 120 },
          predicate: { type: "string", minLength: 1, maxLength: 240 },
          subject_fact_id: { type: "string", minLength: 1, maxLength: 120 },
          object_fact_id: { type: "string", minLength: 1, maxLength: 120 },
          source_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }
        }
      }
    },
    uncertainties: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...UNCERTAINTY_KEYS],
        properties: {
          uncertainty_id: { type: "string", minLength: 1, maxLength: 120 },
          concept: { type: "string", minLength: 1, maxLength: 240 },
          alternative_fact_ids: {
            type: "array", minItems: 1, uniqueItems: true, items: { type: "string" }
          },
          source_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } },
          reason_code: { type: "string", minLength: 1, maxLength: 120 }
        }
      }
    },
    canonical_projection: canonicalProjectionSchema
  }
});
