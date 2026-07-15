import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analyzeCardEvidenceWithOpenAiEmergency,
  openAiEmergencyConfigFromEnv
} from "../lib/listing/providers/openai-emergency-provider.mjs";
import {
  clearProviderConcurrencyForTests,
  providerServerConcurrencyLimit,
  runWithProviderConcurrency
} from "../lib/listing/providers/provider-concurrency.mjs";
import { openAiResponsesModelControls, openAiResponsesTextOptions } from "../lib/listing/providers/openai-responses-request.mjs";
import { parseProviderMessagePayload } from "../lib/listing/providers/provider-response-normalizer.mjs";
import { listAvailableVisionProviders, selectVisionProvider } from "../lib/listing/providers/provider-registry.mjs";
import {
  postObservationCatalogVectorHedgeMs,
  postObservationExactAnchorCatalogBudgetMs,
  postObservationStructuredAnchorCatalogBudgetMs,
  postObservationRetrievalCriticalPathBudgetMs,
  postObservationRetrievalDeadlineEnabled,
  ultraFastImageDetail,
  ultraFastTextVerbosity,
  ultraFastServiceTier,
  vectorEmbeddingWarmupOptions
} from "../lib/listing/pipeline/provider-options.mjs";
import { __listingCopilotTitleTestHooks } from "../api/listing-copilot-title.js";

const providerRegistrySource = await readFile("lib/listing/providers/provider-registry.mjs", "utf8");
const providerContractSource = await readFile("lib/listing/providers/provider-contract.mjs", "utf8");
const titleApiSource = await readFile("api/listing-copilot-title.js", "utf8");

const vectorOnlyWarmup = vectorEmbeddingWarmupOptions({
  enable_catalog_assist: true,
  enable_vector_assist: true,
  enable_hybrid_retrieval: true,
  enable_advanced_retrieval: true
}, { VECTOR_QUERY_TIMEOUT_MS: "20000" });
assert.equal(vectorOnlyWarmup.enable_catalog_assist, false);
assert.equal(vectorOnlyWarmup.enable_vector_assist, true);
assert.equal(vectorOnlyWarmup.enable_vector_retrieval, true);
assert.equal(vectorOnlyWarmup.enable_hybrid_retrieval, false);
assert.equal(vectorOnlyWarmup.enable_advanced_retrieval, false);

assert.doesNotMatch(providerRegistrySource, /cascade_fast|ENABLE_FAST_CASCADE_PROVIDER/i, "provider registry must not expose cascade providers");
assert.doesNotMatch(providerContractSource, /cascade_fast/i, "provider contract must only keep active providers");
assert.doesNotMatch(titleApiSource, /createCascadeFastTitle|model_to_model/i, "title API must not retain automatic mixed-model provider paths");

const remoteImages = [{ url: "https://example.com/front.jpg" }];
const dataUrlImages = [{ dataUrl: "data:image/jpeg;base64,AAAA" }];
const storedImages = [{ objectPath: "listing-assets/2026-06-22/asset/front_original-image.jpg" }];

const env = {
  DEFAULT_VISION_PROVIDER: "",
  ENABLE_OPENAI_PROVIDER: "true",
  ALLOW_EXPLICIT_OPENAI_RETRY: "true",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_LISTING_MODEL: "gpt-4.1-mini-2025-04-14"
};

assert.equal(selectVisionProvider({ images: remoteImages, env }).provider_id, "openai_legacy");
assert.equal(selectVisionProvider({ images: storedImages, env }).provider_id, "openai_legacy");
assert.equal(selectVisionProvider({ images: dataUrlImages, env }).provider_id, "openai_legacy");

assert.throws(
  () => selectVisionProvider({ requestedProvider: "cascade_fast", images: remoteImages, env }),
  /Unknown vision provider/i
);
assert.throws(
  () => selectVisionProvider({ requestedProvider: "removed_legacy_provider", images: remoteImages, env }),
  /Unknown vision provider/i
);

assert.equal(selectVisionProvider({
  requestedProvider: "openai_legacy",
  explicitEmergency: false,
  images: dataUrlImages,
  env
}).provider_id, "openai_legacy", "GPT is now the production primary provider and should not require emergency mode");

const emergencySelection = selectVisionProvider({
  requestedProvider: "openai_legacy",
  explicitEmergency: true,
  images: dataUrlImages,
  env
});
assert.equal(emergencySelection.provider_id, "openai_legacy");
assert.equal(emergencySelection.model_id, "gpt-4.1-mini-2025-04-14");
assert.equal(emergencySelection.provider.role, "primary");

assert.equal(selectVisionProvider({
  images: dataUrlImages,
  env: {
    ...env,
    DEFAULT_VISION_PROVIDER: "openai_legacy"
  }
}).provider_id, "openai_legacy", "OpenAI should be usable as the production env default");

assert.throws(
  () => selectVisionProvider({
    requestedProvider: "removed_provider",
    images: remoteImages,
    env
  }),
  /Unknown vision provider/i
);
assert.throws(
  () => selectVisionProvider({
    requestedProvider: "openai_legacy",
    explicitEmergency: true,
    images: dataUrlImages,
    env: {
      ...env,
      OPENAI_LISTING_MODEL: "gpt-5"
    }
  }),
  /model_not_allowed/i
);

assert.deepEqual(listAvailableVisionProviders(env).map((provider) => provider.id), ["openai_legacy"]);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ENABLE_EXPERIMENTAL_PROVIDER_UI: "true"
}).map((provider) => provider.id), ["openai_legacy"]);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ENABLE_OPENAI_PROVIDER: "false"
}).map((provider) => provider.id), []);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ALLOW_EXPLICIT_OPENAI_RETRY: "false"
}).map((provider) => provider.id), ["openai_legacy"]);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ENABLE_OPENAI_PROVIDER: "",
  ENABLE_GPT41_EMERGENCY_PROVIDER: "false"
}).map((provider) => provider.id), [], "legacy enable flag remains a compatibility fallback");

