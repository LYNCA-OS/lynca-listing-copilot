import assert from "node:assert/strict";
import {
  evaluateAgnesSupabaseFeedback,
  formatAgnesSupabaseFeedbackSummary,
  titleComparison
} from "./evaluate-agnes-supabase-feedback.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";

const dataset = {
  schema_version: "recognition-candidate-export-v1",
  manifest_hash: "test-manifest",
  source: {
    provider: "supabase_sql_export",
    table: "listing_title_feedback",
    source_row_count: 3,
    image_backed_row_count: 3
  },
  summary: {
    item_count: 3,
    corrected_title_used_as_ground_truth: false
  },
  items: [
    {
      asset_id: "supabase_feedback_fb1",
      source_feedback_id: "fb1",
      category: "sports_card",
      review_status: "NEEDS_REVIEW",
      images: [
        {
          role: "front_original",
          bucket: "listing-feedback-images",
          object_path: "feedback/2026-06/fb1/front.jpg"
        },
        {
          role: "back_original",
          bucket: "listing-feedback-images",
          object_path: "feedback/2026-06/fb1/back.jpg"
        }
      ],
      source_titles: {
        generated_title: "2025 Topps Chrome Shohei Ohtani Red Refractor 5/5",
        corrected_title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10"
      }
    },
    {
      asset_id: "supabase_feedback_fb2",
      source_feedback_id: "fb2",
      category: "sports_card",
      review_status: "NEEDS_REVIEW",
      images: [
        {
          role: "front_original",
          bucket: "listing-feedback-images",
          object_path: "feedback/2026-06/fb2/front.jpg"
        },
        {
          role: "back_original",
          bucket: "listing-feedback-images",
          object_path: "feedback/2026-06/fb2/back.jpg"
        }
      ],
      source_titles: {
        generated_title: "2024 Panini Prizm Victor Wembanyama Silver RC",
        corrected_title: "2024 Panini Prizm Victor Wembanyama Silver Prizm RC"
      }
    },
    {
      asset_id: "supabase_feedback_fb3",
      source_feedback_id: "fb3",
      category: "sports_card",
      review_status: "NEEDS_REVIEW",
      images: [
        {
          role: "front_original",
          bucket: "listing-feedback-images",
          object_path: "feedback/2026-06/fb3/front.jpg"
        }
      ],
      source_titles: {
        generated_title: "missing corrected",
        corrected_title: ""
      }
    }
  ]
};

