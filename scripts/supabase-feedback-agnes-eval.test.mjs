import assert from "node:assert/strict";
import {
  evaluateAgnesSupabaseFeedback,
  formatAgnesSupabaseFeedbackSummary
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
assert.equal(report.full_sample_evaluation, true);
assert.equal(report.corrected_title_exact_count, 1);
assert.equal(report.critical_title_error_count, 1);
assert.equal(report.unexpected_color_count, 1);
assert.equal(report.usage.provider_calls, 2);
assert.equal(report.usage.image_count, 4);
assert.equal(signedRequests.length, 4);
assert.deepEqual(new Set(signedRequests.map((request) => request.bucket)), new Set(["listing-feedback-images"]));
assert.equal(analyzed.length, 2);
assert.equal(analyzed[0].length, 2);
assert.doesNotMatch(JSON.stringify(report), /token=secret/);

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
assert.match(identityResolved.results[0].prediction.title, /Topps Chrome/);
assert.match(identityResolved.results[0].prediction.title, /Shohei Ohtani/);
assert.equal(identityResolved.results[0].prediction.identity_resolution_status, "CONFIRMED");
assert.equal(identityResolved.results[0].identity_resolution_summary.status, "CONFIRMED");
assert.ok(identityResolved.results[0].identity_resolution_summary.fields.some((field) => field.field === "product"));
assert.ok(identityResolved.results[0].usage.provider_calls >= 2);
assert.ok(identityResolved.results[0].completion_trace.some((entry) => entry.output?.convergence?.loop === "detect_conflict_retrieve_reevaluate_converge"));

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
assert.match(summary, /commercial_accuracy_claim_allowed: false/);
assert.match(summary, /corrected-title reference only/);

console.log("Supabase feedback Agnes eval tests passed");