const vectorDefaultEnv = {
  ...env,
  ENABLE_VECTOR_ASSIST_DEFAULT: "true",
  ENABLE_VECTOR_RETRIEVAL: "true",
  VECTOR_RETRIEVAL_MODE: "assist"
};
const fastPathOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: { single_model_fast: true }
}, vectorDefaultEnv);
assert.equal(fastPathOptions.enable_vector_retrieval, false, "single-model fast path must not inherit blocking vector retrieval defaults");
assert.equal(fastPathOptions.vector_retrieval_mode, "off");
assert.equal(fastPathOptions.enable_query_visual_embeddings, false);

const explicitVectorOffOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: { enable_vector_assist: false }
}, vectorDefaultEnv);
assert.equal(explicitVectorOffOptions.enable_vector_retrieval, false, "explicit vector assist off must also disable query embedding");
assert.equal(explicitVectorOffOptions.enable_stored_visual_features, false);
assert.equal(explicitVectorOffOptions.enable_query_visual_embeddings, false);

assert.equal(
  __listingCopilotTitleTestHooks.forceRetrievalApplicationResolutionEnabled({
    force_retrieval_application_resolution: true
  }),
  true,
  "retrieval ablation ON must bypass the assist-shadow early return and reach the application resolver"
);
assert.equal(
  __listingCopilotTitleTestHooks.forceRetrievalApplicationResolutionEnabled({}),
  false,
  "production behavior must remain unchanged unless the ablation explicitly forces application resolution"
);

const explicitVectorOnOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: {
    enable_vector_assist: false,
    enable_vector_retrieval: true,
    vector_retrieval_mode: "assist"
  }
}, vectorDefaultEnv);
assert.equal(explicitVectorOnOptions.enable_vector_retrieval, true, "explicit retrieval config can still force vector experiments");
assert.equal(explicitVectorOnOptions.vector_retrieval_mode, "assist");
const ultraFastEnvOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({}, {
  ...env,
  ENABLE_V4_ULTRA_FAST_L2: "true",
  ENABLE_V4_ULTRA_SPARSE_TRANSPORT: "true",
  V4_ULTRA_FAST_IMAGE_DETAIL: "high",
  V4_ULTRA_FAST_TEXT_VERBOSITY: "medium",
  V4_ULTRA_FAST_SERVICE_TIER: "priority"
});
assert.equal(ultraFastEnvOptions.v4_ultra_fast_l2, true);
assert.equal(ultraFastEnvOptions.v4_ultra_sparse_transport, true);
assert.equal(ultraFastImageDetail(ultraFastEnvOptions), "high");
assert.equal(ultraFastTextVerbosity(ultraFastEnvOptions), "medium");
assert.equal(ultraFastServiceTier(ultraFastEnvOptions), "priority");
assert.equal(__listingCopilotTitleTestHooks.providerDoneCapacityHandoffEnabled({}, {}), true);
assert.equal(__listingCopilotTitleTestHooks.providerDoneCapacityHandoffEnabled({
  provider_options: { v4_provider_done_capacity_handoff: false }
}, {}), false);
assert.equal(__listingCopilotTitleTestHooks.providerDoneCapacityHandoffEnabled({
  provider_options: { v4_provider_done_capacity_handoff: true }
}, {}), true);
assert.equal(__listingCopilotTitleTestHooks.canOverlapProviderCapacityHandoffAfterInitialCall({
  assistShadowOnly: true
}), true, "provider-terminal shadow work should overlap the next card's provider stage");
assert.equal(__listingCopilotTitleTestHooks.canOverlapProviderCapacityHandoffAfterInitialCall({
  assistShadowOnly: false
}), false, "paths that may still invoke a focused verifier must retain their provider lease");

const ultraFastPayloadOverrideOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: {
    v4_ultra_fast_l2: false,
    v4_ultra_fast_image_detail: "auto",
    v4_ultra_fast_text_verbosity: "low",
    v4_ultra_fast_service_tier: "default"
  }
}, {
  ...env,
  ENABLE_V4_ULTRA_FAST_L2: "true",
  V4_ULTRA_FAST_IMAGE_DETAIL: "high",
  V4_ULTRA_FAST_SERVICE_TIER: "priority"
});
assert.equal(ultraFastPayloadOverrideOptions.v4_ultra_fast_l2, false, "explicit eval payload must override the production default");
assert.equal(ultraFastImageDetail(ultraFastPayloadOverrideOptions), "auto");
assert.equal(ultraFastTextVerbosity(ultraFastPayloadOverrideOptions), "low");
assert.equal(ultraFastServiceTier(ultraFastPayloadOverrideOptions), "default");
assert.equal(postObservationCatalogVectorHedgeMs({}, {}), 900);
assert.equal(postObservationCatalogVectorHedgeMs({}, { post_observation_catalog_vector_hedge_ms: 250 }), 250);
assert.equal(postObservationCatalogVectorHedgeMs({}, { post_observation_catalog_vector_hedge_ms: 20 }), 100);
assert.equal(postObservationCatalogVectorHedgeMs({}, { post_observation_catalog_vector_hedge_ms: 9000 }), 5000);
assert.equal(postObservationCatalogVectorHedgeMs({}, { v4_ultra_fast_l2: true }), 100);
assert.equal(postObservationCatalogVectorHedgeMs({ ENABLE_V4_ULTRA_FAST_L2: "true" }, {}), 100);
assert.equal(postObservationRetrievalDeadlineEnabled({}, {}), true);
assert.equal(postObservationRetrievalDeadlineEnabled({ ENABLE_POST_OBSERVATION_RETRIEVAL_DEADLINE: "false" }, {}), false);
assert.equal(postObservationRetrievalDeadlineEnabled({}, { enable_post_observation_retrieval_deadline: false }), false);
assert.equal(postObservationRetrievalCriticalPathBudgetMs({}, {}), 1800);
assert.equal(postObservationRetrievalCriticalPathBudgetMs({}, { post_observation_retrieval_critical_path_budget_ms: 900 }), 900);
assert.equal(postObservationRetrievalCriticalPathBudgetMs({}, { post_observation_retrieval_critical_path_budget_ms: 20 }), 250);
assert.equal(postObservationRetrievalCriticalPathBudgetMs({}, { post_observation_retrieval_critical_path_budget_ms: 20000 }), 10000);
assert.equal(postObservationRetrievalCriticalPathBudgetMs({}, { v4_ultra_fast_l2: true }), 250);
assert.equal(postObservationRetrievalCriticalPathBudgetMs({ ENABLE_V4_ULTRA_FAST_L2: "true" }, {}), 250);
assert.equal(postObservationExactAnchorCatalogBudgetMs({}, {}), 1800);
assert.equal(postObservationExactAnchorCatalogBudgetMs({}, { v4_ultra_fast_l2: true }), 5000);
assert.equal(postObservationExactAnchorCatalogBudgetMs({}, { post_observation_exact_anchor_catalog_budget_ms: 20 }), 250);
assert.equal(postObservationExactAnchorCatalogBudgetMs({}, { post_observation_exact_anchor_catalog_budget_ms: 9000 }), 5000);
assert.equal(postObservationStructuredAnchorCatalogBudgetMs({}, {}), 1800);
assert.equal(postObservationStructuredAnchorCatalogBudgetMs({}, { v4_ultra_fast_l2: true }), 5000);
assert.equal(postObservationStructuredAnchorCatalogBudgetMs({}, { post_observation_structured_anchor_catalog_budget_ms: 20 }), 250);
assert.equal(postObservationStructuredAnchorCatalogBudgetMs({}, { post_observation_structured_anchor_catalog_budget_ms: 9000 }), 5000);
assert.equal(ultraFastImageDetail({}), "auto");
assert.equal(ultraFastImageDetail({ v4_ultra_fast_image_detail: "low" }), "low");
assert.equal(ultraFastImageDetail({ v4UltraFastImageDetail: "HIGH" }), "high");
assert.equal(ultraFastImageDetail({ v4_ultra_fast_image_detail: "invalid" }), "auto");
assert.equal(ultraFastTextVerbosity({}), "medium");
assert.equal(ultraFastTextVerbosity({ v4_ultra_fast_text_verbosity: "low" }), "low");
assert.equal(ultraFastTextVerbosity({ v4UltraFastTextVerbosity: "HIGH" }), "high");
assert.equal(ultraFastTextVerbosity({ v4_ultra_fast_text_verbosity: "invalid" }), "medium");
assert.equal(ultraFastServiceTier({}), null);
assert.equal(ultraFastServiceTier({ v4_ultra_fast_service_tier: "priority" }), "priority");
assert.equal(ultraFastServiceTier({ v4UltraFastServiceTier: "FLEX" }), "flex");
assert.equal(ultraFastServiceTier({ v4_ultra_fast_service_tier: "invalid" }), null);
assert.equal(__listingCopilotTitleTestHooks.preingestionOcrPostProviderWaitMs({}, {}), 0);
assert.equal(__listingCopilotTitleTestHooks.preingestionOcrPostProviderWaitMs({
  PREINGESTION_OCR_POST_PROVIDER_WAIT_MS: "1200"
}, {}), 1200);
assert.equal(__listingCopilotTitleTestHooks.preingestionOcrPostProviderWaitMs({
  PREINGESTION_OCR_POST_PROVIDER_WAIT_MS: "0"
}, {}), 0);
assert.equal(__listingCopilotTitleTestHooks.preingestionOcrPostProviderWaitMs({}, {
  preingestion_ocr_post_provider_wait_ms: 400
}), 400);
assert.deepEqual(__listingCopilotTitleTestHooks.deferredPreingestionOcrSnapshot({
  preingestion_evidence_patches: [
    { field: "serial_number", value: "2/3" },
    { field: "grade_company", value: "BGS" }
  ]
}), {
  status: "DEFERRED_AFTER_PROVIDER",
  terminal: false,
  job_count: null,
  patch_count: 2,
  serial_patch_count: 1,
  evidence_patches: [
    { field: "serial_number", value: "2/3" },
    { field: "grade_company", value: "BGS" }
  ],
  reason: "ocr_continues_in_background_after_writer_budget"
});
const deferredOcrWithLiveState = __listingCopilotTitleTestHooks.deferredPreingestionOcrSnapshot({
  preingestion_summary: {
    ocr_stage_execution: {
      capacity_control_enabled: true,
      global_capacity: 8,
      claimed: 6
    }
  },
  preingestion_evidence_patches: [{ field: "grade_company", value: "BGS" }]
}, {
  configured: true,
  terminal: false,
  job_count: 6,
  active_count: 2,
  patch_count: 3,
  serial_patch_count: 1,
  evidence_patches: [
    { field: "serial_number", value: "2/3" },
    { field: "grade_company", value: "BGS" },
    { field: "card_number", value: "PAU" }
  ],
  execution_summary: {
    capacity_control_enabled: true,
    global_capacity: 8,
    claimed: 6
  }
});
assert.equal(deferredOcrWithLiveState.status, "DEFERRED_AFTER_PROVIDER");
assert.equal(deferredOcrWithLiveState.job_count, 6);
assert.equal(deferredOcrWithLiveState.patch_count, 3);
assert.equal(deferredOcrWithLiveState.execution_summary.global_capacity, 8);

const vectorWorkerSnapshot = {
  status: "OK",
  features: [{ image_id: "front", embedding: [0.1, 0.2] }],
  stage_capacity: {
    coordinated: true,
    acquired: true,
    released: true,
    slot: 3
  }
};
const deferredVector = __listingCopilotTitleTestHooks.deferredRetrievalCandidateContext({
  worker: vectorWorkerSnapshot,
  visualFeatures: vectorWorkerSnapshot,
  providerOptions: { enable_vector_retrieval: true, vector_retrieval_mode: "assist" }
});
assert.equal(deferredVector.worker.stage_capacity.slot, 3, "a retrieval deadline must not erase completed vector capacity facts");
assert.equal(deferredVector.packet.vector_retrieval.status, "DEFERRED_SHADOW");
assert.equal(deferredVector.packet.vector_retrieval.status_code, "RETRIEVAL_DEFERRED_OFF_CRITICAL_PATH");
assert.equal(deferredVector.packet.vector_retrieval.unavailable.length, 0, "deadline deferral is not a provider outage");
assert.equal(deferredVector.packet.vector_retrieval.deferred[0].reason, "post_observation_retrieval_deadline");

