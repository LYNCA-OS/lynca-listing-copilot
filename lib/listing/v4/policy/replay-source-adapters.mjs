import {
  buildFullInformationReplay,
  fullInformationReplaySchemaVersion
} from "./full-information-replay.mjs";
import {
  nonTerminalRecognitionActions,
  recognitionPolicyActions
} from "./optimal-recognition-policy.mjs";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalMetric(field, value) {
  const number = finiteNumber(value, null);
  return number === null ? {} : { [field]: number };
}

function attemptedFromFunnel(funnel = {}) {
  const source = plainObject(funnel);
  return source.query_attempted === true
    || source.pre_observation_query_attempted === true
    || source.post_observation_query_attempted === true;
}

function sourceRef(input = {}, index = 0) {
  return cleanText(input.source_ref || input.path || input.name) || `source-${index + 1}`;
}

function workflowSmokeCards(document = {}, ref = "") {
  return (Array.isArray(document.results) ? document.results : []).map((row, index) => {
    const candidateDebug = plainObject(row.l2_candidate_debug);
    const catalog = plainObject(candidateDebug.catalog_activation_funnel);
    const vector = plainObject(candidateDebug.vector_activation_funnel);
    const provider = plainObject(row.l2_provider_diagnostics || row.provider_diagnostics);
    const shadowAudit = plainObject(row.v4_pipeline_contract?.shadow_recognition_policy);
    const observations = [];
    if (document.prewarm_enabled || row.prewarm_enabled || row.prewarm_status || row.fast_scout_prewarmer_used) {
      observations.push({
        action: recognitionPolicyActions.RUN_CHEAP_EVIDENCE,
        status: row.prewarm_status === "FAILED" ? "FAILED" : "SUCCESS",
        technical_success: row.prewarm_status === "FAILED" ? false : true,
        ...optionalMetric("latency_ms", row.prewarm_latency_ms ?? row.cached_fast_scout_source_latency_ms),
        metadata: { source: "workflow_smoke_prewarm" }
      });
    }
    if (attemptedFromFunnel(catalog)) {
      observations.push({
        action: recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP,
        status: "SUCCESS",
        technical_success: true,
        ...optionalMetric("latency_ms", row.v4_l2_timing?.catalog_ms),
        metadata: {
          raw_candidate_count: finiteNumber(catalog.raw_candidate_count, 0),
          prompt_candidate_count: finiteNumber(catalog.prompt_candidate_count, 0),
          applied_field_count: finiteNumber(catalog.applied_field_count, 0)
        }
      });
    }
    if (row.http_status || row.ok !== undefined || Object.keys(provider).length) {
      observations.push({
        action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
        status: row.ok === false ? "FAILED" : "SUCCESS",
        technical_success: row.ok !== false,
        ...optionalMetric("latency_ms", provider.provider_latency_ms ?? row.provider_latency_ms),
        ...optionalMetric("cost_units", row.estimated_cost_usd),
        metadata: {
          input_tokens: finiteNumber(provider.input_tokens ?? row.input_tokens, 0),
          output_tokens: finiteNumber(provider.output_tokens ?? row.output_tokens, 0),
          response_status: provider.response_status || row.response_status || null
        }
      });
    }
    if (attemptedFromFunnel(vector)) {
      const timedOut = vector.vector_runtime_status === "TIMEOUT"
        || vector.vector_worker_status === "VECTOR_RETRIEVAL_TIMEOUT";
      observations.push({
        action: recognitionPolicyActions.RUN_VECTOR_RETRIEVAL,
        status: timedOut ? "TIMEOUT" : "SUCCESS",
        technical_success: !timedOut,
        ...optionalMetric("latency_ms", vector.vector_worker_latency_ms ?? row.vector_worker_latency_ms),
        metadata: {
          raw_candidate_count: finiteNumber(vector.raw_candidate_count, 0),
          prompt_candidate_count: finiteNumber(vector.prompt_candidate_count, 0),
          applied_field_count: finiteNumber(vector.applied_field_count, 0)
        }
      });
    }
    return {
      query_card_id: row.asset_id || row.job_id || `workflow-${index + 1}`,
      cohort: document.cohort || document.dataset_path || "WORKFLOW_SMOKE",
      truth: { provenance: "TITLE_PROXY_ONLY", fields: {} },
      expected_actions: nonTerminalRecognitionActions,
      action_observations: observations,
      policy_state_snapshots: shadowAudit.state ? [{
        snapshot_id: `${row.asset_id || row.job_id || `workflow-${index + 1}`}:terminal`,
        observation_point: shadowAudit.observation_point || "TERMINAL_PIPELINE_STATE",
        state: shadowAudit.state,
        observed_next_action: null,
        source: "v4_pipeline_contract"
      }] : [],
      current_final_fields: row.final_fields || row.resolved_fields || {},
      proxy_labels: {
        seller_title: row.seller_title || null,
        reviewed_title: row.reviewed_reference_title || null,
        policy_fair_token_recall: row.final_scoring?.policy_fair_token_recall ?? null
      },
      source_refs: [ref]
    };
  });
}