const signedRequests = [];
const analyzed = [];
const report = await evaluateAgnesSupabaseFeedback({
  dataset,
  concurrency: 2,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => {
    signedRequests.push({ objectPath, bucket });
    return `https://signed.test/${bucket}/${objectPath}?token=secret`;
  },
  analyzeImpl: async ({ images }) => {
    analyzed.push(images);
    assert.ok(images.every((image) => image.url.includes("token=secret")));
    const firstUrl = images[0].url;
    if (firstUrl.includes("/fb1/")) {
      return {
        model_id: "agnes-test",
        parse_source: "content",
        finish_reason: "stop",
        parsed: {
          title: "2025 Topps Chrome Shohei Ohtani Red Refractor 5/5 PSA 10",
          confidence: "HIGH",
          reason: "visible fields",
          fields: {
            year: "2025",
            manufacturer: "Topps",
            product: "Topps Chrome",
            players: ["Shohei Ohtani"],
            parallel: "Red Refractor",
            serial_number: "5/5",
            grade_company: "PSA",
            card_grade: "10"
          },
          unresolved: []
        },
        usage: {
          provider_calls: 1,
          image_count: images.length,
          estimated_cost_usd: 0.01,
          latency_ms: 100
        }
      };
    }

    return {
      model_id: "agnes-test",
      parse_source: "content",
      finish_reason: "stop",
      parsed: {
        title: "2024 Panini Prizm Victor Wembanyama Silver Prizm RC",
        confidence: "HIGH",
        reason: "visible fields",
        fields: {
          year: "2024",
          manufacturer: "Panini",
          product: "Prizm",
          players: ["Victor Wembanyama"],
          parallel: "Silver Prizm",
          rc: true
        },
        unresolved: []
      },
      usage: {
        provider_calls: 1,
        image_count: images.length,
        estimated_cost_usd: 0.01,
        latency_ms: 100
      }
    };
  },
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

assert.equal(report.status, "completed");
assert.equal(report.target_count, 3);
assert.equal(report.attempted_count, 3);
assert.equal(report.evaluated_count, 2);
assert.equal(report.invalid_candidate_count, 1);
assert.equal(report.provider_error_count, 0);
assert.equal(report.corrected_title_reference_only, true);
assert.equal(report.field_ground_truth_available, false);
assert.equal(report.commercial_accuracy_claim_allowed, false);
assert.equal(report.commercial_accuracy_eval_eligible, false);
assert.equal(report.identity_resolution_enabled, false);
assert.equal(report.no_feedback_retention_side_effects, true);
assert.equal(report.proactive_focused_rereads_enabled, false);
assert.equal(report.full_sample_evaluation, true);
assert.equal(report.corrected_title_exact_count, 1);
assert.equal(report.critical_title_error_count, 1);
assert.equal(report.identity_abstain_count, 0);
assert.equal(report.all_in_commercial_success_count, 1);
assert.equal(report.all_in_commercial_failure_count, 2);
assert.equal(report.all_in_commercial_accuracy, 0.333333);
assert.equal(report.all_in_commercial_accuracy_target, 0.95);
assert.equal(report.all_in_commercial_accuracy_passed, false);
assert.equal(report.throughput_objective.metric, "correct_cards_per_minute");
assert.equal(report.dangerous_error_rate, 0.5);
assert.equal(report.accepted_coverage_rate, 0.666667);
assert.equal(report.component_quality.model, "accuracy_factor_chain_v1");
assert.equal(report.component_quality.reviewed_ground_truth_available, false);
assert.equal(report.component_quality.factors.evidence_recall.value, null);
assert.ok(Number.isFinite(report.component_quality.factors.evidence_recall.proxy_value));
assert.equal(report.component_quality.factors.decision_quality.gate_false_accept_count, 1);
assert.equal(report.component_quality.factors.decision_quality.gate_false_reject_count, 0);
assert.equal(report.gate_confusion_matrix.true_accept, 1);
assert.equal(report.gate_confusion_matrix.false_accept, 1);
assert.equal(report.gate_confusion_matrix.true_reject, 0);
assert.equal(report.gate_confusion_matrix.false_reject, 0);
assert.equal(report.root_cause_summary.gate_confusion_matrix.false_accept, 1);
assert.equal(report.root_cause_summary.counts.CAPTURE_FAILURE, 1);
assert.equal(report.root_cause_summary.counts.GATE_FALSE_ACCEPT, 1);
assert.equal(report.root_cause_summary.counts.PERCEPTION_FAILURE, 1);
assert.deepEqual(report.results[1].root_cause_codes, []);
assert.ok(report.results[0].root_cause_codes.includes("GATE_FALSE_ACCEPT"));
assert.ok(report.results[2].root_cause_codes.includes("CAPTURE_FAILURE"));
assert.ok(Number.isFinite(report.correct_cards_per_minute));
assert.ok(report.correct_cards_per_minute > 0);
assert.ok(Number.isFinite(report.attempted_cards_per_minute));
assert.ok(report.elapsed_ms >= 0);
assert.equal(report.unexpected_color_count, 1);
assert.equal(report.usage.provider_calls, 2);
assert.equal(report.usage.image_count, 4);
assert.ok(report.results[0].timing);
assert.ok("provider_total_ms" in report.results[0].timing);
assert.ok("signed_url_ms" in report.results[0].timing);
assert.equal(signedRequests.length, 4);
assert.deepEqual(new Set(signedRequests.map((request) => request.bucket)), new Set(["listing-feedback-images"]));
assert.equal(analyzed.length, 2);
assert.equal(analyzed[0].length, 2);
assert.doesNotMatch(JSON.stringify(report), /token=secret/);

const seasonRangeComparison = titleComparison(
  "2003-04 Topps LeBron James Rookie RC PSA 10",
  "2003 Topps LeBron James RC PSA 10"
);
assert.equal(seasonRangeComparison.wrong_year, false);
assert.deepEqual(seasonRangeComparison.year_overlap, ["2003-04"]);

const seasonEndYearComparison = titleComparison(
  "2025-26 Topps Finest Josh Hart Common Geometric Refractor",
  "2026 Topps Finest Josh Hart Common Geometric Refractor"
);
assert.equal(seasonEndYearComparison.wrong_year, false);
assert.deepEqual(seasonEndYearComparison.year_overlap, ["2025-26"]);

const wrongSeasonComparison = titleComparison(
  "2025 Bowman Chrome Cooper Flagg",
  "2023 Bowman Chrome Cooper Flagg"
);
assert.equal(wrongSeasonComparison.wrong_year, true);

const bgsGradePairIsNotSerial = titleComparison(
  "2020 Triple Threads Hank Aaron Ken Griffey Jr. Mike Trout Jersey Auto 6/9 BGS 9",
  "2020 Triple Threads Hank Aaron Ken Griffey Jr. Mike Trout Auto Relic BGS 9/10"
);
assert.equal(bgsGradePairIsNotSerial.predicted_serials.length, 0);
assert.equal(bgsGradePairIsNotSerial.wrong_serial, false);

const limited = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async () => ({
    parsed: {
      title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
      fields: {}
    },
    usage: { provider_calls: 1 }
  }),
  now: () => new Date("2026-06-23T12:01:00.000Z")
});
assert.equal(limited.target_count, 1);
assert.equal(limited.full_sample_evaluation, false);