const reboundVector = __listingCopilotTitleTestHooks.rebindVectorCandidateContextToFields({
  retrieval: {
    sources: [{
      candidate_id: "candidate-136",
      candidate_identity_id: "identity-136",
      source_type: "INTERNAL_APPROVED_HISTORY",
      retrieval_status: "APPROVED",
      match_score: 0.94,
      fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        collector_number: "136"
      }
    }],
    unavailable: []
  },
  worker: vectorWorkerSnapshot,
  packet: {},
  assistPacket: {}
}, {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  collector_number: "136"
}, {
  env: { ENABLE_VECTOR_RETRIEVAL: "true", VECTOR_RETRIEVAL_MODE: "assist" },
  providerOptions: { enable_vector_retrieval: true, enable_vector_assist: true, vector_retrieval_mode: "assist" }
});
assert.equal(reboundVector.rebound_to_provider_observation, true);
assert.equal(reboundVector.worker.stage_capacity.slot, 3);
assert.equal(reboundVector.vector_assist_eligibility.prompt_candidate_count, 1);
const reboundCatalog = __listingCopilotTitleTestHooks.rebindCatalogCandidateContextToFields({
  retrieval: {
    sources: [{
      candidate_id: "catalog-136",
      candidate_identity_id: "catalog-identity-136",
      provider_id: "catalog",
      source_type: "STRUCTURED_DATABASE",
      source_trust: "APPROVED_REFERENCE",
      reference_metadata: { retrieval_status: "approved", source_type: "INTERNAL_CORRECTED_TITLE" },
      fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        collector_number: "136"
      }
    }],
    unavailable: []
  }
}, {
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  collector_number: "136"
});
assert.equal(reboundCatalog.rebound_to_provider_observation, true);
assert.equal(reboundCatalog.catalog_assist_eligibility.prompt_candidate_count, 1);
assert.equal(reboundCatalog.retrieval_phase, "provider_observation_catalog_rebind");

const reboundCatalogConflict = __listingCopilotTitleTestHooks.rebindCatalogCandidateContextToFields({
  retrieval: reboundCatalog.retrieval
}, {
  year: "2025",
  product: "Panini Prizm",
  players: ["Different Player"],
  collector_number: "999"
});
assert.equal(reboundCatalogConflict.catalog_assist_eligibility.prompt_candidate_count, 0);
const mergedCatalogContext = __listingCopilotTitleTestHooks.mergeCatalogCandidateContexts(
  {
    retrieval_phase: "pre_provider",
    retrieval: reboundCatalog.retrieval
  },
  {
    retrieval_phase: "post_provider",
    retrieval: {
      sources: [],
      providers_used: ["postgres_hybrid"],
      queries: [{ query_id: "post-provider-empty" }],
      trace: [],
      conflicts: [],
      unavailable: []
    }
  }
);
assert.equal(mergedCatalogContext.retrieval.sources.length, 1, "an empty post-provider lookup must not erase a valid pre-provider candidate");
assert.equal(mergedCatalogContext.catalog_context_merge.phase_count, 2);
const mergedCatalogRebound = __listingCopilotTitleTestHooks.rebindCatalogCandidateContextToFields(
  mergedCatalogContext,
  {
    year: "2024",
    product: "Topps Chrome",
    players: ["Test Player"],
    collector_number: "136"
  }
);
assert.equal(mergedCatalogRebound.catalog_assist_eligibility.prompt_candidate_count, 1);
const mergedCatalogConflict = __listingCopilotTitleTestHooks.rebindCatalogCandidateContextToFields(
  mergedCatalogContext,
  {
    year: "2025",
    product: "Panini Prizm",
    players: ["Different Player"],
    collector_number: "999"
  }
);
assert.equal(mergedCatalogConflict.catalog_assist_eligibility.prompt_candidate_count, 0, "merged candidates must still fail closed against current evidence");
assert.equal(__listingCopilotTitleTestHooks.serialNumeratorVerificationFromPreingestion({}, {
  status: "DEFERRED_AFTER_PROVIDER",
  job_count: null
}), false, "deferred OCR must not make an unverified serial numerator publishable");
assert.equal(__listingCopilotTitleTestHooks.serialNumeratorVerificationFromPreingestion({
  images: [{ id: "front" }],
  preingestion_evidence_patches: [{
    field: "serial_number",
    value: "2/3",
    confidence: 0.99,
    source_type: "OCR",
    source_image_id: "front",
    provenance: {
      crop_type: "serial_crop",
      job_key: "front:serial_crop"
    }
  }]
}, {
  status: "DEFERRED_AFTER_PROVIDER",
  job_count: null
}), true, "an already verified current-image OCR numerator remains usable while other OCR jobs continue");

assert.deepEqual(__listingCopilotTitleTestHooks.preingestionEvidenceRefreshDecision({
  preingestion_bundle_id: "bundle-1",
  preingestion_evidence_patches: [{ field: "serial_number" }]
}, {
  status: "TERMINAL",
  terminal: true,
  patch_count: 1
}), {
  skip: true,
  reason: "no_new_ocr_patches",
  loaded_patch_count: 1,
  rendezvous_patch_count: 1
});
assert.equal(__listingCopilotTitleTestHooks.preingestionEvidenceRefreshDecision({
  preingestion_bundle_id: "bundle-1",
  preingestion_evidence_patches: [{ field: "serial_number" }]
}, {
  status: "TIMEOUT",
  terminal: false,
  patch_count: 1
}).skip, false, "a timed-out OCR worker may still publish a late patch, so final refresh stays enabled");
assert.equal(__listingCopilotTitleTestHooks.preingestionEvidenceRefreshDecision({
  preingestion_bundle_id: "bundle-1",
  preingestion_evidence_patches: [{ field: "serial_number" }]
}, {
  status: "DEFERRED_AFTER_PROVIDER",
  terminal: false,
  patch_count: 1
}).skip, true, "writer-deferred OCR must use the current patch snapshot without a second blocking bundle read");
assert.equal(__listingCopilotTitleTestHooks.preingestionEvidenceRefreshDecision({
  preingestion_bundle_id: "bundle-1",
  preingestion_evidence_patches: []
}, {
  status: "TERMINAL",
  terminal: true,
  patch_count: 1
}).skip, false, "a terminal worker with a new patch must still hydrate evidence");

