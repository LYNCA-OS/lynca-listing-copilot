import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateCloudListingApi,
  fairTokenRecall,
  policyFairTokenRecall,
  rebuildCloudListingEvalReport,
  validateProtectionBypassSecret
} from "./evaluate-cloud-listing-api.mjs";
import { compareCloudEvalAblation } from "./compare-cloud-eval-ablation.mjs";

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || "";
      }
    },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const dataset = {
  items: [
    {
      candidate_id: "card-1",
      source_feedback_id: "fb1",
      category: "sports_card",
      source_titles: {
        corrected_title: "2025 Topps Chrome Test Player"
      },
      images: [
        {
          image_id: "front",
          bucket: "listing-feedback-images",
          object_path: "feedback/front.jpg",
          role: "front_original"
        },
        {
          image_id: "back",
          bucket: "listing-feedback-images",
          object_path: "feedback/back.jpg",
          role: "back_original"
        }
      ]
    }
  ]
};

const retrievalApplicationReplay = {
  schema_version: "retrieval-application-replay-v1",
  shared: {
    fingerprints: {
      replay_input: "sha256:replay-input"
    }
  },
  arms: {
    off: {
      input_fingerprint: "sha256:replay-input",
      semantic_fingerprint: "sha256:off"
    },
    on: {
      input_fingerprint: "sha256:replay-input",
      semantic_fingerprint: "sha256:on"
    }
  }
};

async function runProvider(provider, options = {}) {
  const titlePayloads = [];
  const verificationPayloads = [];
  const titleResponder = options.titleResponder;
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, {
        "set-cookie": "lynca_metaverse_session=test-cookie; Path=/"
      });
    }

    if (path === "/api/listing-provider-status") {
      return jsonResponse(200, {
        providers: [
          { id: "openai_legacy", role: "primary" }
        ],
        default_provider: "openai_legacy"
      });
    }

    if (path === "/api/listing-image-verify-existing") {
      const body = JSON.parse(init.body);
      verificationPayloads.push(body);
      return jsonResponse(200, {
        ok: true,
        verification: {
          bucket: body.bucket,
          object_path: body.object_path,
          verification_token: `verified-${body.image_id}`,
          content_type: "image/jpeg",
          size: 1000,
          width: 100,
          height: 100,
          content_sha256: Object.hasOwn(options, "verificationContentSha")
            ? options.verificationContentSha
            : "sha"
        }
      });
    }

    if (path === "/api/listing-copilot-title") {
      const body = JSON.parse(init.body);
      titlePayloads.push(body);
      const catalogEnabled = body.provider_options?.enable_evidence_completion === true
        && body.provider_options?.enable_catalog_assist === true;
      const vectorEnabled = body.provider_options?.enable_evidence_completion === true
        && body.provider_options?.enable_stored_visual_features === true
        && body.provider_options?.enable_vector_retrieval === true
        && body.provider_options?.vector_retrieval_mode === "assist";
      const excludeSourceFeedbackIds = [body.source_feedback_id].filter(Boolean);
      const excludeContentSha256 = (body.images || []).map((image) => image.content_sha256).filter(Boolean);
      if (typeof titleResponder === "function") {
        const response = titleResponder({
          body,
          callIndex: titlePayloads.length - 1,
          vectorEnabled
        });
        return jsonResponse(response.status || 200, response.body || response);
      }
      return jsonResponse(200, {
        final_title: "2025 Topps Chrome Test Player",
        confidence: "HIGH",
        provider: body.provider,
        model_id: "gpt-4.1-mini-2025-04-14",
        retrieval_prompt_context_enabled: body.provider_options?.enable_retrieval_prompt_context === true,
        retrieval_prompt_context_used: body.provider_options?.enable_retrieval_prompt_context === true && vectorEnabled,
        retrieval_prompt_context_source: body.provider_options?.enable_retrieval_prompt_context === true
          ? "test-retrieval-context"
          : null,
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        evidence: {
          year: { value: "2025", status: "CONFIRMED" },
          product: { value: "Topps Chrome", status: "CONFIRMED" },
          players: { value: ["Test Player"], status: "CONFIRMED" }
        },
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        rendered_fields: {
          title: "2025 Topps Chrome Test Player",
          rendered_title: "2025 Topps Chrome Test Player",
          modules: [{ type: "year", value: "2025" }]
        },
        retrieval: vectorEnabled
          ? {
            providers_used: ["visual_vector", "postgres_hybrid"],
            queries: [
              {
                family: "visual_vector",
                provider_id: "visual_vector",
                exclude_content_sha256: excludeContentSha256
              },
              { family: "SEARCH_POSTGRES_HYBRID", provider_id: "postgres_hybrid" }
            ],
            sources: [{
              source_type: "STRUCTURED_DATABASE",
              provider_id: "catalog",
              source_url: "supabase://catalog-cards/identity-1",
              matched_fields: ["catalog", "collector_number", "players"],
              title: "2025 Topps Chrome Test Player"
            }, {
              source_type: "VISUAL_VECTOR",
              matched_fields: ["visual_vector"],
              title: "2025 Topps Chrome Test Player"
            }, {
              source_type: "POSTGRES_HYBRID",
              provider_id: "postgres_hybrid",
              matched_fields: ["postgres_hybrid", "collector_number"],
              title: "2025 Topps Chrome Test Player"
            }]
          }
          : null,
        catalog_retrieval: catalogEnabled
          ? {
            providers_used: ["catalog"],
            queries: [{
              family: "SEARCH_CATALOG_YEAR_PRODUCT_SUBJECT",
              provider_id: "catalog",
              exclude_source_feedback_ids: excludeSourceFeedbackIds
            }],
            catalog_retrieval_metrics: {
              catalog_lookup_used_count: 1,
              catalog_candidate_count: 1,
              catalog_prompt_candidate_count: 1,
              catalog_candidate_selected_count: 0
            },
            sources: [{
              source_type: "CATALOG",
              provider_id: "catalog",
              source_url: "supabase://catalog-cards/identity-1",
              matched_fields: ["catalog", "collector_number", "players"],
              title: "2025 Topps Chrome Test Player",
              source_trust: "APPROVED_REFERENCE"
            }]
          }
          : null,
        catalog_candidate_packet: catalogEnabled
          ? {
            vector_retrieval: {
              candidates: [{
                candidate_identity_id: "identity-1",
                provider_id: "catalog",
                source_type: "CATALOG",
                source_url: "supabase://catalog-cards/identity-1",
                source_trust: "APPROVED_REFERENCE",
                title: "2025 Topps Chrome Test Player"
              }]
            }
          }
          : null,
        catalog_assist_packet: catalogEnabled
          ? {
            vector_retrieval: {
              candidates: [{
                candidate_identity_id: "identity-1",
                provider_id: "catalog",
                source_type: "CATALOG",
                source_url: "supabase://catalog-cards/identity-1",
                source_trust: "APPROVED_REFERENCE",
                title: "2025 Topps Chrome Test Player"
              }]
            }
          }
          : null,
        catalog_assist_eligibility: catalogEnabled
          ? {
            eligible: true,
            reason: "approved_identity_candidate_available",
            raw_candidate_count: 1,
            approved_candidate_count: 1,
            conflict_blocked_count: 0,
            prompt_candidate_count: 1,
            prompt_candidate_ids: ["identity-1"]
          }
          : null,
        catalog_prompt_assist_used: catalogEnabled,
        catalog_cache_hit: catalogEnabled,
        vector_retrieval: vectorEnabled
          ? {
            providers_used: ["visual_vector"],
            queries: [{
              family: "SEARCH_VISUAL_VECTOR",
              provider_id: "visual_vector",
              exclude_content_sha256: excludeContentSha256
            }],
            sources: [{
              source_type: "VISUAL_VECTOR",
              matched_fields: ["visual_vector"],
              title: "2025 Topps Chrome Test Player"
            }]
          }
          : null,
        vector_candidate_packet: vectorEnabled
          ? {
            vector_retrieval: {
              candidates: [{
                candidate_identity_id: "identity-1",
                title: "2025 Topps Chrome Test Player"
              }]
            }
          }
          : null,
        vector_assist_eligibility: vectorEnabled
          ? {
            eligible: true,
            reason: "approved_identity_candidate_available",
            raw_candidate_count: 2,
            approved_candidate_count: 1,
            conflict_blocked_count: 1,
            prompt_candidate_count: 1,
            prompt_candidate_ids: ["identity-1"]
          }
          : null,
        vector_prompt_assist_used: vectorEnabled,
        retrieval_application_replay: body.provider_options?.evaluation_profile
          === "retrieval_application_single_observation_replay_v1"
          ? retrievalApplicationReplay
          : null,
        vector_lazy_skip: vectorEnabled && body.provider_options?.enable_vector_lazy_mode === true
          ? {
            skipped: true,
            reason: "vector_lazy_strong_catalog_anchor",
            catalog_candidate_id: "identity-1",
            catalog_candidate_identity_id: "identity-1"
          }
          : null,
        exact_anchor_fast_lane_shadow: vectorEnabled
          ? {
            exact_anchor_fast_lane_eligible: true,
            exact_anchor_candidate_id: "identity-1",
            exact_anchor_candidate_identity_id: "identity-1",
            exact_anchor_reason: "approved_reference_strong_catalog_anchor",
            would_skip_vector: body.provider_options?.enable_vector_lazy_mode === true,
            would_use_title_scaffold: true,
            forbidden_to_copy_fields: ["serial_number", "grade_company", "card_grade", "cert_number"],
            expected_saved_ms: null
          }
          : null,
        exact_anchor_fast_lane_eligible: vectorEnabled,
        exact_anchor_candidate_id: vectorEnabled ? "identity-1" : "",
        exact_anchor_reason: vectorEnabled ? "approved_reference_strong_catalog_anchor" : null,
        would_skip_vector: vectorEnabled && body.provider_options?.enable_vector_lazy_mode === true,
        would_use_title_scaffold: vectorEnabled,
        forbidden_to_copy_fields: vectorEnabled ? ["serial_number", "grade_company", "card_grade", "cert_number"] : [],
        expected_saved_ms: null,
        retrieval_title_assist: vectorEnabled
          ? {
            used: true,
            mode: "selected_approved_candidate_title_scaffold",
            provider_id: "postgres_hybrid",
            candidate_identity_id: "identity-1",
            matched_fields: ["collector_number", "players", "product"],
            stripped_reference_instance_terms: true
          }
          : null,
        visual_features: vectorEnabled
          ? { features: [{ embedding: [0.1, 0.2], embedding_role: "front_global" }] }
          : null,
        timing: {
          total_ms: 1234,
          signed_url_ms: 10,
          catalog_retrieval_ms: 20,
          catalog_cache_ms: catalogEnabled ? 1 : 0,
          vector_embedding_ms: vectorEnabled ? 0 : 0,
          vector_retrieval_ms: vectorEnabled ? 0 : 0,
          provider_total_ms: 900,
          evidence_completion_ms: catalogEnabled ? 30 : 0,
          resolver_ms: 5,
          renderer_ms: 4
        }
      });
    }

    throw new Error(`unexpected fetch path: ${path}`);
  };

  const report = await evaluateCloudListingApi({
    dataset: options.dataset || dataset,
    baseUrl: "https://lynca.example",
    provider,
    limit: 1,
    concurrency: 1,
    username: "listing",
    password: "password",
    fetchImpl,
    ...(options.evaluateOptions || {})
  });

  return { report, titlePayload: titlePayloads[0], titlePayloads, verificationPayloads };
}