const manyItemDataset = {
  ...dataset,
  source: {
    ...dataset.source,
    source_row_count: 8,
    image_backed_row_count: 8
  },
  summary: {
    ...dataset.summary,
    item_count: 8
  },
  items: Array.from({ length: 8 }, (_, index) => ({
    ...dataset.items[0],
    asset_id: `supabase_feedback_parallel_${index}`,
    source_feedback_id: `parallel_${index}`,
    images: [
      {
        role: "front_original",
        bucket: "listing-feedback-images",
        object_path: `feedback/2026-06/parallel-${index}/front.jpg`
      }
    ],
    source_titles: {
      generated_title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
      corrected_title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10"
    }
  }))
};
let activeParallelCalls = 0;
let maxParallelCalls = 0;
const highConcurrency = await evaluateAgnesSupabaseFeedback({
  dataset: manyItemDataset,
  concurrency: 8,
  maxConcurrency: 8,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async () => {
    activeParallelCalls += 1;
    maxParallelCalls = Math.max(maxParallelCalls, activeParallelCalls);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeParallelCalls -= 1;
    return {
      parsed: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
        fields: {}
      },
      usage: { provider_calls: 1 }
    };
  },
  now: () => new Date("2026-06-23T12:01:10.000Z")
});
assert.equal(highConcurrency.worker_count, 8);
assert.equal(highConcurrency.max_concurrency, 8);
assert.equal(highConcurrency.configured_concurrency, 8);
assert.equal(maxParallelCalls, 8);

let timeoutSignalSeen = false;
let timeoutAbortSeen = false;
const itemTimedOut = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  itemTimeoutMs: 5,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async ({ signal }) => {
    timeoutSignalSeen = Boolean(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        timeoutAbortSeen = true;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  },
  now: () => new Date("2026-06-23T12:01:20.000Z")
});
assert.equal(timeoutSignalSeen, true);
assert.equal(timeoutAbortSeen, true);
assert.equal(itemTimedOut.provider_error_count, 1);
assert.equal(itemTimedOut.item_timeout_count, 1);
assert.equal(itemTimedOut.all_in_commercial_success_count, 0);
assert.equal(itemTimedOut.all_in_commercial_failure_count, 1);
assert.equal(itemTimedOut.all_in_commercial_accuracy, 0);
assert.equal(itemTimedOut.results[0].error_code, "item_timeout");
assert.match(itemTimedOut.results[0].error, /timed out after 5ms/);

