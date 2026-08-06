// Evaluation-only adapter: same-response residual candidates -> the frozen
// 11-mechanism paid bundle. It reads no labels or cohort identifiers and makes
// no provider, storage, persistence, or production calls.

import {
  COMBINED_POSITIVE_PAID_MECHANISMS_V1,
  runCombinedPositiveBundleV1
} from "./combined-positive-bundle-v1.mjs";

export const PAID_RESIDUAL_COMBINED_V1 = "paid-residual-combined-v1";

const copy = (value) => structuredClone(value ?? {});
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const REGIONS = Object.freeze({
  slab_text: "slab_label",
  front_text: "card_front",
  back_text: "card_back",
  front_symbol: "card_front",
  stamped_number: "card_front"
});

function observationLabel(candidate) {
  if (candidate.target === "identity") return candidate.anchor === "front_symbol" ? "logo" : "set";
  if (candidate.target === "card_name") {
    return candidate.anchor === "front_symbol" ? "event_logo_text" : "insert_name";
  }
  if (candidate.target === "year") return "year_set";
  if (candidate.target === "serial") return "stamped_number";
  if (candidate.target === "finish") return "parallel_finish";
  if (candidate.target === "marker") {
    return /^1ST$/i.test(clean(candidate.text)) ? "stamped_number" : "rarity_marker";
  }
  if (candidate.target === "card_number") return "card_number";
  if (candidate.target === "subject") return "subject";
  return "unknown";
}

function literalReplayCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => (
    candidate?.replay_eligible === true
    && ["resolver_candidate", "same_value_format_candidate"].includes(candidate?.disposition)
    && clean(candidate?.text)
    && REGIONS[candidate?.anchor]
  ));
}

/**
 * Convert only parser-approved literal candidates into the legacy evidence
 * shapes consumed by the frozen bundle. Ambiguous identity never becomes a
 * Product/Set field here; subject candidates never receive field authority.
 */
export function paidResidualCombinedContextV1(residualCandidates = [], {
  sourceFingerprint = "unbound"
} = {}) {
  const retained = literalReplayCandidates(residualCandidates);
  const expressionFields = {};
  const observations = retained.map((candidate, index) => ({
    evidence: clean(candidate.text),
    label: observationLabel(candidate),
    region: REGIONS[candidate.anchor],
    kind: "printed_text",
    confidence: "high",
    residual_target: candidate.target,
    residual_anchor: candidate.anchor,
    residual_disposition: candidate.disposition,
    source: "luna_same_response_residual_v1",
    source_fingerprint: clean(sourceFingerprint) || "unbound",
    source_ordinal: index
  }));

  for (const candidate of retained) {
    const value = clean(candidate.text);
    if (candidate.target === "finish" && !expressionFields.print_finish) {
      expressionFields.print_finish = value;
    } else if (candidate.target === "card_name" && !expressionFields.card_name) {
      expressionFields.card_name = value;
    } else if (candidate.target === "year" && !expressionFields.year) {
      expressionFields.year = value;
    } else if (candidate.target === "serial" && !expressionFields.serial) {
      expressionFields.serial = value;
    } else if (candidate.target === "card_number" && !expressionFields.card_number) {
      expressionFields.card_number = value;
    } else if (candidate.target === "marker" && /^(?:SP|SSP|1st Bowman|1st Edition)$/i.test(value)
      && !expressionFields.descriptive_rarity) {
      expressionFields.descriptive_rarity = value;
    }
  }

  return {
    expressionFields,
    expressionTitle: "",
    candidateFacts: [],
    observations,
    provenance: {
      source: "luna_same_response_residual_v1",
      checkpoint_sha256: clean(sourceFingerprint) || "unbound"
    },
    retained_candidates: copy(retained)
  };
}

export function runPaidResidualCombinedV1(canonicalFields = {}, residualCandidates = [], {
  sourceFingerprint = "unbound"
} = {}) {
  const context = paidResidualCombinedContextV1(residualCandidates, { sourceFingerprint });
  const bundle = runCombinedPositiveBundleV1(canonicalFields, {
    ...context,
    enabledMechanisms: COMBINED_POSITIVE_PAID_MECHANISMS_V1
  });
  return {
    schema_version: PAID_RESIDUAL_COMBINED_V1,
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    enabled_mechanisms: [...COMBINED_POSITIVE_PAID_MECHANISMS_V1],
    retained_candidates: context.retained_candidates,
    bundle
  };
}