const openai = await runProvider("openai");
assert.equal(openai.report.status, "completed");
assert.equal(openai.report.provider, "openai_baseline");
assert.equal(openai.report.requested_cloud_provider, "openai_legacy");
assert.equal(openai.report.provider_success_rate, 1);
assert.equal(openai.report.per_card_latency_ms.p50, 1234);
assert.equal(openai.report.cloud_preflight.ok, true);
assert.equal(openai.report.cloud_preflight.default_provider, "openai_legacy");
assert.equal(openai.report.accuracy_policy.corrected_title_as_temporary_gt, false);
assert.equal(openai.report.accuracy_policy.corrected_title_is_reviewed_title_ground_truth, false);
assert.equal(openai.report.accuracy_policy.corrected_title_field_ground_truth, false);
assert.equal(openai.report.accuracy_policy.corrected_title_hint_sent_to_cloud, false);
assert.equal(openai.report.accuracy_policy.corrected_title_or_ground_truth_sent_to_cloud, false);
assert.equal(openai.report.exclusion_requested, true);
assert.equal(openai.report.exclusion_confirmed, true);
assert.equal(openai.report.exclusion_requested_count, 1);
assert.equal(openai.report.exclusion_confirmed_count, 1);
assert.equal(openai.report.exclusion_unconfirmed_count, 0);
assert.equal(openai.report.returned_self_candidate_count, 0);

{
  const serialDataset = {
    items: [{
      ...dataset.items[0],
      candidate_id: "serial-card",
      source_titles: {
        corrected_title: "2025 Panini Prizm Test Player Auto 29/199"
      }
    }]
  };
  const serialEval = await runProvider("openai_vector", {
    dataset: serialDataset,
    titleResponder: () => ({
      final_title: "2025 Panini Prizm Test Player Auto /199",
      confidence: "HIGH",
      provider: "openai_legacy",
      model_id: "gpt-4.1-mini-2025-04-14",
      usage: { provider_calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 2 }
    })
  });
  assert.equal(serialEval.report.serial_number_title_analysis.reference_serial_count, 1);
  assert.equal(serialEval.report.serial_number_title_analysis.exact_match_count, 0);
  assert.equal(serialEval.report.serial_number_title_analysis.denominator_match_count, 1);
  assert.equal(serialEval.report.serial_number_title_analysis.numerator_omission_count, 1);
  assert.equal(serialEval.report.numerical_rarity_title_token_recall_avg, 1);
}
assert.equal(openai.report.accuracy_policy.corrected_title_temporary_gt_scope, "legacy_alias_for_reviewed_title_gt_candidate_scoring");
assert.equal(openai.report.accuracy_policy.corrected_title_token_recall_is_title_accuracy, true);
assert.equal(openai.report.accuracy_policy.corrected_title_token_recall_is_identity_accuracy, false);
assert.equal(openai.report.results[0].corrected_title_as_temporary_gt, false);
assert.equal(openai.report.results[0].corrected_title_is_reviewed_title_ground_truth, false);
assert.equal(openai.report.results[0].corrected_title_field_ground_truth, false);
assert.equal(openai.report.results[0].corrected_title_hint_sent_to_cloud, false);
assert.equal(openai.report.pass_at_0_72_count, 1);
assert.equal(openai.report.pass_at_0_80_count, 1);
assert.equal(openai.report.raw_blind_output_accuracy.pass_at_0_72_count, 1);
assert.equal(openai.report.oracle_candidate_upper_bound.pass_at_0_80_count, 1);
assert.equal(openai.report.fast_path_used_count, 0);
assert.equal(openai.report.catalog_prompt_assist_used_count, 0);
assert.equal(openai.report.retrieval_title_assist_used_count, 0);
assert.deepEqual(openai.report.open_set_status_counts, { ASSIST_DISABLED: 1 });
assert.equal(openai.report.known_catalog_candidate_available_count, 0);
assert.equal(openai.report.catalog_gap_queue_candidate_count, 0);
assert.equal(openai.report.fail_closed_candidate_count, 0);
assert.equal(openai.report.unknown_card_ready_count, 0);
assert.deepEqual(openai.report.catalog_prompt_candidate_ids, []);
assert.equal(openai.report.card_type_default_base_count, 0);
assert.equal(openai.report.base_without_catalog_support_count, 0);
assert.equal(openai.report.base_in_resolved_fields_count, 0);
assert.equal(openai.report.base_in_rendered_title_count, 0);
assert.equal(openai.report.exact_anchor_fast_lane_eligible_count, 0);
assert.equal(openai.report.copied_serial_grade_cert_from_reference_count, 0);
assert.equal(openai.report.decision_trace[0].gpt_only_title, "2025 Topps Chrome Test Player");
assert.equal(openai.report.breakpoint_completeness_avg.raw_provider_fields, 0.375);
assert.equal(openai.report.breakpoint_completeness_avg.rendered_fields, 0.375);
assert.equal(openai.report.results[0].breakpoints.raw_provider_fields.year, "2025");
assert.equal(openai.report.results[0].breakpoints.rendered_fields.year, "2025");
assert.equal(openai.report.results[0].breakpoints.normalized_evidence.product.value, "Topps Chrome");
assert.equal(openai.report.results[0].breakpoints.resolved_fields.players[0], "Test Player");
assert.equal(openai.titlePayload.provider, "openai_legacy");
assert.equal(openai.titlePayload.explicitEmergency, true);
assert.equal(openai.titlePayload.provider_options.single_model_fast, true);
assert.equal(openai.titlePayload.provider_options.corrected_title_as_temporary_gt, false);
assert.equal(openai.titlePayload.provider_options.send_corrected_title_hint_to_cloud, false);
assert.equal(openai.titlePayload.provider_options.enable_catalog_assist, false);
assert.equal(openai.titlePayload.provider_options.enable_vector_assist, false);
assert.equal(openai.titlePayload.provider_options.enable_evidence_completion, false);
assert.equal(openai.titlePayload.provider_options.enable_gpt_failure_fallback, false);
assert.equal(openai.titlePayload.catalog_observation_hint, null);
assert.equal(openai.titlePayload.source_feedback_id, "fb1");
assert.equal(openai.titlePayload.asset_id, "card-1");
assert.deepEqual(openai.titlePayload.images.map((image) => image.image_id), ["front", "back"]);
assert.deepEqual(openai.titlePayload.images.map((image) => image.object_path), ["feedback/front.jpg", "feedback/back.jpg"]);
assert.deepEqual(openai.titlePayload.images.map((image) => image.content_sha256), ["sha", "sha"]);
assert.equal(Object.hasOwn(openai.titlePayload, "ground_truth"), false);
assert.equal(Object.hasOwn(openai.titlePayload, "corrected_title"), false);
assert.equal(JSON.stringify(openai.titlePayload).includes("2025 Topps Chrome Test Player"), false);
assert.deepEqual(openai.verificationPayloads.map((payload) => payload.image_id), ["front", "back"]);
assert.deepEqual(openai.verificationPayloads.map((payload) => payload.object_path), ["feedback/front.jpg", "feedback/back.jpg"]);
assert.equal(openai.report.results[0].exclusion_requested, true);
assert.equal(openai.report.results[0].exclusion_confirmed, true);
assert.equal(openai.report.results[0].exclusion_observation.corrected_title_or_ground_truth_sent_to_cloud, false);