const deadlineProbeStartedAt = Date.now();
const deadlineProbe = await __listingCopilotTitleTestHooks.collectPromiseEntriesWithinBudget([
  { key: "catalog", promise: Promise.resolve({ id: "catalog-ready" }) },
  { key: "vector", promise: new Promise((resolve) => setTimeout(() => resolve({ id: "vector-late" }), 100)) }
], 25);
assert.deepEqual(deadlineProbe.settled.catalog, { id: "catalog-ready" });
assert.deepEqual(deadlineProbe.settled_keys, ["catalog"]);
assert.deepEqual(deadlineProbe.pending_keys, ["vector"]);
assert.ok(Date.now() - deadlineProbeStartedAt < 90, "deadline collector must not wait for the slow retrieval");
await Promise.all(deadlineProbe.pending_promises);

const parsedContent = parseProviderMessagePayload({
  content: "```json\n{\"title\":\"Test\",\"fields\":{\"player\":\"A\"},\"unresolved\":[]}\n```"
});
assert.equal(parsedContent.parse_source, "content");
assert.equal(parsedContent.parsed.fields.player, "A");

const parsedTool = parseProviderMessagePayload({
  tool_calls: [
    {
      type: "function",
      function: {
        name: "submit_card_evidence",
        arguments: "{\"evidence\":{\"player\":{\"value\":\"B\"}},\"unresolved\":[]}"
      }
    }
  ]
});
assert.equal(parsedTool.parse_source, "tool_call");
assert.equal(parsedTool.parsed.evidence.player.value, "B");

let openAiRequest;
const openAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env,
  fetchImpl: async (url, init) => {
    openAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999",
        "x-ratelimit-limit-tokens": "800000",
        "x-ratelimit-remaining-tokens": "799000",
        "x-ratelimit-reset-requests": "12ms",
        "x-ratelimit-reset-tokens": "40ms"
      }),
      json: async () => ({
        id: "resp_test",
        output_text: "{\"title\":\"OpenAI Test\",\"fields\":{\"player\":\"Emergency\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 11,
          output_tokens: 9,
          total_tokens: 20
        }
      })
    };
  }
});

assert.equal(openAiRequest.url, "https://api.openai.com/v1/responses");
assert.equal(openAiRequest.init.headers.authorization, "Bearer test-openai-key");
const openAiBody = JSON.parse(openAiRequest.init.body);
assert.equal(openAiBody.model, "gpt-4.1-mini-2025-04-14");
assert.equal(openAiBody.store, false);
assert.equal(openAiBody.temperature, 0);
assert.equal(openAiBody.reasoning, undefined);
assert.equal(openAiBody.text.verbosity, undefined);
assert.equal(openAiBody.text.format.type, "json_schema");
assert.equal(openAiBody.text.format.strict, true);
assert.equal(openAiBody.input[0].content[1].type, "input_image");
assert.equal(openAiResult.parsed.fields.player, "Emergency");
assert.equal(openAiResult.usage.provider_calls, 1);
assert.equal(openAiResult.usage.input_tokens, 11);
assert.equal(openAiResult.usage.output_tokens, 9);
assert.equal(openAiResult.usage.total_tokens, 20);
assert.equal(openAiResult.usage.image_count, 1);
assert.equal(openAiResult.provider_key_pool_size, 1);
assert.equal(openAiResult.provider_key_slot, 1);
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-limit-requests"], "5000");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-remaining-requests"], "4999");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-limit-tokens"], "800000");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-remaining-tokens"], "799000");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-reset-requests"], "12ms");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-reset-tokens"], "40ms");
assert.equal(openAiResult.provider_request_diagnostics.input_tokens, 11);
assert.equal(openAiResult.provider_request_diagnostics.output_tokens, 9);
assert.ok(openAiResult.provider_request_diagnostics.provider_latency_ms >= 0);

const gpt5Controls = openAiResponsesModelControls("gpt-5-mini", { env: {} });
assert.deepEqual(gpt5Controls, { reasoning: { effort: "minimal" } });
const gpt5Text = openAiResponsesTextOptions({
  model: "gpt-5-mini",
  name: "test_schema",
  schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  env: {}
});
assert.equal(gpt5Text.verbosity, "medium");
assert.equal(gpt5Text.format.type, "json_schema");

assert.deepEqual(openAiResponsesModelControls("gpt-5-mini", {
  env: { OPENAI_GPT5_REASONING_EFFORT: "low" }
}), { reasoning: { effort: "low" } });
assert.equal(openAiResponsesTextOptions({
  model: "gpt-5-mini",
  name: "test_schema",
  schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  env: { OPENAI_GPT5_TEXT_VERBOSITY: "low" }
}).verbosity, "low");

let gpt5OpenAiRequest;
const gpt5OpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini"
  },
  fetchImpl: async (url, init) => {
    gpt5OpenAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "resp_gpt5_test",
        model: "gpt-5-mini",
        output_text: "{\"title\":\"GPT-5 Test\",\"fields\":{\"player\":\"Five\"},\"field_evidence\":[],\"unresolved\":[],\"vector_candidate_decision\":{\"selected_candidate_id\":null,\"decision\":\"NOT_AVAILABLE\",\"supported_fields\":[],\"rejected_fields\":[],\"conflicts\":[]}}",
        usage: {
          input_tokens: 13,
          output_tokens: 7,
          total_tokens: 20
        }
      })
    };
  }
});
const gpt5Body = JSON.parse(gpt5OpenAiRequest.init.body);
assert.equal(gpt5Body.model, "gpt-5-mini");
assert.equal(gpt5Body.max_output_tokens, 128000);
assert.equal(gpt5Body.temperature, undefined);
assert.deepEqual(gpt5Body.reasoning, { effort: "minimal" });
assert.equal(gpt5Body.text.verbosity, "medium");
assert.match(gpt5Body.input[0].content[0].text, /GPT-5 mini main-path extraction profile/);
assert.match(gpt5Body.input[0].content[0].text, /Never leave product, set, players, card_name, print_run_number/);
assert.equal(gpt5OpenAiResult.parsed.fields.player, "Five");

