import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  SEM_OBSERVATION_LAYER,
  SEM_STANDARD_VERSION
} from "../csm/sem-definition.mjs";

const fieldGraphKeys = Object.freeze([
  "player",
  "year",
  "product",
  "card_type",
  "parallel",
  "serial",
  "card_number",
  "grade"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function firstText(fields, names = []) {
  for (const name of names) {
    const value = fields?.[name];
    if (Array.isArray(value)) {
      const values = normalizeTextArray(value);
      if (values.length) return values.join(" / ");
      continue;
    }
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function truthyFeatureLabel(fields, names = []) {
  return names
    .filter((name) => fields?.[name] === true)
    .map((name) => name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(" / ") || null;
}

function gradeText(fields = {}) {
  const company = firstText(fields, ["grade_company"]);
  const cardGrade = firstText(fields, ["card_grade"]);
  const autoGrade = firstText(fields, ["auto_grade"]);
  const gradeType = firstText(fields, ["grade_type"]);

  if (company && cardGrade && autoGrade) return `${company} ${cardGrade} Auto ${autoGrade}`;
  if (company && cardGrade) return `${company} ${cardGrade}`;
  if (company && gradeType && gradeType !== "UNKNOWN") return `${company} ${gradeType}`;
  return company || cardGrade || null;
}

function serializedEvidence(parts = []) {
  return parts
    .filter((part) => part !== undefined && part !== null)
    .map((part) => {
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ")
    .toLowerCase();
}

function sourceSummary({ evidence = {}, retrievalTrace = {}, openSetReadiness = {}, workflowSidecars = {} } = {}) {
  const text = serializedEvidence([evidence, retrievalTrace, openSetReadiness, workflowSidecars]);
  return {
    gpt_vision: Boolean(Object.keys(evidence || {}).length),
    ocr: /\b(?:ocr|paddle|text_patch|crop_text)\b/.test(text),
    catalog: /\b(?:catalog|checklist|registry|approved_reference|official|identity_candidate)\b/.test(text),
    vector: /\b(?:vector|embedding|visual_reference|similarity|siglip)\b/.test(text)
  };
}

function sourceFieldsFor(key) {
  return {
    player: ["players", "character", "subject", "subjects"],
    year: ["year"],
    product: ["manufacturer", "brand", "product", "set", "subset", "product_or_set"],
    card_type: ["card_name", "card_type", "official_card_type", "insert", "observable_components"],
    parallel: ["parallel_exact", "parallel", "parallel_family", "surface_color", "variation"],
    serial: ["serial_number", "numerical_rarity", "expected_serial_denominator"],
    card_number: ["collector_number", "checklist_code", "card_number"],
    grade: ["grade_company", "card_grade", "auto_grade", "grade_type"]
  }[key] || [];
}

function nodeFor({ key, value, fields, summary }) {
  return {
    field: key,
    value,
    observation_layer: SEM_OBSERVATION_LAYER.BEST_OBSERVED_FIELD,
    semantic_status: "observed_candidate_not_resolved_truth",
    source_fields: sourceFieldsFor(key).filter((field) => {
      const raw = fields?.[field];
      if (Array.isArray(raw)) return raw.length > 0;
      return raw !== undefined && raw !== null && raw !== "" && raw !== false;
    }),
    evidence_sources: Object.entries(summary)
      .filter(([, present]) => present)
      .map(([source]) => source),
    training_visible: false
  };
}

export function buildFieldGraph({
  resolved = {},
  evidence = {},
  retrievalTrace = {},
  openSetReadiness = {},
  workflowSidecars = {}
} = {}) {
  const fields = normalizeResolvedFields(resolved || {});
  const observedFeatures = truthyFeatureLabel(fields, [
    "auto",
    "patch",
    "relic",
    "jersey",
    "rc",
    "ssp",
    "case_hit",
    "sketch",
    "redemption",
    "one_of_one"
  ]);
  const parallel = firstText(fields, ["parallel_exact", "parallel", "parallel_family", "surface_color", "variation"]);
  const graph = {
    schema_version: "listing-field-graph-v1",
    player: firstText(fields, ["players", "character"]),
    year: firstText(fields, ["year"]),
    product: firstText(fields, ["product", "set", "subset", "brand", "manufacturer"]),
    card_type: firstText(fields, ["card_name", "card_type", "official_card_type", "insert"]) || observedFeatures,
    parallel,
    serial: firstText(fields, ["serial_number", "numerical_rarity", "expected_serial_denominator"]),
    card_number: firstText(fields, ["collector_number", "checklist_code"]),
    grade: gradeText(fields)
  };
  const summary = sourceSummary({ evidence, retrievalTrace, openSetReadiness, workflowSidecars });
  const fieldNodes = {};

  for (const key of fieldGraphKeys) {
    fieldNodes[key] = nodeFor({ key, value: graph[key], fields, summary });
  }

  return {
    ...graph,
    sem_standard_version: SEM_STANDARD_VERSION,
    semantic_model: "LYNCA_SEM",
    observation_layer: SEM_OBSERVATION_LAYER.BEST_OBSERVED_FIELD,
    semantic_status: "internal_observation_graph_not_writer_form",
    field_nodes: fieldNodes,
    source_summary: summary,
    structured_only: true
  };
}

export function compactFieldGraph(fieldGraph = {}) {
  return Object.fromEntries(
    fieldGraphKeys
      .map((field) => [field, normalizeText(fieldGraph[field])])
      .filter(([, value]) => value)
  );
}

export function fieldGraphKeysForTraining() {
  return [...fieldGraphKeys];
}

export function isFieldGraph(value) {
  return isPlainObject(value) && value.schema_version === "listing-field-graph-v1";
}