{
  const sourceRecordIdentifiers = await runProvider("openai_vector", {
    verificationContentSha: "",
    dataset: {
      items: [{
        candidate_id: "nested-card",
        category: "sports_card",
        source_titles: {
          corrected_title: "2025 Topps Chrome Nested Player"
        },
        source_record: {
          feedback_id: "nested-feedback",
          asset_id: "nested-asset",
          physical_card_id: "nested-physical-card",
          physical_instance_group_id: "nested-instance-group",
          reviewed_ground_truth: true,
          self_retrieval_exclusion_required: true,
          images: [{
            imageId: "nested-front",
            bucket: "listing-feedback-images",
            objectPath: "feedback/nested-front.jpg",
            role: "front_original",
            contentSha256: "dataset-sha"
          }]
        }
      }]
    }
  });
  assert.equal(sourceRecordIdentifiers.titlePayload.source_feedback_id, "nested-feedback");
  assert.equal(sourceRecordIdentifiers.titlePayload.asset_id, "nested-asset");
  assert.equal(sourceRecordIdentifiers.titlePayload.physical_card_id, "nested-physical-card");
  assert.equal(sourceRecordIdentifiers.titlePayload.physical_instance_group_id, "nested-instance-group");
  assert.equal(sourceRecordIdentifiers.titlePayload.images[0].image_id, "nested-front");
  assert.equal(sourceRecordIdentifiers.titlePayload.images[0].object_path, "feedback/nested-front.jpg");
  assert.equal(sourceRecordIdentifiers.titlePayload.images[0].content_sha256, "dataset-sha");
  assert.equal(Object.hasOwn(sourceRecordIdentifiers.titlePayload, "ground_truth"), false);
  assert.equal(Object.hasOwn(sourceRecordIdentifiers.titlePayload, "corrected_title"), false);
  assert.equal(JSON.stringify(sourceRecordIdentifiers.titlePayload).includes("2025 Topps Chrome Nested Player"), false);
  assert.equal(sourceRecordIdentifiers.report.exclusion_requested, true);
  assert.equal(sourceRecordIdentifiers.report.exclusion_confirmed, true);
  assert.equal(sourceRecordIdentifiers.report.results[0].exclusion_observation.catalog.confirmed, true);
  assert.equal(sourceRecordIdentifiers.report.results[0].exclusion_observation.vector.confirmed, true);
}

{
  const retrievalOff = await runProvider("retrieval_off", {
    evaluateOptions: {
      correctedTitleAsTemporaryGt: true,
      sendCorrectedTitleHintToCloud: true
    }
  });
  const retrievalOn = await runProvider("retrieval_on", {
    evaluateOptions: {
      correctedTitleAsTemporaryGt: true,
      sendCorrectedTitleHintToCloud: true
    }
  });
  const off = retrievalOff.titlePayload.provider_options;
  const on = retrievalOn.titlePayload.provider_options;

  assert.equal(retrievalOff.report.provider, "retrieval_off");
  assert.equal(retrievalOn.report.provider, "retrieval_on");
  assert.equal(retrievalOff.report.experiment_contract.arm, "OFF");
  assert.equal(retrievalOn.report.experiment_contract.arm, "ON");
  for (const options of [off, on]) {
    assert.equal(options.evaluation_profile, "retrieval_application_ablation_v1");
    assert.equal(options.single_model_fast, false);
    assert.equal(options.enable_ephemeral_external_retrieval, false);
    assert.equal(options.disable_identity_result_cache, true);
    assert.equal(options.disable_approved_identity_memory, true);
    assert.equal(options.corrected_title_as_temporary_gt, false);
    assert.equal(options.send_corrected_title_hint_to_cloud, false);
    assert.equal(options.enable_retrieval_prompt_context, false);
    assert.equal(options.eval_flags.ENABLE_RETRIEVAL_PROMPT_CONTEXT, false);
  }
  assert.equal(retrievalOff.report.experiment_contract.retrieval_prompt_context_enabled, false);
  assert.equal(retrievalOn.report.experiment_contract.retrieval_prompt_context_enabled, false);
  assert.equal(off.enable_catalog_assist, false);
  assert.equal(off.enable_evidence_completion, true);
  assert.equal(off.disable_evidence_completion_retrieval, true);
  assert.equal(off.enable_vector_assist, false);
  assert.equal(off.enable_retrieval_application, false);
  assert.equal(off.force_retrieval_application_resolution, false);
  assert.equal(off.enable_stored_visual_features, false);
  assert.equal(off.enable_vector_retrieval, false);
  assert.equal(off.enable_advanced_retrieval, false);
  assert.equal(off.enable_hybrid_retrieval, false);
  assert.equal(on.enable_catalog_assist, true);
  assert.equal(on.enable_evidence_completion, true);
  assert.equal(on.disable_evidence_completion_retrieval, false);
  assert.equal(on.enable_vector_assist, true);
  assert.equal(on.enable_retrieval_application, true);
  assert.equal(on.force_retrieval_application_resolution, true);
  assert.equal(on.enable_stored_visual_features, true);
  assert.equal(on.enable_vector_retrieval, true);
  assert.equal(on.enable_advanced_retrieval, true);
  assert.equal(on.enable_hybrid_retrieval, true);
  assert.equal(retrievalOff.titlePayload.catalog_observation_hint, null);
  assert.equal(retrievalOn.titlePayload.catalog_observation_hint, null);
}

