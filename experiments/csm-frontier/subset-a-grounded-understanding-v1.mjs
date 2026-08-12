import { createHash } from "node:crypto";

import { canonicalProjectionAtoms } from "./collectible-semantic-state-v1.mjs";
import {
  FRONTIER_MODEL_CSM_AUDIT_BUNDLE_VERSION,
  validateFrontierModelCsmAuditBundle
} from "./frontier-model-csm-harness-v1.mjs";

export const SUBSET_A_GROUNDED_UNDERSTANDING_EVAL_VERSION =
  "subset-a-grounded-understanding-eval-v1";

const CRITICAL_PATHS = Object.freeze(["year", "subjects[]", "card_number", "serial"]);

function sha256(domain, value) {
  return createHash("sha256")
    .update(`${domain}\0`)
    .update(JSON.stringify(value))
    .digest("hex");
}

function factKey({ canonical_path: path, value }) {
  return `${path}\0${value}`;
}

function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function metric(tp, fp, fn) {
  const precision = safeRatio(tp, tp + fp);
  const recall = safeRatio(tp, tp + fn);
  return Object.freeze({
    true_positive: tp,
    false_positive: fp,
    false_negative: fn,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  });
}

function compareAtoms(expectedAtoms, actualAtoms) {
  const expected = new Set(expectedAtoms.map(factKey));
  const actual = new Set(actualAtoms.map(factKey));
  let tp = 0;
  for (const key of actual) if (expected.has(key)) tp += 1;
  return metric(tp, actual.size - tp, expected.size - tp);
}

function rootField(path) {
  return String(path).replace(/\[\]$/, "").split(".")[0];
}

/**
 * Score evidence-linked semantic facts, never titles. The frozen Subset A
 * canonical observations are the governed labels; marketplace projections
 * and their expected strings are intentionally outside this function.
 */
export function evaluateSubsetAGroundedUnderstanding({ fixture, envelopes, auditBundles } = {}) {
  if (fixture?.schema_version !== "lynca-subset-a-low-canonical-v1"
      || !Array.isArray(fixture?.cases) || fixture.cases.length !== 16) {
    throw new TypeError("subset_a_grounded_fixture_invalid");
  }
  if (!Array.isArray(auditBundles) || auditBundles.length !== fixture.cases.length) {
    throw new TypeError("subset_a_grounded_bundle_count");
  }
  if (!Array.isArray(envelopes) || envelopes.length !== fixture.cases.length) {
    throw new TypeError("subset_a_grounded_envelope_count");
  }
  const envelopeByCase = new Map();
  for (const envelope of envelopes) {
    if (!envelope?.case_id || envelopeByCase.has(envelope.case_id)) {
      throw new TypeError("subset_a_grounded_envelope_invalid");
    }
    envelopeByCase.set(envelope.case_id, envelope);
  }
  const bundles = new Map();
  for (const bundle of auditBundles) {
    if (bundle?.schema_version !== FRONTIER_MODEL_CSM_AUDIT_BUNDLE_VERSION
        || !bundle.case_id || bundles.has(bundle.case_id)) {
      throw new TypeError("subset_a_grounded_bundle_invalid");
    }
    const envelope = envelopeByCase.get(bundle.case_id);
    if (!envelope) throw new TypeError(`subset_a_grounded_missing_envelope:${bundle.case_id}`);
    bundles.set(bundle.case_id, validateFrontierModelCsmAuditBundle(envelope, bundle));
  }

  const fieldCounts = new Map();
  const rows = [];
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  let criticalErrorCount = 0;
  let openFactCount = 0;

  for (const entry of fixture.cases) {
    const bundle = bundles.get(entry.id);
    if (!bundle) throw new TypeError(`subset_a_grounded_missing_bundle:${entry.id}`);
    const expected = canonicalProjectionAtoms(entry.canonical_fields, { allowPartial: true });
    const actual = bundle.semantic_state.facts
      .filter((fact) => fact.status === "SUPPORTED" && fact.canonical_path)
      .map(({ canonical_path, value }) => ({ canonical_path, value }));
    openFactCount += bundle.semantic_state.facts.filter((fact) => !fact.canonical_path).length;
    const rowMetric = compareAtoms(expected, actual);
    totalTp += rowMetric.true_positive;
    totalFp += rowMetric.false_positive;
    totalFn += rowMetric.false_negative;

    const fields = new Set([
      ...expected.map((atom) => rootField(atom.canonical_path)),
      ...actual.map((atom) => rootField(atom.canonical_path))
    ]);
    for (const field of fields) {
      const fieldMetric = compareAtoms(
        expected.filter((atom) => rootField(atom.canonical_path) === field),
        actual.filter((atom) => rootField(atom.canonical_path) === field)
      );
      const count = fieldCounts.get(field) || { tp: 0, fp: 0, fn: 0 };
      count.tp += fieldMetric.true_positive;
      count.fp += fieldMetric.false_positive;
      count.fn += fieldMetric.false_negative;
      fieldCounts.set(field, count);
    }

    const critical_errors = CRITICAL_PATHS.filter((path) => {
      const expectedValues = expected.filter((atom) => atom.canonical_path === path)
        .map((atom) => atom.value).sort();
      const actualValues = actual.filter((atom) => atom.canonical_path === path)
        .map((atom) => atom.value).sort();
      return expectedValues.join("\0") !== actualValues.join("\0");
    });
    criticalErrorCount += critical_errors.length;
    rows.push(Object.freeze({
      case_id: entry.id,
      semantic_state_sha256: bundle.semantic_state_sha256,
      ...rowMetric,
      critical_errors: Object.freeze(critical_errors)
    }));
  }

  return Object.freeze({
    schema_version: SUBSET_A_GROUNDED_UNDERSTANDING_EVAL_VERSION,
    cohort_id: "subset-a-16",
    case_count: rows.length,
    provider_calls: 0,
    title_strings_read: false,
    marketplace_projection_evaluated: false,
    governed_label_sha256: sha256(
      "lynca-subset-a-grounded-labels-v1",
      fixture.cases.map(({ id, canonical_fields }) => ({ id, canonical_fields }))
    ),
    aggregate: metric(totalTp, totalFp, totalFn),
    critical_error_count: criticalErrorCount,
    open_fact_count_unscored: openFactCount,
    by_field: Object.freeze(Object.fromEntries([...fieldCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, counts]) => [field, metric(counts.tp, counts.fp, counts.fn)]))),
    cases: Object.freeze(rows)
  });
}