let compactOpenAiRequest;
const compactOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return compact sparse JSON.",
  responseProfile: "compact_sparse_v1",
  imageDetail: "auto",
  textVerbosity: "low",
  serviceTier: "priority",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini"
  },
  fetchImpl: async (url, init) => {
    compactOpenAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "resp_gpt5_compact_test",
        model: "gpt-5-mini",
        service_tier: "priority",
        output_text: JSON.stringify({
          recognition_status: "CONFIRMED",
          field_values: {
            strings: [
              { field: "year", value: "2024-25" },
              { field: "product", value: "Topps Chrome" },
              { field: "print_run_number", value: "2/3" }
            ],
            booleans: [{ field: "auto", value: true }],
            numbers: [],
            lists: [{ field: "players", values: ["Lamine Yamal"] }]
          },
          field_evidence: [{
            field: "print_run_number",
            value: "2/3",
            source_type: "CARD_FRONT_PRINTED_TEXT",
            source_image_id: "image-1",
            source_region: "print_run_number",
            visible_text: "2/3",
            review_required: false,
            directly_observed: true
          }],
          unresolved: [],
          vector_candidate_decision: {
            selected_candidate_id: null,
            decision: "NOT_AVAILABLE",
            supported_fields: [],
            rejected_fields: [],
            conflicts: []
          }
        }),
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      })
    };
  }
});
const compactOpenAiBody = JSON.parse(compactOpenAiRequest.init.body);
assert.equal(compactOpenAiBody.text.format.name, "listing_provider_evidence_compact");
assert.equal(compactOpenAiBody.text.verbosity, "low");
assert.equal(compactOpenAiBody.input[0].content[1].detail, "auto");
assert.equal(compactOpenAiBody.store, false);
assert.equal(compactOpenAiBody.service_tier, "priority");
assert.equal(compactOpenAiBody.text.format.schema.properties.fields, undefined);
assert.ok(compactOpenAiBody.text.format.schema.properties.field_values);
assert.match(compactOpenAiBody.input[0].content[0].text, /compact sparse response note/i);
assert.equal(compactOpenAiResult.response_profile, "compact_sparse_v1");
assert.equal(compactOpenAiResult.image_detail, "auto");
assert.equal(compactOpenAiResult.text_verbosity, "low");
assert.equal(compactOpenAiResult.requested_service_tier, "priority");
assert.equal(compactOpenAiResult.service_tier, "priority");
assert.equal(compactOpenAiResult.parsed.fields.year, "2024-25");
assert.equal(compactOpenAiResult.parsed.fields.print_run_number, "2/3");
assert.deepEqual(compactOpenAiResult.parsed.fields.players, ["Lamine Yamal"]);
assert.equal(compactOpenAiResult.parsed.field_evidence.print_run_number.raw_text, "2/3");

let ultraCompactOpenAiRequest;
const ultraCompactOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return ultra sparse JSON.",
  responseProfile: "compact_sparse_v2",
  includeVectorDecision: false,
  imageDetail: "high",
  textVerbosity: "low",
  serviceTier: "priority",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini"
  },
  fetchImpl: async (url, init) => {
    ultraCompactOpenAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "resp_gpt5_ultra_compact_test",
        model: "gpt-5-mini",
        service_tier: "priority",
        output_text: JSON.stringify({
          r: "CONFIRMED",
          v: {
            s: [{ f: "year", v: "2024-25" }, { f: "product", v: "Topps Chrome" }],
            b: [{ f: "auto", v: true }],
            n: [],
            l: [{ f: "players", v: ["Lamine Yamal"] }]
          },
          e: [{ f: "year", v: "2024-25", s: "SLAB_LABEL", i: "image-1", t: "2024-25" }],
          u: []
        }),
        usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 }
      })
    };
  }
});
const ultraCompactOpenAiBody = JSON.parse(ultraCompactOpenAiRequest.init.body);
assert.equal(ultraCompactOpenAiBody.text.format.name, "listing_provider_evidence_ultra_compact");
assert.deepEqual(ultraCompactOpenAiBody.text.format.schema.required, ["r", "v", "e", "u"]);
assert.equal(ultraCompactOpenAiBody.text.format.schema.properties.c, undefined);
assert.match(ultraCompactOpenAiBody.input[0].content[0].text, /ultra-sparse response note/i);
assert.equal(ultraCompactOpenAiResult.response_profile, "compact_sparse_v2");
assert.equal(ultraCompactOpenAiResult.parsed.fields.product, "Topps Chrome");
assert.equal(ultraCompactOpenAiResult.parsed.field_evidence.year.directly_observed, true);
assert.equal(ultraCompactOpenAiResult.parsed.vector_candidate_decision.decision, "NOT_AVAILABLE");

const gpt5DefaultConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-5-mini"
});
assert.equal(gpt5DefaultConfig.requestedMaxOutputTokens, 128000);
assert.equal(gpt5DefaultConfig.maxOutputTokens, 128000);
assert.equal(gpt5DefaultConfig.truncationRetryMaxOutputTokens, 128000);

const gpt41DefaultExpandedConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-4.1-mini-2025-04-14"
});
assert.equal(gpt41DefaultExpandedConfig.maxOutputTokens, 32768);
assert.equal(gpt41DefaultExpandedConfig.truncationRetryMaxOutputTokens, 32768);

