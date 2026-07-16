import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  evaluateRetrievalApplicationAblation,
  retrievalCausalInvalidReasons,
  splitRetrievalApplicationReplayReport
} from "./evaluate-retrieval-application-ablation.mjs";

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return Number.isFinite(value) || typeof value !== "number" ? value : null;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableJsonValue(value[key])]));
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex")}`;
}

function confirmedSameCardExclusion(itemId) {
  return {
    exclusion_requested: true,
    exclusion_confirmed: true,
    returned_self_candidate_count: 0,
    same_card_exclusion_evidence_present: true,
    exclusion_observation: {
      exclusion_requested: true,
      exclusion_confirmed: true,
      requested_identifiers: {
        source_feedback_id: `feedback-${itemId}`,
        asset_id: itemId,
        physical_card_id: null,
        physical_instance_group_id: null,
        image_ids: [`image-${itemId}`],
        object_paths: [`eval/${itemId}.jpg`],
        content_sha256: [`sha-${itemId}`]
      },
      catalog: {
        enabled: true,
        requested: true,
        confirmed: true,
        returned_self_candidate_count: 0
      },
      vector: {
        enabled: true,
        requested: true,
        confirmed: true,
        returned_self_candidate_count: 0
      },
      returned_self_candidate_count: 0,
      same_card_exclusion_evidence_present: true,
      same_card_exclusion_evidence: { present: true }
    }
  };
}

const confirmedStatuses = {
  year: "CONFIRMED",
  ip_sport: "UNKNOWN",
  language: "UNKNOWN",
  manufacturer: "UNKNOWN",
  product: "CONFIRMED",
  set: "UNKNOWN",
  subject: "CONFIRMED",
  card_name: "CONFIRMED",
  card_number: "UNKNOWN",
  descriptive_rarity: "UNKNOWN",
  numerical_rarity: "UNKNOWN",
  release_variant: "UNKNOWN",
  print_finish: "UNKNOWN",
  special_stamp: "UNKNOWN",
  grading_info: "UNKNOWN"
};

const offExecution = {
  contract_id: "retrieval-application-ablation-v1",
  arm: "OFF",
  terminal_path: "evidence_completion",
  evidence_completion_enabled: true,
  evidence_completion_retrieval_disabled: true,
  catalog_enabled: false,
  vector_enabled: false,
  retrieval_application_enabled: false,
  force_retrieval_application_resolution: false,
  retrieval_application_present: false,
  retrieval_application_owns_candidate_application: false
};

const onExecution = {
  contract_id: "retrieval-application-ablation-v1",
  arm: "ON",
  terminal_path: "evidence_completion",
  evidence_completion_enabled: true,
  evidence_completion_retrieval_disabled: false,
  catalog_enabled: true,
  vector_enabled: true,
  retrieval_application_enabled: true,
  force_retrieval_application_resolution: true,
  retrieval_application_present: true,
  retrieval_application_owns_candidate_application: true
};

const dataset = {
  schema_version: "golden-sem-partition-v1",
  dataset_id: "retrieval-ablation-fixture",
  partition: "development",
  items: [
    {
      item_id: "card-1",
      reviewed_ground_truth: {
        field_statuses: confirmedStatuses,
        fields: {
          year: "2024",
          product: "Topps Chrome",
          subject: ["Test Player"],
          card_name: "Autograph"
        }
      }
    },
    {
      item_id: "card-2",
      reviewed_ground_truth: {
        field_statuses: confirmedStatuses,
        fields: {
          year: "2023",
          product: "Panini Prizm",
          subject: ["Second Player"],
          card_name: "Base"
        }
      }
    }
  ]
};