{
  const replay = await runProvider("retrieval_replay", {
    evaluateOptions: {
      correctedTitleAsTemporaryGt: true,
      sendCorrectedTitleHintToCloud: true
    }
  });
  const replayAlias = await runProvider("retrieval-replay");
  const options = replay.titlePayload.provider_options;

  assert.equal(replay.report.provider, "retrieval_replay");
  assert.equal(replayAlias.report.provider, "retrieval_replay");
  assert.equal(replay.titlePayload.provider_eval_mode, "retrieval_replay");
  assert.equal(options.provider_mode, "retrieval_replay");
  assert.equal(options.provider_eval_mode, "retrieval_replay");
  assert.equal(options.evaluation_profile, "retrieval_application_single_observation_replay_v1");
  assert.equal(options.enable_evidence_completion, true);
  assert.equal(options.enable_catalog_assist, true);
  assert.equal(options.enable_vector_assist, true);
  assert.equal(options.enable_retrieval_application, true);
  assert.equal(options.enable_retrieval_prompt_context, false);
  assert.equal(options.eval_flags.ENABLE_RETRIEVAL_PROMPT_CONTEXT, false);
  assert.equal(replay.titlePayload.enable_retrieval_prompt_context, false);
  assert.equal(options.enable_stored_visual_features, true);
  assert.equal(options.enable_query_visual_embeddings, true);
  assert.equal(options.enable_vector_retrieval, true);
  assert.equal(options.vector_retrieval_mode, "assist");
  assert.equal(options.enable_vector_lazy_mode, false);
  assert.equal(options.force_vector_assist, true);
  assert.equal(options.enable_advanced_retrieval, true);
  assert.equal(options.enable_hybrid_retrieval, true);
  assert.equal(options.disable_identity_result_cache, true);
  assert.equal(options.disable_approved_identity_memory, true);
  assert.equal(options.corrected_title_as_temporary_gt, false);
  assert.equal(options.send_corrected_title_hint_to_cloud, false);
  assert.equal(options.cloud_eval_blind_to_corrected_title_hint, true);
  assert.equal(replay.titlePayload.catalog_observation_hint, null);
  assert.equal(Object.hasOwn(replay.titlePayload, "corrected_title"), false);
  assert.equal(Object.hasOwn(replay.titlePayload, "ground_truth"), false);
  assert.equal(JSON.stringify(replay.titlePayload).includes("2025 Topps Chrome Test Player"), false);
  assert.deepEqual(replay.report.results[0].retrieval_application_replay, retrievalApplicationReplay);
  assert.equal(replay.report.results[0].retrieval_prompt_context_enabled, false);
  assert.equal(replay.report.results[0].retrieval_prompt_context_used, false);
  assert.equal(replay.report.results[0].exclusion_confirmed, true);
  assert.equal(replay.report.results[0].returned_self_candidate_count, 0);
  assert.equal(replay.report.results[0].same_card_exclusion_evidence_present, true);
  assert.equal(replay.report.retrieval_prompt_context_explicitly_disabled, true);
  assert.equal(replay.report.retrieval_prompt_context_not_explicitly_disabled_count, 0);
  assert.equal(replay.report.same_card_exclusion_evidence_complete, true);
}

{
  const coldStart = await runProvider("ebay_cold_start_blind", {
    titleResponder({ body }) {
      return {
        final_title: "2025 Topps Chrome Test Player Gold",
        confidence: "HIGH",
        provider: body.provider,
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"],
          surface_color: "Gold"
        },
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"],
          surface_color: "Gold"
        },
        catalog_assist_eligibility: {
          eligible: false,
          reason: "reference_candidates_only",
          raw_candidate_count: 2,
          approved_candidate_count: 0,
          conflict_blocked_count: 0,
          prompt_candidate_count: 0,
          prompt_candidate_ids: []
        },
        vector_assist_eligibility: {
          eligible: false,
          reason: "reference_candidates_only",
          raw_candidate_count: 3,
          approved_candidate_count: 0,
          conflict_blocked_count: 0,
          prompt_candidate_count: 0,
          prompt_candidate_ids: []
        },
        cold_start_status: "SAFE_DRAFT_READY",
        writer_action_required: true,
        cold_start_safe_draft: {
          active: true,
          status: "SAFE_DRAFT_READY",
          safe_draft_ready: true
        },
        timing: { total_ms: 1000 },
        usage: { provider_calls: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      };
    }
  });
  assert.equal(coldStart.report.provider, "ebay_cold_start_blind");
  assert.equal(coldStart.titlePayload.provider_options.enable_catalog_assist, true);
  assert.equal(coldStart.titlePayload.provider_options.enable_vector_assist, true);
  assert.equal(coldStart.titlePayload.provider_options.cold_start_blind, true);
  assert.equal(coldStart.titlePayload.provider_options.enable_ephemeral_external_retrieval, true);
  assert.equal(coldStart.titlePayload.provider_options.corrected_title_as_temporary_gt, false);
  assert.equal(coldStart.titlePayload.provider_options.send_corrected_title_hint_to_cloud, false);
  assert.equal(coldStart.titlePayload.catalog_observation_hint, null);
  assert.equal(coldStart.report.accuracy_policy.corrected_title_as_temporary_gt, false);
  assert.equal(coldStart.report.cold_start_safe_draft_count, 1);
  assert.equal(coldStart.report.cold_start_safe_draft_rate, 1);
  assert.equal(coldStart.report.no_approved_catalog_match_count, 1);
  assert.equal(coldStart.report.catalog_gap_created_count, 1);
  assert.equal(coldStart.report.decision_trace[0].cold_start_title, "2025 Topps Chrome Test Player Gold");
  assert.equal(coldStart.report.decision_trace[0].cold_start_status, "SAFE_DRAFT_READY");
}

{
  const referenceCopyRisk = await runProvider("d", {
    titleResponder({ body }) {
      return {
        final_title: "2025 Topps Chrome Test Player Base 17/50 PSA 10",
        confidence: "HIGH",
        provider: body.provider,
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"],
          card_type: "Base",
          serial_number: "17/50",
          grade_company: "PSA",
          card_grade: "10"
        },
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"],
          card_type: "Base",
          serial_number: "17/50",
          grade_company: "PSA",
          card_grade: "10"
        },
        evidence: {
          serial_number: {
            value: "17/50",
            sources: [{ source_type: "VISUAL_GUESS", original_source_type: "VISUAL_VECTOR" }]
          },
          grade_company: {
            value: "PSA",
            sources: [{ source_type: "STRUCTURED_DATABASE", source_url: "supabase://card-identities/ref" }]
          },
          card_grade: {
            value: "10",
            sources: [{ source_type: "STRUCTURED_DATABASE", source_url: "supabase://card-identities/ref" }]
          }
        },
        vector_candidate_packet: {
          vector_retrieval: {
            candidates: [{
              candidate_identity_id: "identity-reference-copy",
              source_type: "VISUAL_VECTOR",
              title: "2025 Topps Chrome Test Player 17/50 PSA 10",
              fields: {
                serial_number: "17/50",
                grade_company: "PSA",
                card_grade: "10"
              }
            }]
          }
        },
        timing: { total_ms: 200 }
      };
    }
  });
  assert.equal(referenceCopyRisk.report.card_type_default_base_count, 1);
  assert.equal(referenceCopyRisk.report.base_without_catalog_support_count, 1);
  assert.equal(referenceCopyRisk.report.base_in_resolved_fields_count, 1);
  assert.equal(referenceCopyRisk.report.base_in_rendered_title_count, 1);
  assert.equal(referenceCopyRisk.report.copied_serial_grade_cert_from_reference_count, 1);
  assert.deepEqual(referenceCopyRisk.report.decision_trace[0].copied_serial_grade_cert_from_reference_fields.sort(), ["card_grade", "grade_company", "serial_number"]);
}

{
  const denominatorOnly = await runProvider("catalog-only", {
    titleResponder({ body }) {
      return {
        final_title: "2025 Topps Chrome Test Player /50",
        confidence: "HIGH",
        provider: body.provider,
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"],
          serial_number: "/50"
        },
        evidence: {
          serial_number: {
            value: "/50",
            sources: [{ source_type: "STRUCTURED_DATABASE", source_url: "supabase://catalog-cards/identity-denominator" }]
          }
        },
        catalog_candidate_packet: {
          vector_retrieval: {
            candidates: [{
              candidate_identity_id: "identity-denominator",
              provider_id: "catalog",
              source_url: "supabase://catalog-cards/identity-denominator",
              fields: {
                expected_serial_denominator: "50"
              }
            }]
          }
        },
        timing: { total_ms: 210 }
      };
    }
  });
  assert.equal(denominatorOnly.report.copied_serial_grade_cert_from_reference_count, 0);
  assert.deepEqual(denominatorOnly.report.decision_trace[0].copied_serial_grade_cert_from_reference_fields, []);
}