const gpt41ExpandedCapOverrideConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-4.1-mini-2025-04-14",
  OPENAI_GPT41_MAX_OUTPUT_TOKEN_CAP: "40960"
});
assert.equal(gpt41ExpandedCapOverrideConfig.maxOutputTokens, 32768);
assert.equal(gpt41ExpandedCapOverrideConfig.truncationRetryMaxOutputTokens, 32768);

let gpt5HardCapCalls = 0;
const gpt5HardCaps = [];
const gpt5HardCapResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini",
    // A stale deployment override must never push GPT-5 above its published
    // model limit or spend a guaranteed 400 round trip before retrying.
    OPENAI_GPT5_MAX_OUTPUT_TOKEN_CAP: "1280000",
    OPENAI_GPT5_MAX_OUTPUT_TOKENS: "1280000"
  },
  fetchImpl: async (url, init) => {
    gpt5HardCapCalls += 1;
    const body = JSON.parse(init.body);
    gpt5HardCaps.push(body.max_output_tokens);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "resp_gpt5_cap_fallback",
        model: "gpt-5-mini",
        output_text: "{\"title\":\"GPT-5 Fallback Test\",\"fields\":{\"player\":\"Fallback\"},\"field_evidence\":[],\"unresolved\":[],\"vector_candidate_decision\":{\"selected_candidate_id\":null,\"decision\":\"NOT_AVAILABLE\",\"supported_fields\":[],\"rejected_fields\":[],\"conflicts\":[]}}",
        usage: {
          input_tokens: 17,
          output_tokens: 9,
          total_tokens: 26
        }
      })
    };
  }
});
assert.equal(gpt5HardCapCalls, 1);
assert.deepEqual(gpt5HardCaps, [128000]);
assert.equal(gpt5HardCapResult.output_cap_downgrade_attempted, false);
assert.equal(gpt5HardCapResult.output_cap_downgrade_attempts, 0);
assert.equal(gpt5HardCapResult.token_diagnostics.requested_output_cap, 128000);
assert.equal(gpt5HardCapResult.token_diagnostics.model_output_token_cap, 128000);
assert.equal(gpt5HardCapResult.token_diagnostics.output_cap, 128000);
assert.equal(gpt5HardCapResult.parsed.fields.player, "Fallback");

const gpt5OverrideConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-5-mini",
  OPENAI_GPT5_MAX_OUTPUT_TOKENS: "50000",
  OPENAI_GPT5_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS: "90000"
});
assert.equal(gpt5OverrideConfig.maxOutputTokens, 50000);
assert.equal(gpt5OverrideConfig.truncationRetryMaxOutputTokens, 90000);

let gpt5TruncationCalls = 0;
const gpt5TruncationCaps = [];
const gpt5TruncationResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini",
    OPENAI_GPT5_MAX_OUTPUT_TOKENS: "50000",
    OPENAI_GPT5_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS: "90000"
  },
  fetchImpl: async (url, init) => {
    gpt5TruncationCalls += 1;
    const body = JSON.parse(init.body);
    gpt5TruncationCaps.push(body.max_output_tokens);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => gpt5TruncationCalls === 1
        ? {
            id: "resp_gpt5_truncated",
            model: "gpt-5-mini",
            status: "incomplete",
            output_text: "{\"recognition_status\":\"CONFIRMED\"",
            usage: {
              input_tokens: 21,
              output_tokens: 50000,
              total_tokens: 50021
            }
          }
        : {
            id: "resp_gpt5_retry_ok",
            model: "gpt-5-mini",
            status: "completed",
            output_text: "{\"title\":\"GPT-5 Retry Test\",\"fields\":{\"player\":\"Retry\"},\"field_evidence\":[],\"unresolved\":[],\"vector_candidate_decision\":{\"selected_candidate_id\":null,\"decision\":\"NOT_AVAILABLE\",\"supported_fields\":[],\"rejected_fields\":[],\"conflicts\":[]}}",
            usage: {
              input_tokens: 21,
              output_tokens: 100,
              total_tokens: 121
            }
          }
    };
  }
});
assert.equal(gpt5TruncationCalls, 2);
assert.deepEqual(gpt5TruncationCaps, [50000, 90000]);
assert.equal(gpt5TruncationResult.parsed.fields.player, "Retry");
assert.equal(gpt5TruncationResult.truncation_retry_attempted, true);
assert.equal(gpt5TruncationResult.truncation_retry_attempts, 1);
assert.equal(gpt5TruncationResult.initial_token_diagnostics.output_utilization, 1);

let pooledOpenAiRequest;
const pooledOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  shardKey: "asset-pool-test",
  env: {
    ...env,
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_POOL: "sk-pool-a,sk-pool-b,sk-pool-c"
  },
  fetchImpl: async (url, init) => {
    pooledOpenAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_pool_test",
        output_text: "{\"title\":\"OpenAI Pool Test\",\"fields\":{\"player\":\"Pool\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 5,
          output_tokens: 5,
          total_tokens: 10
        }
      })
    };
  }
});
assert.match(pooledOpenAiRequest.init.headers.authorization, /^Bearer sk-pool-/);
assert.equal(pooledOpenAiResult.provider_key_pool_size, 3);
assert.ok(pooledOpenAiResult.provider_key_slot >= 1 && pooledOpenAiResult.provider_key_slot <= 3);

let capacityLeasedAuthorization = "";
const capacityLeasedOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  shardKey: "asset-capacity-lease-test",
  preferredKeySlot: 2,
  env: {
    ...env,
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_POOL: "sk-lease-a,sk-lease-b,sk-lease-c"
  },
  fetchImpl: async (url, init) => {
    capacityLeasedAuthorization = init.headers.authorization;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_capacity_lease_test",
        output_text: "{\"title\":\"Capacity Lease Test\",\"fields\":{\"player\":\"Lease\"},\"unresolved\":[]}",
        usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 }
      })
    };
  }
});
assert.equal(capacityLeasedAuthorization, "Bearer sk-lease-b");
assert.equal(capacityLeasedOpenAiResult.provider_key_slot, 2);
assert.equal(capacityLeasedOpenAiResult.provider_key_source, "capacity_lease");