const off = {
  base_url: "https://listing.example",
  provider_success_count: 2,
  provider_success_rate: 1,
  technical_failure_count: 0,
  provider_error_count: 0,
  evaluated_cards_per_minute: 4,
  per_card_latency_ms: { p50: 15000, p95: 18000 },
  usage_totals: { input_tokens: 1000, output_tokens: 500 },
  experiment_contract: {
    contract_id: "retrieval-application-ablation-v1",
    arm: "OFF",
    provider_id: "openai_legacy",
    single_model_fast: false,
    evidence_completion_enabled: true,
    evidence_completion_retrieval_disabled: true,
    catalog_enabled: false,
    vector_enabled: false,
    retrieval_application_enabled: false,
    retrieval_prompt_context_enabled: false,
    retrieval_application_resolution_forced: false,
    external_retrieval_enabled: false,
    identity_result_cache_disabled: true,
    approved_identity_memory_disabled: true,
    corrected_title_hint_sent_to_cloud: false
  },
  results: [
    {
      item_id: "card-1",
      model_id: "gpt-5-mini",
      retrieval_prompt_context_enabled: false,
      retrieval_prompt_context_used: false,
      provider_token_diagnostics: { input_tokens: 400 },
      raw_provider_fields: {
        year: "2024",
        product: "Topps",
        players: ["Test Player"],
        card_name: "Autograph"
      },
      retrieval_ablation_execution: offExecution,
      final_title: "2024 Test Player",
      resolved_fields: {
        year: "2024",
        product: "Topps",
        players: ["Test Player"],
        card_name: "Autograph"
      }
    },
    {
      item_id: "card-2",
      model_id: "gpt-5-mini",
      retrieval_prompt_context_enabled: false,
      retrieval_prompt_context_used: false,
      provider_token_diagnostics: { input_tokens: 600 },
      raw_provider_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      },
      retrieval_ablation_execution: offExecution,
      final_title: "2023 Panini Prizm Second Player Base",
      resolved_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      }
    }
  ]
};