const openaiCatalog = await runProvider("catalog-only");
assert.equal(openaiCatalog.report.provider, "openai_catalog");
assert.equal(openaiCatalog.titlePayload.provider, "openai_legacy");
assert.equal(openaiCatalog.titlePayload.provider_options.single_model_fast, false);
assert.equal(openaiCatalog.titlePayload.provider_options.corrected_title_as_temporary_gt, true);
assert.equal(openaiCatalog.titlePayload.provider_options.send_corrected_title_hint_to_cloud, false);
assert.equal(openaiCatalog.titlePayload.provider_options.cloud_eval_blind_to_corrected_title_hint, true);
assert.equal(openaiCatalog.titlePayload.provider_options.enable_catalog_assist, true);
assert.equal(openaiCatalog.titlePayload.provider_options.enable_vector_assist, false);
assert.equal(openaiCatalog.titlePayload.provider_options.enable_evidence_completion, true);
assert.equal(openaiCatalog.titlePayload.provider_options.enable_stored_visual_features, false);
assert.equal(openaiCatalog.titlePayload.provider_options.enable_vector_retrieval, false);
assert.equal(openaiCatalog.titlePayload.provider_options.vector_retrieval_mode, "off");
assert.equal(openaiCatalog.titlePayload.catalog_observation_hint, null);
assert.equal(openaiCatalog.report.accuracy_policy.corrected_title_as_temporary_gt, false);
assert.equal(openaiCatalog.report.accuracy_policy.corrected_title_hint_sent_to_cloud, false);
assert.equal(openaiCatalog.report.results[0].corrected_title_hint_sent_to_cloud, false);
assert.equal(openaiCatalog.report.results[0].exclusion_observation.catalog.requested, true);
assert.equal(openaiCatalog.report.results[0].exclusion_observation.catalog.confirmed, true);
assert.equal(openaiCatalog.report.results[0].exclusion_observation.catalog.query_echo_count, 1);
assert.equal(openaiCatalog.report.exclusion_confirmed, true);
assert.equal(openaiCatalog.report.fast_path_used_count, 0);
assert.equal(openaiCatalog.report.catalog_lookup_used_count, 1);
assert.equal(openaiCatalog.report.catalog_candidate_count, 1);
assert.equal(openaiCatalog.report.catalog_prompt_candidate_count, 1);
assert.equal(openaiCatalog.report.catalog_prompt_assist_used_count, 1);
assert.deepEqual(openaiCatalog.report.catalog_prompt_candidate_ids, ["identity-1"]);
assert.equal(openaiCatalog.report.results[0].catalog_prompt_assist_used, true);
assert.equal(openaiCatalog.report.results[0].catalog_prompt_candidate_count, 1);
assert.equal(openaiCatalog.report.decision_trace[0].catalog_only_title, "2025 Topps Chrome Test Player");
assert.equal(openaiCatalog.report.decision_trace[0].catalog_prompt_assist_used, true);
assert.equal(openaiCatalog.report.decision_trace[0].fast_path_used, false);

const openaiCatalogWithHint = await runProvider("catalog-only", {
  evaluateOptions: {
    sendCorrectedTitleHintToCloud: true
  }
});
assert.equal(openaiCatalogWithHint.titlePayload.provider_options.send_corrected_title_hint_to_cloud, false);
assert.equal(openaiCatalogWithHint.titlePayload.provider_options.cloud_eval_blind_to_corrected_title_hint, true);
assert.equal(openaiCatalogWithHint.titlePayload.catalog_observation_hint, null);
assert.equal(JSON.stringify(openaiCatalogWithHint.titlePayload).includes("2025 Topps Chrome Test Player"), false);
assert.equal(openaiCatalogWithHint.report.accuracy_policy.corrected_title_hint_sent_to_cloud, false);
assert.equal(openaiCatalogWithHint.report.results[0].corrected_title_hint_sent_to_cloud, false);

{
  const unconfirmed = await runProvider("catalog-only", {
    titleResponder({ body }) {
      return {
        final_title: "2025 Topps Chrome Test Player",
        confidence: "HIGH",
        provider: body.provider
      };
    }
  });
  assert.equal(unconfirmed.report.exclusion_requested, true);
  assert.equal(unconfirmed.report.exclusion_confirmed, false);
  assert.equal(unconfirmed.report.exclusion_unconfirmed_count, 1);
  assert.equal(unconfirmed.report.results[0].exclusion_observation.catalog.query_echo_count, 0);
}

{
  const returnedSelfCandidate = await runProvider("catalog-only", {
    titleResponder({ body }) {
      return {
        final_title: "2025 Topps Chrome Test Player",
        confidence: "HIGH",
        provider: body.provider,
        retrieval_prompt_context_enabled: false,
        retrieval_prompt_context_used: false,
        catalog_retrieval: {
          queries: [{
            family: "SEARCH_CATALOG_YEAR_PRODUCT_SUBJECT",
            provider_id: "catalog",
            exclude_source_feedback_ids: [body.source_feedback_id]
          }],
          sources: [{
            candidate_id: "self-candidate",
            provider_id: "catalog",
            source_type: "CATALOG",
            source_feedback_id: body.source_feedback_id,
            title: "2025 Topps Chrome Test Player"
          }]
        }
      };
    }
  });
  assert.equal(returnedSelfCandidate.report.exclusion_confirmed, false);
  assert.equal(returnedSelfCandidate.report.returned_self_candidate_count, 1);
  assert.equal(returnedSelfCandidate.report.results[0].returned_self_candidate_count, 1);
  assert.equal(returnedSelfCandidate.report.results[0].same_card_exclusion_evidence_present, true);
}

{
  const conflictedCatalogOnly = await runProvider("catalog-only", {
    titleResponder({ body }) {
      return {
        final_title: "Wrong Player",
        confidence: "HIGH",
        provider: body.provider,
        catalog_candidate_packet: {
          vector_retrieval: {
            candidates: [{
              candidate_id: "cat-conflict",
              provider_id: "catalog",
              source_url: "supabase://catalog-cards/cat-conflict",
              title: "2025 Topps Chrome Test Player",
              supporting_fields: ["players", "year", "product"],
              conflicting_fields: ["serial_number"]
            }]
          }
        },
        timing: { total_ms: 321 }
      };
    }
  });
  assert.equal(conflictedCatalogOnly.report.pass_at_0_72_count, 0);
  assert.equal(conflictedCatalogOnly.report.raw_pass_at_0_72_count, 0);
  assert.equal(conflictedCatalogOnly.report.candidate_proxy_selected_count, 0);
  assert.equal(conflictedCatalogOnly.report.results[0].candidate_proxy_decision.policy, "disabled_without_reviewed_title_gt_eval_mode");
}

{
  const conflictedVectorReview = await runProvider("d", {
    titleResponder({ body }) {
      return {
        final_title: "Wrong Player",
        confidence: "HIGH",
        provider: body.provider,
        catalog_candidate_packet: {
          vector_retrieval: {
            candidates: [{
              candidate_id: "cat-conflict",
              provider_id: "catalog",
              source_url: "supabase://catalog-cards/cat-conflict",
              title: "2025 Topps Chrome Test Player",
              supporting_fields: ["players", "year", "product"],
              conflicting_fields: ["serial_number"]
            }]
          }
        },
        vector_candidate_packet: {
          vector_retrieval: {
            candidates: []
          }
        },
        vector_assist_eligibility: {
          eligible: false,
          reason: "approved_identity_candidate_direct_conflict",
          raw_candidate_count: 1,
          approved_candidate_count: 1,
          conflict_blocked_count: 1,
          prompt_candidate_count: 0,
          prompt_candidate_ids: []
        },
        timing: { total_ms: 654 }
      };
    }
  });
  assert.equal(conflictedVectorReview.report.raw_pass_at_0_72_count, 0);
  assert.equal(conflictedVectorReview.report.pass_at_0_72_count, 0);
  assert.equal(conflictedVectorReview.report.candidate_proxy_selected_count, 0);
  assert.equal(conflictedVectorReview.report.candidate_proxy_catalog_selected_count, 0);
  assert.equal(conflictedVectorReview.report.results[0].candidate_proxy_decision.policy, "disabled_without_reviewed_title_gt_eval_mode");
  assert.equal(conflictedVectorReview.report.results[0].candidate_proxy_decision.selected_candidate_id, "");
  assert.equal(conflictedVectorReview.report.decision_trace[0].candidate_guided_title, "");
}