const abstainCountsAsFailure = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  previousResults: [
    {
      candidate_id: "fb1",
      status: "evaluated",
      identity_resolution_enabled: false,
      recognition_preflight_enabled: false,
      internal_memory_self_excluded: false,
      identity_resolution_status: "ABSTAIN",
      prediction: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10"
      },
      corrected_title_comparison: {
        corrected_title_exact: true,
        token_recall: 1,
        token_precision: 1,
        critical_title_error: false
      },
      usage: { provider_calls: 0 }
    }
  ],
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async () => {
    throw new Error("ABSTAIN previous result should be reused for this metric test.");
  },
  now: () => new Date("2026-06-23T12:01:25.000Z")
});
assert.equal(abstainCountsAsFailure.identity_abstain_count, 1);
assert.equal(abstainCountsAsFailure.all_in_commercial_success_count, 0);
assert.equal(abstainCountsAsFailure.all_in_commercial_failure_count, 1);
assert.equal(abstainCountsAsFailure.all_in_commercial_accuracy, 0);

let rateLimitCalls = 0;
const rateLimitRecovered = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  rateLimitRetries: 1,
  rateLimitPauseMs: 0,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async () => {
    rateLimitCalls += 1;
    if (rateLimitCalls === 1) {
      const error = new Error("agnes request failed: 429 rate limit for free users");
      error.code = "rate_limited";
      throw error;
    }
    return {
      parsed: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
        fields: {}
      },
      usage: { provider_calls: 1 }
    };
  },
  now: () => new Date("2026-06-23T12:01:30.000Z")
});
assert.equal(rateLimitRecovered.status, "completed");
assert.equal(rateLimitRecovered.rate_limit_retry_enabled, true);
assert.equal(rateLimitRecovered.provider_error_count, 0);
assert.equal(rateLimitRecovered.results[0].rate_limit_retry_attempts, 1);
assert.equal(rateLimitCalls, 2);

let timeoutCalls = 0;
const timeoutRecovered = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  rateLimitRetries: 1,
  rateLimitPauseMs: 0,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async () => {
    timeoutCalls += 1;
    if (timeoutCalls === 1) {
      const error = new Error("Agnes request timed out.");
      error.code = "timeout";
      throw error;
    }
    return {
      parsed: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
        fields: {}
      },
      usage: { provider_calls: 1 }
    };
  },
  now: () => new Date("2026-06-23T12:01:35.000Z")
});
assert.equal(timeoutRecovered.provider_error_count, 0);
assert.equal(timeoutRecovered.results[0].transient_provider_retry_attempts, 1);
assert.equal(timeoutCalls, 2);

let resumeAnalyzeCalls = 0;
const providerErrorNotReused = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  previousResults: [
    {
      candidate_id: "fb1",
      status: "provider_error",
      error_code: "rate_limited",
      error: "429 rate limit"
    }
  ],
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async () => {
    resumeAnalyzeCalls += 1;
    return {
      parsed: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
        fields: {}
      },
      usage: { provider_calls: 1 }
    };
  },
  now: () => new Date("2026-06-23T12:01:45.000Z")
});
assert.equal(providerErrorNotReused.provider_error_count, 0);
assert.equal(resumeAnalyzeCalls, 1);

const identityAnalyzeCalls = [];
const identityResolved = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  identityResolution: true,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    MAX_AGNES_CALLS_PER_ASSET: "2",
    MAX_PARALLEL_FOCUSED_REREADS: "2"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async ({ prompt }) => {
    identityAnalyzeCalls.push(prompt);
    if (/focused reread/i.test(prompt)) {
      return {
        model_id: "agnes-test",
        parse_source: "content",
        finish_reason: "stop",
        parsed: {
          title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
          confidence: "HIGH",
          reason: "visible printed year and product text",
          fields: {
            year: "2025",
            manufacturer: "Topps",
            product: "Topps Chrome"
          },
          unresolved: []
        },
        usage: {
          provider_calls: 1,
          image_count: 2,
          estimated_cost_usd: 0.01,
          latency_ms: 100
        }
      };
    }

    return {
      model_id: "agnes-test",
      parse_source: "content",
      finish_reason: "stop",
      parsed: {
          title: "2025 Shohei Ohtani 5/5 PSA 10",
          confidence: "HIGH",
          reason: "visible printed player and serial; slab label states grade",
          fields: {
            year: "2025",
            players: ["Shohei Ohtani"],
            serial_number: "5/5",
            grade_company: "PSA",
          card_grade: "10"
        },
        unresolved: ["product not readable"]
      },
      usage: {
        provider_calls: 1,
        image_count: 2,
        estimated_cost_usd: 0.01,
        latency_ms: 100
      }
    };
  },
  now: () => new Date("2026-06-23T12:01:30.000Z")
});
assert.equal(identityResolved.identity_resolution_enabled, true);
assert.equal(identityResolved.results[0].identity_resolution_enabled, true);
assert.ok(identityAnalyzeCalls.length > 1);
const focusedIdentityPrompt = identityAnalyzeCalls.find((prompt) => /focused reread/i.test(prompt));
assert.match(focusedIdentityPrompt, /high-confidence intentional card-design color\/pattern/i);
assert.match(focusedIdentityPrompt, /Gold Refractor/i);
assert.match(identityResolved.results[0].prediction.title, /Topps Chrome/);
assert.match(identityResolved.results[0].prediction.title, /Shohei Ohtani/);
assert.equal(identityResolved.results[0].prediction.identity_resolution_status, "CONFIRMED");
assert.equal(identityResolved.results[0].identity_resolution_summary.status, "CONFIRMED");
assert.ok(identityResolved.results[0].identity_resolution_summary.fields.some((field) => field.field === "product"));
assert.ok(identityResolved.results[0].usage.provider_calls >= 2);
assert.ok(identityResolved.results[0].completion_trace.some((entry) => entry.output?.convergence?.loop === "detect_conflict_retrieve_reevaluate_converge"));