const on = {
  base_url: "https://listing.example",
  provider_success_count: 2,
  provider_success_rate: 1,
  technical_failure_count: 0,
  provider_error_count: 0,
  evaluated_cards_per_minute: 3.5,
  per_card_latency_ms: { p50: 17000, p95: 21000 },
  usage_totals: { input_tokens: 1100, output_tokens: 520 },
  experiment_contract: {
    contract_id: "retrieval-application-ablation-v1",
    arm: "ON",
    provider_id: "openai_legacy",
    single_model_fast: false,
    evidence_completion_enabled: true,
    evidence_completion_retrieval_disabled: false,
    catalog_enabled: true,
    vector_enabled: true,
    retrieval_application_enabled: true,
    retrieval_prompt_context_enabled: false,
    retrieval_application_resolution_forced: true,
    external_retrieval_enabled: false,
    identity_result_cache_disabled: true,
    approved_identity_memory_disabled: true,
    corrected_title_hint_sent_to_cloud: false
  },
  results: [
    {
      item_id: "card-1",
      model_id: "gpt-5-mini",
      retrieval_prompt_context_enabled: false,
      retrieval_prompt_context_used: false,
      ...confirmedSameCardExclusion("card-1"),
      provider_token_diagnostics: { input_tokens: 400 },
      raw_provider_fields: {
        card_name: "Autograph",
        players: ["Test Player"],
        product: "Topps",
        year: "2024"
      },
      retrieval_ablation_execution: onExecution,
      catalog_candidate_count: 2,
      vector_raw_candidate_count: 3,
      decision_eligible_candidate_count: 1,
      final_title: "2024 Topps Chrome Test Player Autograph",
      resolved_fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        card_name: "Autograph"
      },
      retrieval_application: {
        owns_candidate_application: true,
        selected_candidate_id: "catalog-1",
        low_margin_candidate_id: "",
        candidate_count: 5,
        field_evidence_count: 3,
        identity_evidence_count: 3,
        actual_application_count: 1,
        actual_applied_fields: ["product"],
        title_changed: true,
        title_before: "2024 Topps Test Player Autograph",
        title_after: "2024 Topps Chrome Test Player Autograph",
        decision_counts: { APPLY: 1, SUPPORT: 2, BLOCK: 0, REJECT: 0 },
        decisions: [{
          candidate_id: "catalog-1",
          candidate_lane: "catalog",
          resolver_field: "product",
          candidate_value: "Topps Chrome",
          resolver_value: "Topps Chrome",
          decision: "APPLY",
          applied_to_final: true
        }, {
          candidate_id: "catalog-1",
          candidate_lane: "catalog",
          resolver_field: "year",
          candidate_value: "2024",
          resolver_value: "2024",
          decision: "SUPPORT",
          supported_final: true
        }, {
          candidate_id: "catalog-1",
          candidate_lane: "catalog",
          resolver_field: "players",
          candidate_value: ["Test Player"],
          resolver_value: ["Test Player"],
          decision: "SUPPORT",
          supported_final: true
        }]
      },
      retrieval_evidence_isolation: {
        enabled: true,
        blocked_raw_candidate_evidence_count: 2
      }
    },
    {
      item_id: "card-2",
      model_id: "gpt-5-mini",
      retrieval_prompt_context_enabled: false,
      retrieval_prompt_context_used: false,
      ...confirmedSameCardExclusion("card-2"),
      provider_token_diagnostics: { input_tokens: 600 },
      raw_provider_fields: {
        card_name: "Base",
        players: ["Second Player"],
        product: "Panini Prizm",
        year: "2023"
      },
      retrieval_ablation_execution: onExecution,
      catalog_candidate_count: 1,
      vector_raw_candidate_count: 1,
      decision_eligible_candidate_count: 1,
      final_title: "2023 Panini Prizm Second Player Base",
      resolved_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      },
      retrieval_application: {
        owns_candidate_application: true,
        selected_candidate_id: "catalog-2",
        low_margin_candidate_id: "",
        candidate_count: 2,
        field_evidence_count: 3,
        identity_evidence_count: 3,
        actual_application_count: 0,
        actual_applied_fields: [],
        decision_counts: { APPLY: 0, SUPPORT: 3, BLOCK: 0, REJECT: 0 },
        decisions: [{
          candidate_id: "catalog-2",
          candidate_lane: "catalog",
          resolver_field: "product",
          candidate_value: "Panini Prizm",
          resolver_value: "Panini Prizm",
          decision: "SUPPORT",
          supported_final: true
        }, {
          candidate_id: "catalog-2",
          candidate_lane: "catalog",
          resolver_field: "year",
          candidate_value: "2023",
          resolver_value: "2023",
          decision: "SUPPORT",
          supported_final: true
        }, {
          candidate_id: "catalog-2",
          candidate_lane: "catalog",
          resolver_field: "players",
          candidate_value: ["Second Player"],
          resolver_value: ["Second Player"],
          decision: "SUPPORT",
          supported_final: true
        }]
      },
      retrieval_evidence_isolation: {
        enabled: true,
        blocked_raw_candidate_evidence_count: 1
      }
    }
  ]
};

function replaySemanticProjection(row = {}, enabled = false) {
  const application = enabled ? {
    ...structuredClone(row.retrieval_application || {}),
    enabled: true,
    resolver_consumed: true
  } : {
    enabled: false,
    resolver_consumed: false,
    selected_candidate_id: "",
    identity_evidence_count: 0,
    identity_evidence_fields: [],
    identity_evidence_items: [],
    decision_counts: { APPLY: 0, SUPPORT: 0, BLOCK: 0, REJECT: 0 },
    actual_application_count: 0,
    actual_applied_fields: [],
    actual_support_count: 0,
    actual_supported_fields: [],
    decisions: []
  };
  return {
    final_title: row.final_title,
    rendered_title: row.final_title,
    resolved_fields: structuredClone(row.resolved_fields || {}),
    unresolved: [],
    identity_resolution: {
      status: "RESOLVED",
      ambiguity_status: null,
      abstain_reason_codes: [],
      convergence: { max_iterations: 1, iterations: 1, converged: true }
    },
    retrieval_application: application,
    retrieval_evidence_isolation: structuredClone(row.retrieval_evidence_isolation || null)
  };
}