{
  const assistShadow = await runProvider("d", {
    titleResponder({ body }) {
      return {
        final_title: "2025 Topps Chrome Test Player",
        confidence: "HIGH",
        provider: body.provider,
        model_id: "gpt-4.1-mini-2025-04-14",
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        rendered_fields: {
          title: "2025 Topps Chrome Test Player",
          rendered_title: "2025 Topps Chrome Test Player"
        },
        vector_assist_eligibility: {
          eligible: false,
          reason: "open_set_low_margin_match_not_prompt_safe",
          raw_candidate_count: 1,
          approved_candidate_count: 1,
          conflict_blocked_count: 0,
          prompt_candidate_count: 0,
          prompt_candidate_ids: []
        },
        vector_prompt_assist_used: false,
        fast_path: {
          enabled: true,
          used: false,
          single_model_fast: true,
          assist_shadow_only: true,
          skipped_evidence_completion: true,
          skipped_focused_reread: true,
          skipped_retrieval: true,
          reason: "assist_shadow_no_prompt_safe_candidates"
        },
        timing: { total_ms: 321 }
      };
    }
  });
  assert.equal(assistShadow.report.fast_path_used_count, 0);
  assert.equal(assistShadow.report.results[0].fast_path.assist_shadow_only, true);
  assert.equal(assistShadow.report.decision_trace[0].fast_path_used, false);
  assert.equal(assistShadow.report.vector_prompt_candidate_count, 0);
  assert.deepEqual(assistShadow.report.open_set_status_counts, { LOW_MARGIN_SIMILAR_ONLY: 1 });
  assert.equal(assistShadow.report.catalog_gap_queue_candidate_count, 1);
  assert.equal(assistShadow.report.fail_closed_candidate_count, 1);
  assert.equal(assistShadow.report.unknown_card_ready_count, 1);
  assert.equal(assistShadow.report.results[0].open_set_status, "LOW_MARGIN_SIMILAR_ONLY");
  assert.equal(assistShadow.report.decision_trace[0].open_set_status, "LOW_MARGIN_SIMILAR_ONLY");
}

const openaiVector = await runProvider("d");
assert.equal(openaiVector.report.provider, "openai_vector");
assert.equal(openaiVector.titlePayload.provider, "openai_legacy");
assert.equal(openaiVector.titlePayload.explicitEmergency, true);
assert.equal(openaiVector.titlePayload.provider_options.single_model_fast, false);
assert.equal(openaiVector.titlePayload.provider_options.enable_catalog_assist, true);
assert.equal(openaiVector.titlePayload.provider_options.enable_vector_assist, true);
assert.equal(openaiVector.titlePayload.provider_options.enable_evidence_completion, true);
assert.equal(openaiVector.titlePayload.provider_options.enable_stored_visual_features, true);
assert.equal(openaiVector.titlePayload.provider_options.enable_vector_retrieval, true);
assert.equal(openaiVector.titlePayload.provider_options.vector_retrieval_mode, "assist");
assert.equal(openaiVector.titlePayload.provider_options.enable_vector_lazy_mode, true);
assert.equal(openaiVector.titlePayload.provider_options.corrected_title_as_temporary_gt, true);
assert.equal(openaiVector.titlePayload.provider_options.vector_corrected_title_as_temporary_gt, true);
assert.equal(openaiVector.titlePayload.provider_options.send_corrected_title_hint_to_cloud, false);
assert.equal(openaiVector.titlePayload.catalog_observation_hint, null);
assert.equal(openaiVector.report.exclusion_requested, true);
assert.equal(openaiVector.report.exclusion_confirmed, true);
assert.equal(openaiVector.report.results[0].exclusion_observation.catalog.confirmed, true);
assert.equal(openaiVector.report.results[0].exclusion_observation.vector.confirmed, true);
assert.equal(openaiVector.report.results[0].exclusion_observation.vector.query_echo_count > 0, true);
assert.equal(openaiVector.titlePayload.provider_options.vector_query_timeout_ms, 20000);
assert.equal(openaiVector.titlePayload.provider_options.vector_retrieval_internal_top_n, 10);
assert.equal(openaiVector.titlePayload.provider_options.enable_advanced_retrieval, true);
assert.equal(openaiVector.titlePayload.provider_options.enable_hybrid_retrieval, true);
assert.equal(openaiVector.report.visual_vector_used_count, 1);
assert.equal(openaiVector.report.visual_vector_candidate_count, 1);
assert.equal(openaiVector.report.postgres_hybrid_used_count, 1);
assert.equal(openaiVector.report.postgres_hybrid_candidate_count, 1);
assert.equal(openaiVector.report.catalog_lookup_used_count, 1);
assert.equal(openaiVector.report.catalog_candidate_count, 1);
assert.equal(openaiVector.report.catalog_prompt_candidate_count, 1);
assert.equal(openaiVector.report.catalog_prompt_assist_used_count, 1);
assert.equal(openaiVector.report.catalog_cache_hit_count, 1);
assert.equal(openaiVector.report.catalog_cache_hit_rate, 1);
assert.deepEqual(openaiVector.report.catalog_prompt_candidate_ids, ["identity-1"]);
assert.equal(openaiVector.report.catalog_candidate_selected_count, 0);
assert.equal(openaiVector.report.correct_catalog_identity_available_count, 0);
assert.equal(openaiVector.report.correct_candidate_recall_at_1, 0);
assert.equal(openaiVector.report.correct_candidate_recall_at_3, 0);
assert.equal(openaiVector.report.correct_candidate_recall_at_5, 0);
assert.equal(openaiVector.report.catalog_candidate_available_rate, 0);
assert.deepEqual(openaiVector.report.candidate_recall_at_1, { count: 0, denominator: 1, rate: 0 });
assert.deepEqual(openaiVector.report.candidate_recall_at_3, { count: 0, denominator: 1, rate: 0 });
assert.deepEqual(openaiVector.report.candidate_recall_at_5, { count: 0, denominator: 1, rate: 0 });
assert.equal(openaiVector.report.gpt_selected_correct_candidate_count, 0);
assert.equal(openaiVector.report.gpt_rejected_correct_candidate_count, 0);
assert.equal(openaiVector.report.candidate_selection_accuracy.rate, null);
assert.equal(openaiVector.report.vector_raw_candidate_count, 2);
assert.equal(openaiVector.report.vector_approved_candidate_count, 1);
assert.equal(openaiVector.report.vector_conflict_blocked_count, 1);
assert.equal(openaiVector.report.vector_prompt_candidate_count, 1);
assert.deepEqual(openaiVector.report.vector_prompt_candidate_ids, ["identity-1"]);
assert.equal(openaiVector.report.vector_lazy_skip_count, 1);
assert.equal(openaiVector.report.vector_lazy_skip_rate, 1);
assert.deepEqual(openaiVector.report.open_set_status_counts, { KNOWN_CATALOG_ASSISTED: 1 });
assert.equal(openaiVector.report.known_catalog_candidate_available_count, 1);
assert.equal(openaiVector.report.catalog_gap_queue_candidate_count, 0);
assert.equal(openaiVector.report.fail_closed_candidate_count, 0);
assert.equal(openaiVector.report.unknown_card_ready_count, 0);
assert.equal(openaiVector.report.retrieval_title_assist_used_count, 1);
assert.equal(openaiVector.report.fast_path_used_count, 0);
assert.equal(openaiVector.report.exact_anchor_fast_lane_eligible_count, 1);
assert.equal(openaiVector.report.exact_anchor_fast_lane_eligible_rate, 1);
assert.equal(openaiVector.report.exact_anchor_would_skip_vector_count, 1);
assert.equal(openaiVector.report.exact_anchor_would_use_title_scaffold_count, 1);
assert.equal(openaiVector.report.results[0].catalog_prompt_assist_used, true);
assert.equal(openaiVector.report.results[0].catalog_cache_hit, true);
assert.equal(openaiVector.report.results[0].catalog_prompt_candidate_count, 1);
assert.equal(openaiVector.report.results[0].vector_prompt_assist_used, true);
assert.equal(openaiVector.report.results[0].vector_lazy_skip, true);
assert.equal(openaiVector.report.results[0].vector_lazy_skip_reason, "vector_lazy_strong_catalog_anchor");
assert.equal(openaiVector.report.results[0].exact_anchor_fast_lane_eligible, true);
assert.equal(openaiVector.report.results[0].exact_anchor_candidate_id, "identity-1");
assert.equal(openaiVector.report.results[0].exact_anchor_would_skip_vector, true);
assert.equal(openaiVector.report.results[0].exact_anchor_would_use_title_scaffold, true);
assert.equal(openaiVector.report.results[0].vector_raw_candidate_count, 2);
assert.deepEqual(openaiVector.report.results[0].vector_prompt_candidate_ids, ["identity-1"]);
assert.equal(openaiVector.report.results[0].open_set_status, "KNOWN_CATALOG_ASSISTED");
assert.equal(openaiVector.report.results[0].retrieval_title_assist_used, true);
assert.equal(openaiVector.report.results[0].retrieval_title_assist.provider_id, "postgres_hybrid");
assert.deepEqual(openaiVector.report.results[0].retrieval_providers_used, ["catalog", "visual_vector", "postgres_hybrid"]);
assert.equal(openaiVector.report.decision_trace[0].catalog_vector_title, "2025 Topps Chrome Test Player");
assert.equal(openaiVector.report.decision_trace[0].catalog_prompt_candidate_count, 1);
assert.equal(openaiVector.report.decision_trace[0].vector_prompt_candidate_count, 1);
assert.equal(openaiVector.report.decision_trace[0].exact_anchor_fast_lane_eligible, true);
assert.equal(openaiVector.report.decision_trace[0].exact_anchor_would_skip_vector, true);
assert.equal(openaiVector.report.decision_trace[0].open_set_status, "KNOWN_CATALOG_ASSISTED");
assert.equal(openaiVector.report.decision_trace[0].retrieval_title_assist_used, true);
assert.equal(openaiVector.report.decision_trace[0].retrieval_title_assist.candidate_identity_id, "identity-1");
assert.equal(openaiVector.report.decision_trace[0].fast_path_used, false);
assert.equal(openaiVector.report.decision_trace[0].recovery_regression_no_change, "paired_baseline_required");