let rotatedOpenAiCalls = 0;
const rotatedAuthorizations = [];
const rotatedOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  shardKey: "asset-rotation-test",
  env: {
    ...env,
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_POOL: "sk-rotate-a,sk-rotate-b,sk-rotate-c",
    OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS: "0"
  },
  fetchImpl: async (url, init) => {
    rotatedOpenAiCalls += 1;
    rotatedAuthorizations.push(init.headers.authorization);
    if (rotatedOpenAiCalls === 1) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({
          "x-ratelimit-limit-requests": "1",
          "x-ratelimit-remaining-requests": "0",
          "x-ratelimit-reset-requests": "250ms"
        }),
        text: async () => "{\"error\":\"rate_limited\"}"
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999"
      }),
      json: async () => ({
        id: "resp_rotated_pool_test",
        output_text: "{\"title\":\"OpenAI Rotated Pool Test\",\"fields\":{\"player\":\"Rotated\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 6,
          output_tokens: 4,
          total_tokens: 10
        }
      })
    };
  }
});
assert.equal(rotatedOpenAiCalls, 2);
assert.equal(new Set(rotatedAuthorizations).size, 2, "retryable rate limits should rotate to the next OpenAI key slot before retrying");
assert.equal(rotatedOpenAiResult.parsed.fields.player, "Rotated");
assert.equal(rotatedOpenAiResult.provider_key_pool_size, 3);
assert.equal(rotatedOpenAiResult.provider_key_rotation_attempted, true);
assert.equal(rotatedOpenAiResult.provider_key_rotation_attempts, 1);
assert.equal(rotatedOpenAiResult.transient_retry_attempted, true);
assert.equal(rotatedOpenAiResult.transient_retry_attempts, 1);
assert.equal(rotatedOpenAiResult.provider_request_diagnostics.provider_key_slot, rotatedOpenAiResult.provider_key_slot);

let emptyResponseCalls = 0;
const emptyResponseAuthorizations = [];
const emptyResponseRecovered = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  shardKey: "asset-empty-response-rotation-test",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini",
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_POOL: "sk-empty-a,sk-empty-b",
    OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS: "0"
  },
  fetchImpl: async (url, init) => {
    emptyResponseCalls += 1;
    emptyResponseAuthorizations.push(init.headers.authorization);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => emptyResponseCalls === 1
        ? {
            id: "resp_empty_pool_test",
            status: "completed",
            output_text: "",
            usage: { input_tokens: 8, output_tokens: 0, total_tokens: 8 }
          }
        : {
            id: "resp_empty_pool_recovered",
            status: "completed",
            output_text: "{\"title\":\"OpenAI Empty Recovery\",\"fields\":{\"player\":\"Recovered Empty\"},\"unresolved\":[]}",
            usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 }
          }
    };
  }
});
assert.equal(emptyResponseCalls, 2);
assert.equal(new Set(emptyResponseAuthorizations).size, 2, "HTTP 200 empty responses should rotate key slots before retrying");
assert.equal(emptyResponseRecovered.parsed.fields.player, "Recovered Empty");
assert.equal(emptyResponseRecovered.provider_key_rotation_attempted, true);
assert.equal(emptyResponseRecovered.provider_key_rotation_attempts, 1);
assert.equal(emptyResponseRecovered.transient_retry_attempted, true);
assert.equal(emptyResponseRecovered.transient_retry_attempts, 1);

let transientOpenAiCalls = 0;
const transientOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_TRANSIENT_RETRIES: "1",
    OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS: "0"
  },
  fetchImpl: async () => {
    transientOpenAiCalls += 1;
    if (transientOpenAiCalls === 1) {
      return {
        ok: false,
        status: 520,
        text: async () => "<!DOCTYPE html><html><body>Cloudflare 520</body></html>"
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_retry_test",
        output_text: "{\"title\":\"OpenAI Retry Test\",\"fields\":{\"player\":\"Recovered\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20
        }
      })
    };
  }
});
assert.equal(transientOpenAiCalls, 2);
assert.equal(transientOpenAiResult.parsed.fields.player, "Recovered");
assert.equal(transientOpenAiResult.transient_retry_attempted, true);
assert.equal(transientOpenAiResult.transient_retry_attempts, 1);

let invalidOpenAiModelFetchCalled = false;
await assert.rejects(
  analyzeCardEvidenceWithOpenAiEmergency({
    images: dataUrlImages,
    prompt: "Return JSON.",
    env: {
      ...env,
      OPENAI_LISTING_MODEL: "gpt-5"
    },
    fetchImpl: async () => {
      invalidOpenAiModelFetchCalled = true;
    }
  }),
  (error) => error.provider === "openai_legacy" && error.code === "provider_unavailable"
);
assert.equal(invalidOpenAiModelFetchCalled, false);

assert.equal(providerServerConcurrencyLimit("openai_legacy", {}), 2);
assert.equal(providerServerConcurrencyLimit("openai_legacy", { OPENAI_PROVIDER_SERVER_CONCURRENCY: "2" }), 2);
assert.equal(providerServerConcurrencyLimit("openai_legacy", {
  OPENAI_API_KEY_POOL: "sk-a,sk-b,sk-c",
  OPENAI_PER_KEY_STABLE_CONCURRENCY: "2"
}), 2, "key-pool size must not silently raise production concurrency");
assert.equal(providerServerConcurrencyLimit("unknown", { LISTING_PROVIDER_SERVER_CONCURRENCY: "3" }), 3);

clearProviderConcurrencyForTests();
let activeProviderWork = 0;
let maxActiveProviderWork = 0;
await Promise.all(Array.from({ length: 4 }, (_, index) => runWithProviderConcurrency({
  providerId: "openai_legacy",
  env: { OPENAI_PROVIDER_SERVER_CONCURRENCY: "2" },
  work: async () => {
    activeProviderWork += 1;
    maxActiveProviderWork = Math.max(maxActiveProviderWork, activeProviderWork);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeProviderWork -= 1;
    return index;
  }
})));
assert.equal(maxActiveProviderWork, 2);
clearProviderConcurrencyForTests();

console.log("provider routing tests passed");