const cascadeCalls = [];
const cascadeFocusedCalls = [];
const cascadeResolved = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  providerId: "cascade_fast",
  identityResolution: true,
  env: {
    OPENAI_API_KEY: "test-openai-key",
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    CASCADE_MAX_AGNES_CALLS_PER_ASSET: "2",
    CASCADE_MAX_PARALLEL_FOCUSED_REREADS: "2"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeImpl: async ({ prompt }) => {
    cascadeCalls.push(prompt);
    return {
      model_id: "gpt-4.1-mini-test",
      parse_source: "content",
      finish_reason: "stop",
      parsed: {
        title: "",
        confidence: "HIGH",
        reason: "compact first pass",
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Shohei Ohtani"],
          serial_number: "5/5",
          grade_company: "PSA",
          card_grade: "10"
        },
        unresolved: []
      },
      usage: {
        provider_calls: 1,
        image_count: 2,
        estimated_cost_usd: 0.005,
        latency_ms: 40
      }
    };
  },
  analyzeFocusedImpl: async ({ prompt }) => {
    cascadeFocusedCalls.push(prompt);
    assert.match(prompt, /focused reread/i);
    assert.match(prompt, /serial_number/i);
    return {
      model_id: "agnes-focused-test",
      parse_source: "content",
      finish_reason: "stop",
      parsed: {
        title: "",
        confidence: "HIGH",
        reason: "focused serial crop reads 5/5",
        fields: {
          serial_number: "5/5"
        },
        unresolved: []
      },
      usage: {
        provider_calls: 1,
        image_count: 1,
        estimated_cost_usd: 0.004,
        latency_ms: 30
      }
    };
  },
  now: () => new Date("2026-06-23T12:01:40.000Z")
});
assert.equal(cascadeResolved.provider, "cascade_fast");
assert.equal(cascadeResolved.provider_display_name, "GPT-4.1-mini → Agnes verifier");
assert.equal(cascadeCalls.length, 1);
assert.equal(cascadeFocusedCalls.length, 1);
assert.equal(cascadeResolved.results[0].identity_resolution_status, "RESOLVED");
assert.match(cascadeResolved.results[0].prediction.title, /Topps Chrome/);
assert.match(cascadeResolved.results[0].prediction.title, /5\/5/);
assert.equal(cascadeResolved.secondary_verifier.triggered_count, 1);
assert.equal(cascadeResolved.secondary_verifier.error_count, 0);
assert.equal(cascadeResolved.secondary_verifier.event_count, 1);
assert.equal(cascadeResolved.secondary_verifier.field_recovered_count, 0);
assert.equal(cascadeResolved.secondary_verifier.field_regressed_count, 0);
assert.equal(cascadeResolved.secondary_verifier.net_benefit, 0);
assert.equal(cascadeResolved.results[0].secondary_verification_events.length, 1);
assert.equal(cascadeResolved.results[0].secondary_verification_events[0].focused_field_group, "serial_number");
assert.deepEqual(cascadeResolved.results[0].secondary_verification_events[0].gpt_initial_candidate, { serial_number: "5/5" });
assert.deepEqual(cascadeResolved.results[0].secondary_verification_events[0].agnes_candidate, { serial_number: "5/5" });
assert.deepEqual(cascadeResolved.results[0].secondary_verification_events[0].final_resolved_value, { serial_number: "5/5" });
assert.equal(cascadeResolved.results[0].secondary_verification_events[0].agnes_latency_ms >= 0, true);
assert.equal(cascadeResolved.results[0].secondary_verification_events[0].whether_recovered, false);
assert.equal(cascadeResolved.results[0].secondary_verification_events[0].whether_agnes_changed_a_correct_gpt_result, false);