function retrievalAuditCards(document = {}, ref = "") {
  return (Array.isArray(document.per_card) ? document.per_card : []).map((row, index) => {
    const sources = plainObject(row.retrieval_participation?.sources);
    const observations = [];
    const catalog = plainObject(sources.catalog);
    if (catalog.query_attempted) {
      observations.push({
        action: recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP,
        status: "SUCCESS",
        technical_success: true,
        ...optionalMetric("latency_ms", catalog.latency_ms),
        metadata: {
          retrieval_available: catalog.retrieval_available === true,
          raw_candidate_count: finiteNumber(catalog.raw_candidate_count, 0),
          applied_field_count: finiteNumber(catalog.applied_field_count, 0)
        }
      });
    }
    const vector = plainObject(sources.vector);
    if (vector.query_attempted) {
      observations.push({
        action: recognitionPolicyActions.RUN_VECTOR_RETRIEVAL,
        status: "SUCCESS",
        technical_success: true,
        ...optionalMetric("latency_ms", vector.latency_ms),
        metadata: {
          retrieval_available: vector.retrieval_available === true,
          raw_candidate_count: finiteNumber(vector.raw_candidate_count, 0),
          applied_field_count: finiteNumber(vector.applied_field_count, 0)
        }
      });
    }
    return {
      query_card_id: row.asset_id || row.job_id || `retrieval-audit-${index + 1}`,
      cohort: document.cohort || "RETRIEVAL_AUDIT",
      truth: { provenance: "TITLE_PROXY_ONLY", fields: {} },
      expected_actions: nonTerminalRecognitionActions,
      action_observations: observations,
      proxy_labels: {
        reviewed_reference_title: row.reviewed_reference_title || null,
        policy_fair_token_recall: row.scoring?.policy_fair_token_recall ?? null
      },
      source_refs: [ref]
    };
  });
}

function goldenDatasetCards(document = {}, ref = "") {
  const splits = plainObject(document.splits);
  return Object.entries(splits).flatMap(([split, rows]) => (Array.isArray(rows) ? rows : []).map((row, index) => ({
    query_card_id: row.asset_id || `${split}-${index + 1}`,
    cohort: split,
    truth: {
      provenance: "DEVELOPMENT_FIXTURE_FIELDS",
      fields: row.ground_truth_fields || {},
      critical_fields: row.critical_fields || []
    },
    expected_actions: nonTerminalRecognitionActions,
    action_observations: row.prediction ? [{
      action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
      status: "SUCCESS",
      technical_success: true,
      ...optionalMetric("latency_ms", row.prediction.usage?.latency_ms),
      ...optionalMetric("cost_units", row.prediction.usage?.estimated_cost_usd),
      field_predictions: row.prediction.resolved_fields || {},
      metadata: { provider: row.prediction.provider || null, model_id: row.prediction.model_id || null }
    }] : [],
    current_final_fields: row.prediction?.resolved_fields || {},
    source_refs: [ref]
  })));
}