const openaiVectorNoLazy = await runProvider("d", {
  evaluateOptions: {
    disableVectorLazyMode: true
  }
});
assert.equal(openaiVectorNoLazy.titlePayload.provider_options.enable_vector_lazy_mode, false);
assert.equal(openaiVectorNoLazy.report.vector_lazy_skip_count, 0);
assert.equal(openaiVectorNoLazy.report.vector_lazy_skip_rate, 0);
assert.equal(openaiVectorNoLazy.report.results[0].vector_lazy_skip, false);

const openaiVectorForced = await runProvider("d", {
  evaluateOptions: {
    forceVectorAssist: true
  }
});
assert.equal(openaiVectorForced.titlePayload.provider_options.enable_vector_assist, true);
assert.equal(openaiVectorForced.titlePayload.provider_options.force_vector_assist, true);
assert.equal(openaiVectorForced.titlePayload.provider_options.vector_index_ready, undefined);
assert.equal(openaiVectorForced.titlePayload.provider_options.enable_vector_lazy_mode, false);
assert.equal(openaiVectorForced.titlePayload.provider_options.eval_flags.FORCE_VECTOR_ASSIST, true);
assert.equal(openaiVectorForced.titlePayload.provider_options.eval_flags.ENABLE_VECTOR_LAZY_MODE, false);
assert.equal(openaiVectorForced.report.vector_lazy_skip_count, 0);
assert.equal(openaiVectorForced.report.results[0].vector_lazy_skip, false);

const openaiVectorForcedReady = await runProvider("d", {
  evaluateOptions: {
    forceVectorAssist: true,
    vectorIndexReady: true
  }
});
assert.equal(openaiVectorForcedReady.titlePayload.provider_options.force_vector_assist, true);
assert.equal(openaiVectorForcedReady.titlePayload.provider_options.vector_index_ready, true);

const openaiVectorRuntimeTimeout = await runProvider("d", {
  evaluateOptions: {
    forceVectorAssist: true,
    vectorIndexReady: true,
    runtimeEnv: {
      VECTOR_QUERY_TIMEOUT_MS: "120000"
    }
  }
});
assert.equal(openaiVectorRuntimeTimeout.titlePayload.provider_options.vector_query_timeout_ms, 120000);

{
  const recovered = await runProvider("d", {
    evaluateOptions: {
      providerErrorRetries: 1,
      providerErrorRetryDelayMs: 0
    },
    titleResponder({ body, callIndex, vectorEnabled }) {
      if (callIndex === 0) {
        return {
          confidence: "FAILED",
          provider: body.provider,
          provider_error_code: "bad_request",
          reason: "temporary provider failure"
        };
      }
      return {
        final_title: "2025 Topps Chrome Test Player",
        confidence: "HIGH",
        provider: body.provider,
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        retrieval: vectorEnabled
          ? {
            providers_used: ["visual_vector"],
            sources: [{ source_type: "VISUAL_VECTOR", matched_fields: ["visual_vector"] }]
          }
          : null,
        timing: { total_ms: 456 }
      };
    }
  });
  assert.equal(recovered.report.attempted_count, 1);
  assert.equal(recovered.report.evaluated_count, 1);
  assert.equal(recovered.report.provider_error_count, 0);
  assert.equal(recovered.report.technical_failure_count, 0);
  assert.equal(recovered.report.provider_error_recovered_count, 1);
  assert.equal(recovered.report.provider_error_retry_count, 1);
  assert.equal(recovered.report.provider_success_count, 1);
  assert.equal(recovered.report.results[0].provider_error_recovered, true);
  assert.equal(recovered.titlePayloads.length, 2);
}

{
  let titleCalls = 0;
  const timeoutRecovered = await evaluateCloudListingApi({
    dataset,
    baseUrl: "https://lynca.example",
    provider: "openai_legacy",
    limit: 1,
    concurrency: 1,
    username: "listing",
    password: "password",
    requestTimeoutMs: 1,
    providerErrorRetries: 0,
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/login") {
        return jsonResponse(200, { ok: true }, {
          "set-cookie": "lynca_metaverse_session=test-cookie; Path=/"
        });
      }
      if (path === "/api/listing-provider-status") {
        return jsonResponse(200, { providers: [], default_provider: "openai_legacy" });
      }
      if (path === "/api/listing-image-verify-existing") {
        const body = JSON.parse(init.body);
        return jsonResponse(200, {
          ok: true,
          verification: {
            bucket: body.bucket,
            object_path: body.object_path,
            verification_token: `verified-${body.image_id}`,
            content_type: "image/jpeg",
            size: 1000,
            width: 100,
            height: 100,
            content_sha256: "sha"
          }
        });
      }
      if (path === "/api/listing-copilot-title") {
        titleCalls += 1;
        if (titleCalls === 1) {
          return new Promise((resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        }
        return jsonResponse(200, {
          final_title: "2025 Topps Chrome Test Player",
          confidence: "HIGH",
          provider: "openai_legacy",
          timing: { total_ms: 111 }
        });
      }
      throw new Error(`unexpected fetch path for timeout retry: ${path}`);
    }
  });
  assert.equal(timeoutRecovered.technical_failure_count, 0);
  assert.equal(timeoutRecovered.provider_success_count, 1);
  assert.equal(titleCalls, 2);
}

{
  const unrecovered = await runProvider("d", {
    evaluateOptions: {
      providerErrorRetries: 1,
      providerErrorRetryDelayMs: 0
    },
    titleResponder({ body }) {
      return {
        confidence: "FAILED",
        provider: body.provider,
        provider_error_code: "bad_request",
        reason: "persistent provider failure"
      };
    }
  });
  assert.equal(unrecovered.report.attempted_count, 1);
  assert.equal(unrecovered.report.evaluated_count, 1);
  assert.equal(unrecovered.report.provider_error_count, 0);
  assert.equal(unrecovered.report.technical_failure_count, 1);
  assert.equal(unrecovered.report.provider_error_recovered_count, 0);
  assert.equal(unrecovered.report.provider_error_retry_count, 2);
  assert.equal(unrecovered.report.provider_success_count, 0);
  assert.equal(unrecovered.report.provider_success_rate, 0);
  assert.deepEqual(unrecovered.report.open_set_status_counts, { TECHNICAL_FAILURE: 1 });
  assert.equal(unrecovered.report.results[0].status, "evaluated");
  assert.equal(unrecovered.report.results[0].technical_failure, true);
  assert.equal(unrecovered.report.results[0].open_set_status, "TECHNICAL_FAILURE");
  assert.equal(unrecovered.titlePayloads.length, 2);
}

{
  let titleCalled = false;
  const report = await evaluateCloudListingApi({
    dataset,
    baseUrl: "https://lynca.example",
    provider: "openai_legacy",
    limit: 0,
    concurrency: 1,
    username: "listing",
    password: "password",
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/login") {
        return jsonResponse(200, { ok: true }, {
          "set-cookie": "lynca_metaverse_session=test-cookie; Path=/"
        });
      }
      if (path === "/api/listing-provider-status") {
        return jsonResponse(200, { providers: [], default_provider: "openai_legacy" });
      }
      if (path === "/api/listing-copilot-title") titleCalled = true;
      throw new Error(`unexpected fetch path for limit=0: ${path}`);
    }
  });
  assert.equal(report.target_count, 0);
  assert.equal(report.attempted_count, 0);
  assert.equal(titleCalled, false);
}