function recognitionPayload({
  assetId = "supabase_feedback_fb1",
  includeCore = true,
  serial = "5/5",
  serialSourceType = "CARD_BACK",
  serialRole = "back_original"
} = {}) {
  const coreItems = includeCore
    ? [
        { field: "year", value: "2025", confidence: 0.92, image_id: "fb1_front", role: "front_original", source_type: "CARD_FRONT", observed_text: "2025 Topps Chrome" },
        { field: "manufacturer", value: "Topps", confidence: 0.9, image_id: "fb1_front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Topps" },
        { field: "product", value: "Topps Chrome", confidence: 0.94, image_id: "fb1_front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Topps Chrome" },
        { field: "subject", value: "Shohei Ohtani", confidence: 0.94, image_id: "fb1_front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Shohei Ohtani" },
        { field: "parallel", value: "Gold Refractor", confidence: 0.9, image_id: "fb1_front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Gold Refractor" },
        {
          field: "grade_label",
          value: "PSA 10",
          confidence: 0.93,
          image_id: "fb1_front",
          role: "grade_label_crop",
          source_type: "SLAB_LABEL",
          observed_text: "PSA 10",
          parsed_fields: {
            grade_company: "PSA",
            card_grade: "10",
            grade_type: "CARD_ONLY"
          }
        }
      ]
    : [];

  return {
    asset_id: assetId,
    rectification: {},
    image_quality: {},
    regions: [],
    ocr_evidence: { status: "OK", items: [] },
    evidence_fusion: {
      status: "OK",
      items: [
        ...coreItems,
        { field: "serial_number", value: serial, confidence: 0.91, image_id: "fb1_back", role: serialRole, source_type: serialSourceType, observed_text: serial }
      ],
      resolved_fields: {},
      field_candidates: {},
      conflicts: []
    },
    visual_features: {},
    processing: {
      pipeline_version: "recognition-worker-contract-v1",
      model_versions: { ocr: "mock" },
      latency_ms: 17
    }
  };
}

let directRecognitionCalls = 0;
let directAgnesCalls = 0;
const recognitionDirect = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  identityResolution: true,
  recognitionPreflight: true,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeRecognitionImpl: async ({ requestedFields, images }) => {
    directRecognitionCalls += 1;
    assert.ok(requestedFields.includes("serial_number"));
    assert.equal(images.length, 2);
    return recognitionPayload({ includeCore: true });
  },
  analyzeImpl: async () => {
    directAgnesCalls += 1;
    throw new Error("Agnes should be skipped when recognition preflight resolves identity.");
  },
  now: () => new Date("2026-06-23T12:01:32.000Z")
});
assert.equal(recognitionDirect.recognition_preflight_enabled, true);
assert.equal(recognitionDirect.results[0].recognition_preflight_status, "resolved");
assert.equal(recognitionDirect.results[0].identity_resolution_status, "CONFIRMED");
assert.equal(recognitionDirect.results[0].usage.provider_calls, 0);
assert.equal(recognitionDirect.results[0].usage.recognition_worker_calls, 1);
assert.equal(recognitionDirect.usage.recognition_worker_calls, 1);
assert.equal(directRecognitionCalls, 1);
assert.equal(directAgnesCalls, 0);
assert.match(recognitionDirect.results[0].prediction.title, /5\/5/);