function imageDetailAblationCards(document = {}, ref = "") {
  return (Array.isArray(document.pairs) ? document.pairs : []).map((row, index) => ({
    query_card_id: row.asset_id || `image-detail-${index + 1}`,
    cohort: "IMAGE_DETAIL_ABLATION",
    truth: { provenance: "TITLE_PROXY_ONLY", fields: {} },
    expected_actions: [recognitionPolicyActions.RUN_GPT_OBSERVATION],
    action_observations: [
      {
        action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
        variant: "high",
        status: row.baseline_completed ? "SUCCESS" : "FAILED",
        technical_success: row.baseline_completed === true,
        ...optionalMetric("latency_ms", row.baseline_provider_latency_ms)
      },
      {
        action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
        variant: "auto",
        status: row.compact_completed ? "SUCCESS" : "FAILED",
        technical_success: row.compact_completed === true,
        ...optionalMetric("latency_ms", row.compact_provider_latency_ms)
      }
    ],
    proxy_labels: { seller_title: row.seller_title_weak_label || null },
    source_refs: [ref]
  }));
}

export function adaptReplaySourceDocument(document = {}, { sourceRef: ref = "" } = {}) {
  if (document.schema_version === fullInformationReplaySchemaVersion && Array.isArray(document.cards)) {
    return document.cards;
  }
  if (document.schema_version === "golden-dataset-v1" || document.splits) {
    return goldenDatasetCards(document, ref);
  }
  if (Array.isArray(document.per_card) && document.schema_version?.includes("retrieval")) {
    return retrievalAuditCards(document, ref);
  }
  if (Array.isArray(document.pairs) && document.schema_version?.includes("image-detail")) {
    return imageDetailAblationCards(document, ref);
  }
  if (Array.isArray(document.results)) return workflowSmokeCards(document, ref);
  if (Array.isArray(document.cards)) return document.cards;
  return [];
}

export function buildReplayFromSourceDocuments(inputs = [], metadata = {}) {
  const cardsById = new Map();
  const refs = [];
  (Array.isArray(inputs) ? inputs : []).forEach((input, index) => {
    const ref = sourceRef(input, index);
    refs.push(ref);
    for (const card of adaptReplaySourceDocument(input.document || input, { sourceRef: ref })) {
      const cardId = cleanText(card.query_card_id || card.asset_id || card.card_id);
      const existing = cardsById.get(cardId);
      if (!existing) {
        cardsById.set(cardId, card);
        continue;
      }
      const existingTruthFields = Object.keys(plainObject(existing.truth?.fields)).length;
      const incomingTruthFields = Object.keys(plainObject(card.truth?.fields)).length;
      cardsById.set(cardId, {
        ...existing,
        cohort: existing.cohort === card.cohort ? existing.cohort : "MULTI_SOURCE",
        truth: incomingTruthFields > existingTruthFields ? card.truth : existing.truth,
        expected_actions: [...new Set([...(existing.expected_actions || []), ...(card.expected_actions || [])])],
        action_observations: [...(existing.action_observations || []), ...(card.action_observations || [])],
        policy_state_snapshots: [
          ...(existing.policy_state_snapshots || []),
          ...(card.policy_state_snapshots || [])
        ],
        current_path: [...new Set([...(existing.current_path || []), ...(card.current_path || [])])],
        proxy_labels: { ...plainObject(existing.proxy_labels), ...plainObject(card.proxy_labels) },
        source_refs: [...new Set([...(existing.source_refs || []), ...(card.source_refs || [])])]
      });
    }
  });
  return buildFullInformationReplay({ cards: [...cardsById.values()], sourceRefs: refs, metadata });
}