function replayEnvelope(offRow = {}, onRow = {}) {
  const inputFingerprint = fingerprint({
    item_id: offRow.item_id,
    provider_observation: offRow.raw_provider_fields
  });
  const offProjection = replaySemanticProjection(offRow, false);
  const onProjection = replaySemanticProjection(onRow, true);
  return {
    schema_version: "retrieval-application-replay-v1",
    shared: {
      fingerprints: { replay_input: inputFingerprint },
      projection: {
        direct_observation: {
          field_sources: {
            raw_provider_fields: structuredClone(offRow.raw_provider_fields)
          }
        }
      }
    },
    arms: {
      off: {
        input_fingerprint: inputFingerprint,
        semantic_fingerprint: fingerprint(offProjection),
        semantic_projection: offProjection
      },
      on: {
        input_fingerprint: inputFingerprint,
        semantic_fingerprint: fingerprint(onProjection),
        semantic_projection: onProjection
      }
    }
  };
}

const replayCloudReport = {
  ...structuredClone(on),
  schema_version: "cloud-listing-api-eval-v1",
  experiment_contract: null,
  results: on.results.map((onRow, index) => {
    const row = structuredClone(onRow);
    delete row.raw_provider_fields;
    delete row.retrieval_ablation_execution;
    row.technical_failure = false;
    row.retrieval_application_replay = replayEnvelope(off.results[index], onRow);
    return row;
  })
};

const report = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: on
});

assert.equal(report.cohort.same_card_cohort_complete, true);
assert.equal(report.metrics.retrieval_enabled.candidate_application_count, 1);
assert.equal(report.metrics.retrieval_enabled.title_change_count, 1);
assert.equal(report.metrics.retrieval_enabled.arm_title_delta_count, 1);
assert.equal(report.metrics.retrieval_enabled.application_title_change_count, 1);
assert.ok(report.metrics.delta.sem_field_accuracy > 0);
assert.ok(report.metrics.delta.critical_field_accuracy > 0);
assert.equal(report.metrics.delta.retrieval_recovery_count, 1);
assert.equal(report.metrics.delta.retrieval_regression_count, 0);
assert.equal(report.metrics.delta.net_benefit, 1);
assert.equal(report.per_card.find((row) => row.item_id === "card-1")?.outcome, "RECOVERY");
assert.deepEqual(report.per_card.find((row) => row.item_id === "card-1")?.retrieval_delta.improved_fields, ["product"]);
assert.deepEqual(report.per_card.find((row) => row.item_id === "card-1")?.retrieval_delta.source, ["catalog"]);
assert.equal(report.per_card.find((row) => row.item_id === "card-1")?.retrieval_delta.attribution, "FIELD_APPLICATION");
assert.equal(report.metrics.retrieval_enabled.application_funnel.retrieved_candidate_count, 7);
assert.equal(report.metrics.retrieval_enabled.application_funnel.eligible_candidate_count, 2);
assert.equal(report.metrics.retrieval_enabled.application_funnel.apply_decision_count, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.actual_applied_field_count, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_resolved_change, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_selected_candidate, 2);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_low_margin_candidate, 0);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_arm_title_delta, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_application_title_change, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.candidate_application_rate, 0.5);
assert.equal(report.metrics.retrieval_enabled.application_funnel.field_decision_counts.product.APPLY, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.field_decision_counts.year.SUPPORT, 2);
assert.equal(report.metrics.retrieval_enabled.application_funnel.decision_reason_counts.unspecified, 6);
assert.equal(report.metrics.retrieval_enabled.application_funnel.blocked_raw_candidate_evidence_count, 3);
assert.equal(report.metrics.retrieval_enabled.application_funnel.candidate_correct_but_not_applied, 0);
assert.equal(report.metrics.retrieval_enabled.application_funnel.candidate_wrong_but_applied, 0);
assert.equal(report.metrics.retrieval_enabled.application_funnel.candidate_wrong_but_supported, 0);
assert.equal(report.metrics.retrieval_enabled.candidate_correct_but_not_applied, 0);
assert.equal(report.metrics.retrieval_enabled.candidate_wrong_but_applied, 0);
assert.deepEqual(report.metrics.retrieval_enabled.blocked_by_reason, {});
assert.equal(report.metrics.retrieval_enabled.application_funnel.field_accuracy_decision_audit.product.correct_candidate_applied, 1);
assert.equal(report.metrics.retrieval_disabled.operations.per_card_latency_ms.p50, 15000);
assert.equal(report.metrics.retrieval_enabled.operations.usage_totals.output_tokens, 520);
assert.equal(report.validity.experiment.runtime_isolation.valid, true);
assert.equal(report.provider_observation_pairing.same_count, 2);
assert.equal(report.provider_observation_pairing.mismatch_count, 0);
assert.equal(report.provider_observation_pairing.missing_count, 0);
assert.deepEqual(report.provider_observation_pairing.mismatch_item_ids, []);
assert.equal(report.provider_observation_pairing.input_token_same_count, 2);
assert.equal(report.per_card[0].provider_observation_pairing, "SAME");
assert.match(report.per_card[0].provider_observation_fingerprint.retrieval_disabled, /^sha256:[a-f0-9]{64}$/);
assert.equal(
  report.per_card[0].provider_observation_fingerprint.retrieval_disabled,
  report.per_card[0].provider_observation_fingerprint.retrieval_enabled
);
assert.equal(report.causal_valid, true);
assert.equal(report.validity.causal_valid, true);
assert.equal(report.validity.causal_comparison_valid, true);