let serialMergeAgnesCalls = 0;
const recognitionSerialMerge = await evaluateAgnesSupabaseFeedback({
  dataset,
  limit: 1,
  identityResolution: true,
  recognitionPreflight: true,
  env: {
    AGNES_API_KEY: "test-agnes-key",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    MAX_AGNES_CALLS_PER_ASSET: "0",
    MAX_EXTERNAL_QUERIES: "0"
  },
  createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
  analyzeRecognitionImpl: async () => recognitionPayload({ includeCore: false, serial: "5/5" }),
  analyzeImpl: async () => {
    serialMergeAgnesCalls += 1;
    return {
      model_id: "agnes-test",
      parse_source: "content",
      finish_reason: "stop",
      parsed: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 3/5 PSA 10",
        confidence: "HIGH",
        reason: "Agnes misread serial, but core fields are visible.",
        fields: {
          year: "2025",
          manufacturer: "Topps",
          product: "Topps Chrome",
          players: ["Shohei Ohtani"],
          parallel: "Gold Refractor",
          serial_number: "3/5",
          grade_company: "PSA",
          card_grade: "10",
          grade_type: "CARD_ONLY"
        },
        unresolved: []
      },
      usage: { provider_calls: 1, image_count: 2 }
    };
  },
  now: () => new Date("2026-06-23T12:01:34.000Z")
});
assert.equal(recognitionSerialMerge.results[0].recognition_preflight_status, "abstain");
assert.equal(serialMergeAgnesCalls, 1);
assert.equal(recognitionSerialMerge.results[0].usage.provider_calls, 1);
assert.equal(recognitionSerialMerge.results[0].usage.recognition_worker_calls, 1);
assert.match(recognitionSerialMerge.results[0].prediction.title, /5\/5/);
assert.doesNotMatch(recognitionSerialMerge.results[0].prediction.title, /3\/5/);
assert.equal(recognitionSerialMerge.results[0].corrected_title_comparison.wrong_serial, false);
assert.ok(recognitionSerialMerge.results[0].identity_resolution_summary.conflict_map.some((conflict) => conflict.field === "serial_number"));

const originalFetch = globalThis.fetch;
const memoryRows = [
  {
    id: "fb1",
    generated_title: "2025 Topps Chrome Shohei Ohtani Red Refractor 5/5",
    corrected_title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
    created_at: "2026-06-22T00:00:00.000Z"
  }
];
globalThis.fetch = async (url) => {
  const requestUrl = new URL(String(url));
  const table = requestUrl.pathname.split("/").at(-1);
  if (table === "listing_reviews") {
    return {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: "relation listing_reviews does not exist" })
    };
  }
  if (table === "listing_title_feedback") {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(memoryRows)
    };
  }
  throw new Error(`unexpected memory fetch ${requestUrl.href}`);
};

try {
  const memoryEvalAnalyze = async () => ({
    model_id: "agnes-test",
    parse_source: "content",
    finish_reason: "stop",
    parsed: {
      title: "2025 Shohei Ohtani 5/5 PSA 10",
      confidence: "HIGH",
      reason: "visible player serial and slab grade",
      fields: {
        year: "2025",
        players: ["Shohei Ohtani"],
        serial_number: "5/5",
        grade_company: "PSA",
        card_grade: "10"
      },
      unresolved: ["product not readable"]
    },
    usage: { provider_calls: 1, image_count: 2 }
  });
  const leakFreeMemoryEval = await evaluateAgnesSupabaseFeedback({
    dataset,
    limit: 1,
    identityResolution: true,
    excludeSelfApprovedMemory: true,
    env: {
      AGNES_API_KEY: "test-agnes-key",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      LISTING_APPROVED_MEMORY_ENABLED: "true",
      INTERNAL_APPROVED_HISTORY_LIMIT: "20",
      MAX_AGNES_CALLS_PER_ASSET: "0",
      MAX_EXTERNAL_QUERIES: "0"
    },
    createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
    analyzeImpl: memoryEvalAnalyze,
    now: () => new Date("2026-06-23T12:01:40.000Z")
  });
  assert.equal(leakFreeMemoryEval.internal_memory_self_exclusion_enabled, true);
  assert.equal(leakFreeMemoryEval.results[0].internal_memory_self_excluded, true);
  assert.notEqual(leakFreeMemoryEval.results[0].completion_trace[0].output.selected_candidate_id, "fb1");

  const selfAllowedMemoryEval = await evaluateAgnesSupabaseFeedback({
    dataset,
    limit: 1,
    identityResolution: true,
    excludeSelfApprovedMemory: false,
    env: {
      AGNES_API_KEY: "test-agnes-key",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      LISTING_APPROVED_MEMORY_ENABLED: "true",
      INTERNAL_APPROVED_HISTORY_LIMIT: "20",
      MAX_AGNES_CALLS_PER_ASSET: "0",
      MAX_EXTERNAL_QUERIES: "0"
    },
    createSignedReadUrlImpl: async ({ objectPath, bucket }) => `https://signed.test/${bucket}/${objectPath}`,
    analyzeImpl: memoryEvalAnalyze,
    now: () => new Date("2026-06-23T12:01:50.000Z")
  });
  assert.equal(selfAllowedMemoryEval.internal_memory_self_exclusion_enabled, false);
  assert.equal(selfAllowedMemoryEval.results[0].internal_memory_self_excluded, false);
  assert.equal(selfAllowedMemoryEval.results[0].completion_trace[0].output.selected_candidate_id, "fb1");
  assert.match(selfAllowedMemoryEval.results[0].prediction.title, /Gold/i);
} finally {
  globalThis.fetch = originalFetch;
}

