import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateCloudListingApi, validateProtectionBypassSecret } from "./evaluate-cloud-listing-api.mjs";
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

async function runProvider(provider, options = {}) {
  const titlePayloads = [];
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
      const body = JSON.parse(init.body);
      titlePayloads.push(body);
      const catalogEnabled = body.provider_options?.enable_evidence_completion === true
        && body.provider_options?.enable_catalog_assist === true;
      const vectorEnabled = body.provider_options?.enable_evidence_completion === true
        && body.provider_options?.enable_stored_visual_features === true
        && body.provider_options?.enable_vector_retrieval === true
        && body.provider_options?.vector_retrieval_mode === "assist";
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
              { family: "visual_vector", provider_id: "visual_vector" },
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
        vector_retrieval: vectorEnabled
          ? {
            providers_used: ["visual_vector"],
            queries: [{ family: "SEARCH_VISUAL_VECTOR", provider_id: "visual_vector" }],
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
        visual_features: vectorEnabled
          ? { features: [{ embedding: [0.1, 0.2], embedding_role: "front_global" }] }
          : null,
        timing: {
          total_ms: 1234
        }
      });
    }

    throw new Error(`unexpected fetch path: ${path}`);
  };

  const report = await evaluateCloudListingApi({
    dataset,
    baseUrl: "https://lynca.example",
    provider,
    limit: 1,
    concurrency: 1,
    username: "listing",
    password: "password",
    fetchImpl,
    ...(options.evaluateOptions || {})
  });

  return { report, titlePayload: titlePayloads[0], titlePayloads };
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
assert.equal(openai.report.accuracy_policy.corrected_title_hint_sent_to_cloud, false);
assert.equal(openai.report.accuracy_policy.corrected_title_temporary_gt_scope, "cloud_eval_proxy_title_candidate_scoring_and_optional_cloud_hint");
assert.equal(openai.report.accuracy_policy.corrected_title_token_recall_is_identity_accuracy, false);
assert.equal(openai.report.results[0].corrected_title_as_temporary_gt, false);
assert.equal(openai.report.results[0].corrected_title_hint_sent_to_cloud, false);
assert.equal(openai.report.pass_at_0_72_count, 1);
assert.equal(openai.report.pass_at_0_80_count, 1);
assert.equal(openai.report.raw_blind_output_accuracy.pass_at_0_72_count, 1);
assert.equal(openai.report.oracle_candidate_upper_bound.pass_at_0_80_count, 1);
assert.equal(openai.report.fast_path_used_count, 0);
assert.equal(openai.report.catalog_prompt_assist_used_count, 0);
assert.deepEqual(openai.report.catalog_prompt_candidate_ids, []);
assert.equal(openai.report.card_type_default_base_count, 0);
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
assert.equal(openaiCatalog.report.accuracy_policy.corrected_title_as_temporary_gt, true);
assert.equal(openaiCatalog.report.accuracy_policy.corrected_title_hint_sent_to_cloud, false);
assert.equal(openaiCatalog.report.results[0].corrected_title_hint_sent_to_cloud, false);
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
assert.equal(openaiCatalogWithHint.titlePayload.provider_options.send_corrected_title_hint_to_cloud, true);
assert.equal(openaiCatalogWithHint.titlePayload.provider_options.cloud_eval_blind_to_corrected_title_hint, false);
assert.equal(openaiCatalogWithHint.titlePayload.catalog_observation_hint.year, "2025");
assert.equal(openaiCatalogWithHint.titlePayload.catalog_observation_hint.product, "Topps Chrome");
assert.deepEqual(openaiCatalogWithHint.titlePayload.catalog_observation_hint.players, ["Test Player"]);
assert.equal(openaiCatalogWithHint.report.accuracy_policy.corrected_title_hint_sent_to_cloud, true);
assert.equal(openaiCatalogWithHint.report.results[0].corrected_title_hint_sent_to_cloud, true);

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
  assert.equal(conflictedCatalogOnly.report.results[0].candidate_proxy_decision.policy, "temporary_gt_catalog_safe_no_conflict_lane");
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
  assert.equal(conflictedVectorReview.report.pass_at_0_72_count, 1);
  assert.equal(conflictedVectorReview.report.candidate_proxy_selected_count, 1);
  assert.equal(conflictedVectorReview.report.candidate_proxy_catalog_selected_count, 1);
  assert.equal(conflictedVectorReview.report.results[0].candidate_proxy_decision.policy, "temporary_gt_catalog_vector_conflict_review_lane");
  assert.equal(conflictedVectorReview.report.results[0].candidate_proxy_decision.selected_candidate_id, "cat-conflict");
  assert.equal(conflictedVectorReview.report.decision_trace[0].candidate_guided_title, "2025 Topps Chrome Test Player");
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
assert.equal(openaiVector.titlePayload.provider_options.corrected_title_as_temporary_gt, true);
assert.equal(openaiVector.titlePayload.provider_options.vector_corrected_title_as_temporary_gt, true);
assert.equal(openaiVector.titlePayload.provider_options.send_corrected_title_hint_to_cloud, false);
assert.equal(openaiVector.titlePayload.catalog_observation_hint, null);
assert.equal(openaiVector.titlePayload.provider_options.vector_query_timeout_ms, 120000);
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
assert.deepEqual(openaiVector.report.catalog_prompt_candidate_ids, ["identity-1"]);
assert.equal(openaiVector.report.catalog_candidate_selected_count, 0);
assert.equal(openaiVector.report.correct_catalog_identity_available_count, 1);
assert.equal(openaiVector.report.correct_candidate_recall_at_1, 1);
assert.equal(openaiVector.report.correct_candidate_recall_at_3, 1);
assert.equal(openaiVector.report.correct_candidate_recall_at_5, 1);
assert.equal(openaiVector.report.catalog_candidate_available_rate, 1);
assert.deepEqual(openaiVector.report.candidate_recall_at_1, { count: 1, denominator: 1, rate: 1 });
assert.deepEqual(openaiVector.report.candidate_recall_at_3, { count: 1, denominator: 1, rate: 1 });
assert.deepEqual(openaiVector.report.candidate_recall_at_5, { count: 1, denominator: 1, rate: 1 });
assert.equal(openaiVector.report.gpt_selected_correct_candidate_count, 0);
assert.equal(openaiVector.report.gpt_rejected_correct_candidate_count, 0);
assert.equal(openaiVector.report.candidate_selection_accuracy.rate, 0);
assert.equal(openaiVector.report.vector_raw_candidate_count, 2);
assert.equal(openaiVector.report.vector_approved_candidate_count, 1);
assert.equal(openaiVector.report.vector_conflict_blocked_count, 1);
assert.equal(openaiVector.report.vector_prompt_candidate_count, 1);
assert.deepEqual(openaiVector.report.vector_prompt_candidate_ids, ["identity-1"]);
assert.equal(openaiVector.report.fast_path_used_count, 0);
assert.equal(openaiVector.report.results[0].catalog_prompt_assist_used, true);
assert.equal(openaiVector.report.results[0].catalog_prompt_candidate_count, 1);
assert.equal(openaiVector.report.results[0].vector_prompt_assist_used, true);
assert.equal(openaiVector.report.results[0].vector_raw_candidate_count, 2);
assert.deepEqual(openaiVector.report.results[0].vector_prompt_candidate_ids, ["identity-1"]);
assert.deepEqual(openaiVector.report.results[0].retrieval_providers_used, ["catalog", "visual_vector", "postgres_hybrid"]);
assert.equal(openaiVector.report.decision_trace[0].catalog_vector_title, "2025 Topps Chrome Test Player");
assert.equal(openaiVector.report.decision_trace[0].catalog_prompt_candidate_count, 1);
assert.equal(openaiVector.report.decision_trace[0].vector_prompt_candidate_count, 1);
assert.equal(openaiVector.report.decision_trace[0].fast_path_used, false);
assert.equal(openaiVector.report.decision_trace[0].recovery_regression_no_change, "paired_baseline_required");

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
  assert.equal(unrecovered.report.results[0].status, "evaluated");
  assert.equal(unrecovered.report.results[0].technical_failure, true);
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
  () => runProvider("agnes"),
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

assert.throws(
  () => validateProtectionBypassSecret({
    bypassSecret: "same-secret",
    env: {
      SUPABASE_SERVICE_ROLE_KEY: "same-secret"
    }
  }),
  /matches a Supabase service\/secret key/i
);

console.log("cloud listing API eval tests passed");