const observationMismatchOn = structuredClone(on);
observationMismatchOn.results[0].raw_provider_fields.product = "Topps Chrome";
const observationMismatchReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: observationMismatchOn
});
assert.equal(observationMismatchReport.provider_observation_pairing.same_count, 1);
assert.equal(observationMismatchReport.provider_observation_pairing.mismatch_count, 1);
assert.equal(observationMismatchReport.provider_observation_pairing.missing_count, 0);
assert.deepEqual(observationMismatchReport.provider_observation_pairing.mismatch_item_ids, ["card-1"]);
assert.equal(observationMismatchReport.validity.causal_comparison_valid, false);
assert.equal(observationMismatchReport.metrics.delta.retrieval_recovery_count, null);
assert.equal(observationMismatchReport.metrics.delta.retrieval_regression_count, null);
assert.equal(observationMismatchReport.metrics.delta.net_benefit, null);
assert.deepEqual(observationMismatchReport.metrics.delta.observed_unattributed, {
  sem_card_exact_accuracy: 0.5,
  sem_field_accuracy: 0.125,
  critical_field_accuracy: 0.25,
  recovery_count: 1,
  regression_count: 0,
  net_difference: 1
});
assert.equal(observationMismatchReport.per_card[0].outcome, "OBSERVED_UNATTRIBUTED");
assert.equal(observationMismatchReport.per_card[0].retrieval_delta.attribution, "OBSERVED_UNATTRIBUTED");

const replayOff = structuredClone(off);
const replayOn = structuredClone(on);
for (const row of replayOff.results) delete row.raw_provider_fields;
for (const row of replayOn.results) delete row.raw_provider_fields;
replayOff.experiment_contract.single_observation_deterministic_replay = true;
replayOn.experiment_contract.single_observation_deterministic_replay = true;
const deterministicReplayReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: replayOff,
  retrievalEnabledReport: replayOn
});
assert.equal(deterministicReplayReport.provider_observation_pairing.missing_count, 2);
assert.equal(deterministicReplayReport.provider_observation_pairing.single_observation_deterministic_replay_claimed, true);
assert.equal(deterministicReplayReport.provider_observation_pairing.single_observation_deterministic_replay, false);
assert.equal(deterministicReplayReport.validity.causal_comparison_valid, false);
assert.equal(deterministicReplayReport.metrics.delta.retrieval_recovery_count, null);

const splitReplay = splitRetrievalApplicationReplayReport(replayCloudReport);
assert.equal(splitReplay.off.experiment_contract.arm, "OFF");
assert.equal(splitReplay.on.experiment_contract.arm, "ON");
assert.equal(splitReplay.off.results[0].retrieval_application.enabled, false);
assert.equal(splitReplay.on.results[0].retrieval_application.enabled, true);
assert.equal(splitReplay.off.results[0].final_title, off.results[0].final_title);
assert.equal(splitReplay.on.results[0].final_title, on.results[0].final_title);

const verifiedReplayReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalApplicationReplayReport: replayCloudReport
});
assert.equal(verifiedReplayReport.comparison_mode, "SINGLE_OBSERVATION_REPLAY");
assert.equal(verifiedReplayReport.causal_valid, true);
assert.equal(verifiedReplayReport.validity.causal_valid, true);
assert.equal(verifiedReplayReport.validity.replay.valid, true);
assert.equal(verifiedReplayReport.validity.replay.schema_valid_count, 2);
assert.equal(verifiedReplayReport.validity.replay.matching_nonempty_input_fingerprint_count, 2);
assert.equal(verifiedReplayReport.validity.replay.arm_proof_valid_count, 2);
assert.deepEqual(verifiedReplayReport.validity.replay.invalid_item_ids, []);
assert.equal(verifiedReplayReport.provider_observation_pairing.single_observation_deterministic_replay, true);
assert.equal(verifiedReplayReport.metrics.delta.retrieval_recovery_count, 1);
assert.equal(verifiedReplayReport.metrics.delta.retrieval_regression_count, 0);

function assertContaminatedReplayRejected(replayReport, expectedReason, label) {
  const rejected = evaluateRetrievalApplicationAblation({
    dataset,
    retrievalApplicationReplayReport: replayReport
  });
  assert.equal(rejected.causal_valid, false, label);
  assert.equal(rejected.validity.causal_valid, false, label);
  assert.equal(rejected.causal_invalid_reasons.includes(expectedReason), true, label);
  assert.equal(rejected.validity.invalid_reasons.includes(expectedReason), true, label);
  assert.deepEqual(
    rejected.validity.causal_input_isolation.invalid_reason_item_ids[expectedReason],
    ["card-1"],
    label
  );
  assert.equal(rejected.metrics.delta.sem_card_exact_accuracy, null, label);
  assert.equal(rejected.metrics.delta.sem_field_accuracy, null, label);
  assert.equal(rejected.metrics.delta.critical_field_accuracy, null, label);
  assert.equal(rejected.metrics.delta.retrieval_recovery_count, null, label);
  assert.equal(rejected.metrics.delta.retrieval_regression_count, null, label);
  assert.equal(rejected.metrics.delta.net_benefit, null, label);
  assert.equal(rejected.metrics.delta.observed_unattributed.recovery_count, 1, label);
  assert.equal(rejected.per_card.find((row) => row.item_id === "card-1")?.outcome, "OBSERVED_UNATTRIBUTED", label);
}

// Repro 1: replay input was observed with prompt-time retrieval context, or
// the report cannot prove that context was explicitly disabled.
const promptContextContaminatedReplay = structuredClone(replayCloudReport);
delete promptContextContaminatedReplay.results[0].retrieval_prompt_context_enabled;
assertContaminatedReplayRejected(
  promptContextContaminatedReplay,
  retrievalCausalInvalidReasons.RETRIEVAL_PROMPT_CONTEXT_NOT_EXPLICITLY_DISABLED,
  "retrieval prompt context not explicitly disabled"
);

// Repro 2: exclusion confirmation and returned-self checks are independent.
for (const testCase of [{
  name: "same-card exclusion not confirmed",
  reason: retrievalCausalInvalidReasons.EXCLUSION_CONFIRMED_NOT_TRUE,
  mutate(row) {
    row.exclusion_confirmed = false;
    row.exclusion_observation.exclusion_confirmed = false;
  }
}, {
  name: "same-card candidate returned",
  reason: retrievalCausalInvalidReasons.RETURNED_SELF_CANDIDATE_COUNT_POSITIVE,
  mutate(row) {
    row.returned_self_candidate_count = 1;
    row.exclusion_observation.returned_self_candidate_count = 1;
  }
}]) {
  const contaminated = structuredClone(replayCloudReport);
  testCase.mutate(contaminated.results[0]);
  assertContaminatedReplayRejected(contaminated, testCase.reason, testCase.name);
}