{
  const tempDir = await mkdtemp(join(tmpdir(), "lynca-cloud-eval-compare-"));
  try {
    const baselinePath = join(tempDir, "baseline.json");
    const catalogPath = join(tempDir, "catalog.json");
    const vectorPath = join(tempDir, "vector.json");
    const baseReport = {
      target_count: 2,
      corrected_title_token_recall_avg: 0.5,
      pass_at_0_72_count: 0,
      pass_at_0_80_count: 0,
      per_card_latency_ms: { p50: 100, p95: 200 },
      usage_totals: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      results: [{
        candidate_id: "recover-card",
        title: "Wrong Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 0.25 }
      }, {
        candidate_id: "regress-card",
        title: "2025 Topps Chrome Test Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 1 }
      }]
    };
    const catalogReport = {
      target_count: 2,
      catalog_lookup_used_count: 2,
      catalog_candidate_count: 2,
      catalog_prompt_candidate_count: 1,
      catalog_candidate_selected_count: 1,
      pass_at_0_72_count: 2,
      pass_at_0_80_count: 2,
      results: [{
        candidate_id: "recover-card",
        title: "2025 Topps Chrome Test Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 1 },
        catalog_candidates: [{ id: "cat-1", title: "2025 Topps Chrome Test Player" }],
        catalog_selected_candidate_id: "cat-1"
      }, {
        candidate_id: "regress-card",
        title: "2025 Topps Chrome Test Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 1 }
      }]
    };
    const vectorReport = {
      target_count: 2,
      vector_raw_candidate_count: 2,
      vector_prompt_candidate_count: 1,
      pass_at_0_72_count: 1,
      pass_at_0_80_count: 1,
      results: [{
        candidate_id: "recover-card",
        title: "2025 Topps Chrome Test Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 1 },
        vector_candidates: [{ id: "vec-1", title: "2025 Topps Chrome Test Player" }],
        vector_selected_candidate_id: "vec-1"
      }, {
        candidate_id: "regress-card",
        title: "Wrong Product",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 0.5 }
      }]
    };
    await Promise.all([
      writeFile(baselinePath, JSON.stringify(baseReport)),
      writeFile(catalogPath, JSON.stringify(catalogReport)),
      writeFile(vectorPath, JSON.stringify(vectorReport))
    ]);
    const comparison = await compareCloudEvalAblation({
      baselinePath,
      catalogPath,
      vectorPath,
      threshold: 0.72
    });
    assert.equal(comparison.summary.catalog_recovery_count, 1);
    assert.equal(comparison.summary.catalog_regression_count, 0);
    assert.equal(comparison.summary.vector_recovery_count, 0);
    assert.equal(comparison.summary.vector_regression_count, 0);
    assert.equal(comparison.decision_trace[0].catalog_change, "recovery");
    assert.equal(comparison.decision_trace[0].vector_selected_candidate_id, "vec-1");
    assert.equal(comparison.decision_trace[1].vector_change, "no_change");
    assert.equal(comparison.decision_trace[1].catalog_vector_title, "2025 Topps Chrome Test Player");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await assert.rejects(
  () => runProvider("removed_legacy_provider"),
  /Unsupported cloud eval provider/i
);

await assert.rejects(
  () => runProvider("removed_provider"),
  /Unsupported cloud eval provider/i
);

assert.doesNotThrow(() => validateProtectionBypassSecret({
  bypassSecret: "valid-vercel-bypass-token",
  env: {
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test"
  }
}));

assert.throws(
  () => validateProtectionBypassSecret({
    bypassSecret: "sb_secret_test",
    env: {}
  }),
  /looks like a Supabase secret key/i
);

const rebuiltReport = rebuildCloudListingEvalReport({
  schema_version: "cloud-listing-api-eval-v1",
  provider: "retrieval_on",
  elapsed_ms: 60_000,
  experiment_contract: { arm: "on" },
  results: [
    {
      candidate_id: "kept-card",
      status: "evaluated",
      confidence: "HIGH",
      technical_failure: false,
      provider_success: true,
      elapsed_ms: 10_000,
      usage: { provider_calls: 1, input_tokens: 100, output_tokens: 20, total_tokens: 120 }
    },
    {
      candidate_id: "retried-card",
      technical_failure: true,
      provider_success: false,
      elapsed_ms: 30_000,
      provider_error_attempts: [{ attempt: 1 }, { attempt: 2 }]
    }
  ]
}, [{
  provider: "retrieval_on",
  elapsed_ms: 12_000,
  experiment_contract: { arm: "on" },
  results: [{
    candidate_id: "retried-card",
    status: "evaluated",
    confidence: "HIGH",
    technical_failure: false,
    provider_success: true,
    elapsed_ms: 8_000,
    usage: { provider_calls: 1, input_tokens: 80, output_tokens: 10, total_tokens: 90 }
  }]
}]);
assert.equal(rebuiltReport.provider_success_count, 2);
assert.equal(rebuiltReport.technical_failure_count, 0);
assert.equal(rebuiltReport.elapsed_ms, 72_000);
assert.equal(rebuiltReport.usage_totals.total_tokens, 210);
assert.deepEqual(rebuiltReport.retry_recovery.replaced_candidate_ids, ["retried-card"]);
assert.equal(rebuiltReport.retry_recovery.original_failed_attempt_count, 2);
assert.throws(
  () => rebuildCloudListingEvalReport({ provider: "retrieval_on", results: [] }, [{ provider: "retrieval_off", results: [] }]),
  /does not match base provider/
);

assert.throws(
  () => validateProtectionBypassSecret({
    bypassSecret: "same-secret",
    env: {
      SUPABASE_SERVICE_ROLE_KEY: "same-secret"
    }
  }),
  /matches a Supabase service\/secret key/i
);

// Fair scoring: identity-equivalent tokens match; seller noise leaves the denominator.
assert.equal(fairTokenRecall("Pele Rookie RC Autograph", "Pel\u00e9 RC Auto"), 1); // diacritics + synonym classes fold
assert.equal(fairTokenRecall("Card 24/25 PSA", "Card 24/25 PSA"), 1);
assert.equal(fairTokenRecall("Card #/25", "Card 24/25"), 1); // full serial covers denominator-only reference
assert.equal(fairTokenRecall("Card 24/25", "Card #/25"), 1); // denominator support gets broad recall credit; exactness is scored separately
assert.equal(fairTokenRecall("Card 04/10 BGS", "Card 4/10 Beckett"), 1); // leading zeros + grader alias
assert.equal(fairTokenRecall("Curry PSA 10 POP 2", "Curry PSA 10 2"), 1); // POP excluded from denominator
assert.equal(fairTokenRecall("Wemby SSP Case Hit RC", "Wemby SSP RC"), 1); // case-hit bigram excluded
assert.equal(policyFairTokenRecall("2024 Bowman Chrome Sample Auto #BCP79 Yankees", "2024 Bowman Chrome Sample Auto"), 1);
assert.equal(policyFairTokenRecall("2018-19 Panini Threads Trae Young Rookies Premium RC Auto #/105 Hawks BGS 9.5", "2018-19 Panini Threads Trae Young Rookie Signatures Red 87/105 Auto BGS 9.5/10") >= 0.72, true);
assert.equal(policyFairTokenRecall("2022 Mosaic Patrick Mahomes II Choice Nebula #1/1 Chiefs PSA 10", "2022 Mosaic Patrick Mahomes Choice Nebula 1/1 PSA 10"), 1);
assert.equal(policyFairTokenRecall("2024 Topps Chrome Red Refractor", "2024 Topps Chrome Refractor") < 1, true); // Red is a finish/color, not a removable team token.
assert.equal(policyFairTokenRecall("2024 Bowman Chrome New Breed Auto", "2024 Bowman Chrome Auto") < 1, true); // New Breed is a card name, not New York.
assert.equal(policyFairTokenRecall("2024 Topps Red Sox Auto", "2024 Topps Auto"), 1);
assert.equal(policyFairTokenRecall("2024 New York Yankees Auto", "2024 Auto"), 1);
assert.equal(policyFairTokenRecall("2021 Bowman Draft Tyler Black Chrome Auto RC Red Refractor 1st #/5 PSA 10 9", "2021 Bowman Chrome Tyler Black Chrome Draft Pick Auto Red Ref. 4/5 #CDA PSA 10/9") >= 0.72, true);
assert.equal(
  policyFairTokenRecall(
    "2025 Disney Lorcana JP Mickey Mouse Special PR Volume 1 Iconic #242 PSA 10",
    "2025 Japanese Disney Lorcana Special PR Vol.1 Iconic Mickey Mouse 242/204 PSA 10"
  ) >= 0.72,
  true
); // Language and volume aliases are formatting-equivalent, not identity errors.

console.log("cloud listing API eval tests passed");