const skipped = await evaluateAgnesSupabaseFeedback({
  dataset,
  env: {},
  analyzeImpl: async () => {
    throw new Error("should not call Agnes without key");
  },
  now: () => new Date("2026-06-23T12:02:00.000Z")
});
assert.equal(skipped.status, "skipped");
assert.match(skipped.blocked_reason, /AGNES_API_KEY/);

const skippedStorage = await evaluateAgnesSupabaseFeedback({
  dataset,
  env: {
    AGNES_API_KEY: "test-agnes-key"
  },
  analyzeImpl: async () => {
    throw new Error("should not call Agnes without storage signing config");
  },
  now: () => new Date("2026-06-23T12:03:00.000Z")
});
assert.equal(skippedStorage.status, "skipped");
assert.match(skippedStorage.blocked_reason, /SUPABASE_SERVICE_ROLE_KEY/);

let readRequest;
const readUrl = await createListingImageSignedReadUrl({
  objectPath: "feedback/2026-06/fb1/front.jpg",
  bucket: "listing-feedback-images",
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    LISTING_IMAGE_BUCKET: "listing-card-images"
  },
  fetchImpl: async (url, init) => {
    readRequest = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        signedURL: "/object/sign/listing-feedback-images/feedback/2026-06/fb1/front.jpg?token=read"
      })
    };
  }
});
assert.match(readRequest.url, /\/storage\/v1\/object\/sign\/listing-feedback-images\/feedback\/2026-06\/fb1\/front.jpg/);
assert.equal(JSON.parse(readRequest.init.body).expiresIn, 600);
assert.equal(readUrl, "https://supabase.test/storage/v1/object/sign/listing-feedback-images/feedback/2026-06/fb1/front.jpg?token=read");
await assert.rejects(
  () => createListingImageSignedReadUrl({
    objectPath: "feedback/2026-06/fb1/front.jpg",
    bucket: "../bad",
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
    },
    fetchImpl: async () => ({})
  }),
  /Invalid listing image storage bucket/
);

const summary = formatAgnesSupabaseFeedbackSummary(report);
assert.match(summary, /corrected_title_exact: 1\/3/);
assert.match(summary, /all_in_commercial_accuracy: 0.333333 target:0.95 passed:false/);
assert.match(summary, /correct_cards_per_minute:/);
assert.match(summary, /attempted_cards_per_minute:/);
assert.match(summary, /secondary_verifier_net_benefit:/);
assert.match(summary, /dangerous_error_rate: 0.5/);
assert.match(summary, /accepted_coverage_rate: 0.666667/);
assert.match(summary, /root_causes: .*CAPTURE_FAILURE=1.*PERCEPTION_FAILURE=1.*GATE_FALSE_ACCEPT=1/);
assert.match(summary, /commercial_accuracy_claim_allowed: false/);
assert.match(summary, /corrected-title reference only/);

console.log("Supabase feedback Agnes eval tests passed");