// Repro 3: aggregate booleans are not a substitute for per-card exclusion evidence.
const missingSameCardEvidenceReplay = structuredClone(replayCloudReport);
delete missingSameCardEvidenceReplay.results[0].exclusion_observation;
assertContaminatedReplayRejected(
  missingSameCardEvidenceReplay,
  retrievalCausalInvalidReasons.SAME_CARD_EXCLUSION_EVIDENCE_MISSING,
  "same-card exclusion evidence missing"
);

const invalidReplayCases = [{
  name: "wrong replay schema",
  mutate(report) {
    report.results[0].retrieval_application_replay.schema_version = "retrieval-application-replay-v0";
  }
}, {
  name: "empty replay input fingerprint",
  mutate(report) {
    const replay = report.results[0].retrieval_application_replay;
    replay.shared.fingerprints.replay_input = "";
    replay.arms.off.input_fingerprint = "";
    replay.arms.on.input_fingerprint = "";
  }
}, {
  name: "mismatched replay input fingerprint",
  mutate(report) {
    report.results[0].retrieval_application_replay.arms.on.input_fingerprint = fingerprint({ forged: true });
  }
}, {
  name: "forged ON arm state",
  mutate(report) {
    const arm = report.results[0].retrieval_application_replay.arms.on;
    arm.semantic_projection.retrieval_application.enabled = false;
    arm.semantic_fingerprint = fingerprint(arm.semantic_projection);
  }
}, {
  name: "stale semantic fingerprint",
  mutate(report) {
    report.results[0].retrieval_application_replay.arms.on.semantic_projection.final_title = "forged title";
  }
}];

for (const testCase of invalidReplayCases) {
  const invalidReplay = structuredClone(replayCloudReport);
  testCase.mutate(invalidReplay);
  const invalidReplayReport = evaluateRetrievalApplicationAblation({
    dataset,
    retrievalApplicationReplayReport: invalidReplay
  });
  assert.equal(invalidReplayReport.causal_valid, false, testCase.name);
  assert.equal(invalidReplayReport.metrics.delta.retrieval_recovery_count, null, testCase.name);
  assert.deepEqual(invalidReplayReport.validity.replay.invalid_item_ids, ["card-1"], testCase.name);
}

const wrongAppliedOn = structuredClone(on);
wrongAppliedOn.results[0].retrieval_application.decisions[0].candidate_value = "Panini Select";
wrongAppliedOn.results[0].retrieval_application.decisions[0].resolver_value = "Panini Select";
const wrongAppliedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: wrongAppliedOn
});
assert.equal(wrongAppliedReport.metrics.retrieval_enabled.application_funnel.candidate_wrong_but_applied, 1);
assert.equal(wrongAppliedReport.metrics.retrieval_enabled.application_funnel.unique_card_field_candidate_wrong_but_applied, 1);
assert.equal(wrongAppliedReport.metrics.retrieval_enabled.candidate_wrong_but_applied, 1);

const wrongSupportedOn = structuredClone(on);
wrongSupportedOn.results[0].retrieval_application.decisions[0].candidate_value = "Bowman Chrome";
wrongSupportedOn.results[0].retrieval_application.decisions[0].resolver_value = "Bowman Chrome";
wrongSupportedOn.results[0].retrieval_application.decisions[0].decision = "SUPPORT";
wrongSupportedOn.results[0].retrieval_application.decisions[0].applied_to_final = false;
wrongSupportedOn.results[0].retrieval_application.decisions[0].supported_final = true;
const wrongSupportedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: wrongSupportedOn
});
assert.equal(wrongSupportedReport.metrics.retrieval_enabled.application_funnel.candidate_wrong_but_supported, 1);
assert.equal(wrongSupportedReport.metrics.retrieval_enabled.application_funnel.candidate_wrong_but_influential, 1);
assert.equal(wrongSupportedReport.metrics.retrieval_enabled.application_funnel.unique_card_field_candidate_wrong_but_supported, 1);
assert.equal(wrongSupportedReport.metrics.retrieval_enabled.application_funnel.unique_card_field_candidate_wrong_but_influential, 1);

const correctBlockedOn = structuredClone(on);
correctBlockedOn.results[0].resolved_fields.product = "Topps";
correctBlockedOn.results[0].final_title = "2024 Topps Test Player Autograph";
correctBlockedOn.results[0].retrieval_application.decisions[0].decision = "BLOCK";
correctBlockedOn.results[0].retrieval_application.decisions[0].reason = "field_not_in_safe_application_plan";
correctBlockedOn.results[0].retrieval_application.decisions[0].applied_to_final = false;
correctBlockedOn.results[0].retrieval_application.decisions[0].resolver_value = "Topps";
correctBlockedOn.results[0].retrieval_application.actual_application_count = 0;
correctBlockedOn.results[0].retrieval_application.actual_applied_fields = [];
const correctBlockedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: correctBlockedOn
});
assert.equal(correctBlockedReport.metrics.retrieval_enabled.application_funnel.candidate_correct_but_not_applied, 1);
assert.equal(correctBlockedReport.metrics.retrieval_enabled.application_funnel.blocked_by_reason.field_not_in_safe_application_plan, 1);
assert.equal(correctBlockedReport.metrics.retrieval_enabled.candidate_correct_but_not_applied, 1);
assert.equal(correctBlockedReport.metrics.retrieval_enabled.blocked_by_reason.field_not_in_safe_application_plan, 1);

const correctResolvedButNotRenderedOn = structuredClone(on);
correctResolvedButNotRenderedOn.results[0].final_title = "2024 Test Player Autograph";
correctResolvedButNotRenderedOn.results[0].resolved_fields.product = "";
correctResolvedButNotRenderedOn.results[0].retrieval_application.decisions[0].decision = "BLOCK";
correctResolvedButNotRenderedOn.results[0].retrieval_application.decisions[0].reason = "field_not_in_safe_application_plan";
correctResolvedButNotRenderedOn.results[0].retrieval_application.decisions[0].applied_to_final = false;
correctResolvedButNotRenderedOn.results[0].retrieval_application.actual_application_count = 0;
correctResolvedButNotRenderedOn.results[0].retrieval_application.actual_applied_fields = [];
const correctResolvedButNotRenderedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: correctResolvedButNotRenderedOn
});
assert.equal(
  correctResolvedButNotRenderedReport.metrics.retrieval_enabled.application_funnel.candidate_correct_but_not_applied,
  0,
  "a correct value already present in the resolver is not a retrieval application miss"
);
assert.equal(
  correctResolvedButNotRenderedReport.metrics.retrieval_enabled.application_funnel.candidate_correct_resolver_already_correct_but_not_rendered,
  1,
  "resolver-to-renderer loss is reported separately from candidate application"
);

const leakedOff = structuredClone(off);
leakedOff.results[0].catalog_candidate_count = 1;
leakedOff.results[0].retrieval_providers_used = ["postgres_hybrid"];
const leakedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: leakedOff,
  retrievalEnabledReport: on
});
assert.equal(leakedReport.validity.experiment.runtime_isolation.valid, false);
assert.equal(leakedReport.validity.experiment.runtime_isolation.retrieval_off_leak_count, 1);
assert.equal(leakedReport.validity.causal_comparison_valid, false);

const shortCircuitedOn = structuredClone(on);
shortCircuitedOn.results[0].retrieval_ablation_execution = {
  ...shortCircuitedOn.results[0].retrieval_ablation_execution,
  terminal_path: "single_model_draft",
  retrieval_application_present: false,
  retrieval_application_owns_candidate_application: false
};
const shortCircuitedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: shortCircuitedOn
});
assert.equal(shortCircuitedReport.validity.experiment.runtime_isolation.valid, false);
assert.equal(shortCircuitedReport.validity.experiment.runtime_isolation.retrieval_on_execution_mismatch_count, 1);
assert.equal(shortCircuitedReport.validity.causal_comparison_valid, false);

console.log("retrieval application ablation tests passed");
