import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/listing-title-feedback.js";
import { createListingSessionToken } from "../lib/listing-session.mjs";
import {
  buildListingReviewRecords,
  buildAssetFingerprint,
  deriveReviewOutcome,
  diffResolvedFields,
  extractAssetImagePaths,
  reviewOutcomes,
  sanitizeStorageObjectPath
} from "../lib/listing/feedback/review-records.mjs";
import { summarizeReviewMetrics } from "../lib/listing/feedback/review-metrics.mjs";
import {
  createListingReviewRecord,
  listingFeedbackRetentionEnabled
} from "../lib/supabase-feedback.mjs";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.METAVERSE_AUTH_SECRET = "test-secret";
delete process.env.LISTING_FEEDBACK_RETENTION_ENABLED;
delete process.env.ENABLE_LISTING_FEEDBACK_RETENTION;

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };
}

function sessionCookie() {
  const token = createListingSessionToken({
    user_id: "user_alpha",
    tenant_id: "tenant_alpha",
    email: "operator-a@example.test",
    session_version: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `lynca_metaverse_session=${token}`;
}

async function callFeedbackApi(payload, {
  fetchImpl = null
} = {}) {
  const calls = [];
  const lookupCalls = [];
  const mutationFetch = fetchImpl || (async (url, options = {}) => {
    const parsed = new URL(String(url));
    const table = parsed.pathname.split("/").at(-1);
    const body = JSON.parse(options.body || "{}");
    calls.push({
      table,
      method: options.method,
      prefer: options.headers?.prefer,
      body
    });

    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{ ...body, id: body.id || `${table}_row` }])
    };
  });
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    const table = parsed.pathname.split("/").at(-1);
    if (table === "listing_assets" && (options.method || "GET") === "GET") {
      const assetId = String(parsed.searchParams.get("id") || "").replace(/^eq\./, "");
      lookupCalls.push({
        table,
        method: "GET",
        tenant_id: parsed.searchParams.get("tenant_id"),
        asset_id: parsed.searchParams.get("id")
      });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ tenant_id: "tenant_alpha", id: assetId }])
      };
    }
    return mutationFetch(url, options);
  };

  const record = await createListingReviewRecord({
    payload,
    tenantId: "tenant_alpha",
    userId: "user_alpha",
    operatorId: "user_alpha",
    env: process.env,
    fetchImpl: globalThis.fetch
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      record,
      review_outcome: record.review?.review_outcome,
      retention_enabled: listingFeedbackRetentionEnabled(),
      retention_skipped: record.retained === false,
      retention_reason: record.reason || null,
      legacy_feedback_saved: Boolean(record.legacy_feedback && record.retained !== false)
    },
    calls,
    lookupCalls
  };
}

async function callLegacyFeedbackApi(payload, { authenticated = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    const table = parsed.pathname.split("/").at(-1);
    calls.push({ table, method: options.method || "GET" });
    if (table === "tenant_members") {
      return {
        ok: true,
        status: 200,
        json: async () => [{
          tenant_id: "tenant_alpha",
          user_id: "user_alpha",
          role: "WRITER",
          status: "ACTIVE",
          disabled_at: null,
          user: {
            id: "user_alpha",
            email: "operator-a@example.test",
            status: "ACTIVE",
            session_version: 1,
            disabled_at: null,
            auth_user_id: "auth_alpha"
          },
          tenant: {
            id: "tenant_alpha",
            name: "Tenant Alpha",
            plan: "pilot",
            status: "ACTIVE",
            disabled_at: null
          }
        }],
        text: async () => "[]"
      };
    }
    return {
      ok: true,
      status: 201,
      json: async () => [],
      text: async () => "[]"
    };
  };

  const req = new EventEmitter();
  req.method = "POST";
  req.headers = authenticated ? { cookie: sessionCookie() } : {};
  const res = makeResponse();
  const promise = handler(req, res);
  req.emit("data", JSON.stringify(payload));
  req.emit("end");
  await promise;
  return { statusCode: res.statusCode, body: JSON.parse(res.body), calls };
}

const unauthenticatedSave = await callLegacyFeedbackApi({
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg"
}, { authenticated: false });
assert.equal(unauthenticatedSave.statusCode, 401);
assert.equal(unauthenticatedSave.body.code, "AUTH_REQUIRED");
assert.equal(unauthenticatedSave.body.message, "Authentication required.");
assert.equal(unauthenticatedSave.calls.filter((call) => !["request_logs", "error_logs"].includes(call.table)).length, 0);

const closedLegacySave = await callLegacyFeedbackApi({
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg"
});
assert.equal(closedLegacySave.statusCode, 410);
assert.equal(closedLegacySave.body.code, "tenant_feedback_route_required");
assert.deepEqual(closedLegacySave.calls
  .filter((call) => !["request_logs", "error_logs"].includes(call.table))
  .map((call) => call.table), ["tenant_members"]);

const retentionDisabledSave = await callFeedbackApi({
  asset_id: "asset-retention-disabled",
  analysis_run_id: "analysis-retention-disabled",
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  }
});
assert.equal(retentionDisabledSave.statusCode, 200);
assert.equal(retentionDisabledSave.body.retention_enabled, false);
assert.equal(retentionDisabledSave.body.retention_skipped, true);
assert.equal(retentionDisabledSave.body.retention_reason, "feedback_retention_disabled");
assert.equal(retentionDisabledSave.body.review_outcome, reviewOutcomes.ACCEPTED_UNCHANGED);
assert.equal(retentionDisabledSave.body.legacy_feedback_saved, false);
assert.equal(retentionDisabledSave.calls.length, 0);

process.env.LISTING_FEEDBACK_RETENTION_ENABLED = "true";

const diff = diffResolvedFields(
  { year: "2025", players: ["Cooper Flagg"], serial_number: "37/50" },
  { year: "2025", players: ["Cooper Flagg"], serial_number: "31/50" }
);
assert.deepEqual(diff, [
  {
    field: "serial_number",
    from: "37/50",
    to: "31/50",
    change_type: "OPERATOR_CORRECTION"
  }
]);

assert.equal(sanitizeStorageObjectPath("listing-assets/2026-06-22/asset/front.jpg"), "listing-assets/2026-06-22/asset/front.jpg");
assert.equal(sanitizeStorageObjectPath("https://storage.test/object/sign/listing-assets/front.jpg?token=secret"), "");
assert.equal(sanitizeStorageObjectPath("listing-assets/2026-06-22/asset/front.jpg?token=secret"), "");
assert.equal(sanitizeStorageObjectPath("../secret.jpg"), "");
const frontSha = "a".repeat(64);
const backSha = "b".repeat(64);
const assetFingerprint = buildAssetFingerprint({
  front_object_path: "listing-assets/2026-06-22/asset/front.jpg",
  front_content_sha256: frontSha,
  back_object_path: "listing-assets/2026-06-22/asset/back.jpg",
  back_content_sha256: backSha,
  additional_image_paths: [
    {
      object_path: "listing-assets/2026-06-22/asset/serial.jpg",
      content_sha256: "c".repeat(64)
    }
  ]
});
assert.match(assetFingerprint, /^[0-9a-f]{64}$/);

const extractedImagePaths = extractAssetImagePaths(
  [
    {
      storageRole: "front_original",
      objectPath: "https://storage.test/object/sign/listing-assets/front.jpg?token=secret"
    },
    {
      id: "front",
      storageRole: "front_original",
      objectPath: "listing-assets/2026-06-22/asset-paths/front.jpg",
      contentSha256: frontSha
    },
    {
      storageRole: "back_original",
      objectPath: "../secret.jpg"
    },
    {
      id: "serial",
      storageRole: "serial_crop",
      objectPath: "listing-assets/2026-06-22/asset-paths/serial.jpg",
      contentSha256: "c".repeat(64),
      derived: true,
      sourceRegion: "serial_number"
    },
    {
      storageRole: "serial_crop",
      objectPath: "listing-assets/2026-06-22/asset-paths/serial.jpg"
    }
  ],
  {
    back_object_path: "listing-assets/2026-06-22/asset-paths/back.jpg",
    additional_image_paths: [
      "listing-assets/2026-06-22/asset-paths/front.jpg",
      "https://storage.test/object/sign/listing-assets/direct.jpg?token=secret",
      {
        role: "edge_crop",
        object_path: "listing-assets/2026-06-22/asset-paths/edge.jpg",
        image_id: "edge"
      }
    ]
  }
);
assert.equal(extractedImagePaths.front_object_path, "listing-assets/2026-06-22/asset-paths/front.jpg");
assert.equal(extractedImagePaths.front_content_sha256, frontSha);
assert.equal(extractedImagePaths.back_object_path, "listing-assets/2026-06-22/asset-paths/back.jpg");
assert.equal(extractedImagePaths.additional_image_paths[1].content_sha256, "c".repeat(64));
assert.deepEqual(
  extractedImagePaths.additional_image_paths.map((image) => image.object_path),
  [
    "listing-assets/2026-06-22/asset-paths/edge.jpg",
    "listing-assets/2026-06-22/asset-paths/serial.jpg"
  ]
);
assert.doesNotMatch(JSON.stringify(extractedImagePaths), /storage\.test|token=secret|\.\./);

const unchangedRecords = buildListingReviewRecords({
  payload: {
    asset_id: "asset-1",
    analysis_run_id: "analysis-1",
    generated_title: "2025 Topps Chrome Cooper Flagg",
    corrected_title: "2025 Topps Chrome Cooper Flagg",
    generated_resolved_fields: {
      year: "2025",
      brand: "Topps",
      product: "Topps Chrome",
      players: ["Cooper Flagg"]
    },
    corrected_resolved_fields: {
      year: "2025",
      brand: "Topps",
      product: "Topps Chrome",
      players: ["Cooper Flagg"]
    },
    open_set_readiness: {
      status: "KNOWN_CATALOG",
      catalog: { eligibility: { prompt_candidate_count: 1 } }
    },
    retrieval_trace: {
      catalog_candidates: [
        {
          candidate_id: "cat-cooper-flagg-1",
          source_type: "APPROVED_REFERENCE",
          canonical_title: "2025 Topps Chrome Cooper Flagg",
          match_score: 0.94,
          selected: true
        }
      ]
    },
    workflow_summary: {
      schema_version: "listing-workflow-summary-v1",
      status: "LOW_TOUCH_REVIEW",
      operator_next_actions: [
        { kind: "approve", text: "快速核对标题模块，确认无黄块后保存审核记录。" }
      ]
    },
    workflow_sidecars: {
      paddle_ocr: { status: "NOT_TRIGGERED" }
    },
    workflow_action_plan: {
      plan_version: "workflow-sidecar-action-plan-v1",
      actions: []
    }
  },
  operatorId: "operator-a",
  now: new Date("2026-06-22T00:00:00.000Z")
});
assert.equal(unchangedRecords.review.review_outcome, reviewOutcomes.ACCEPTED_UNCHANGED);
assert.equal(unchangedRecords.review.stable_training_sample, true);
assert.equal(unchangedRecords.review.training_status, "approved_clean");
assert.equal(unchangedRecords.review.reusable_approved_title, true);
assert.equal(unchangedRecords.analysisRun.open_set_readiness.status, "KNOWN_CATALOG");
assert.equal(unchangedRecords.analysisRun.workflow_summary.status, "LOW_TOUCH_REVIEW");
assert.equal(unchangedRecords.analysisRun.workflow_sidecars.paddle_ocr.status, "NOT_TRIGGERED");
assert.equal(unchangedRecords.analysisRun.workflow_action_plan.plan_version, "workflow-sidecar-action-plan-v1");
assert.equal(unchangedRecords.analysisRun.field_graph.schema_version, "listing-field-graph-v1");
assert.equal(unchangedRecords.analysisRun.field_graph.player, "Cooper Flagg");
assert.equal(unchangedRecords.review.workflow_summary.status, "LOW_TOUCH_REVIEW");
assert.equal(unchangedRecords.review.field_graph.product, "Topps Chrome");
assert.equal(unchangedRecords.review.feedback_training_event.schema_version, "listing-feedback-loop-training-v1");
assert.equal(unchangedRecords.review.feedback_training_event.training_ready, false);
assert.equal(unchangedRecords.review.feedback_training_event.semantic_truth, false);
assert.equal(unchangedRecords.review.feedback_training_event.semantic_learning_status, "OBSERVE_ONLY_WRITER_TITLE_CANDIDATE");
assert.equal(unchangedRecords.review.candidate_reranker_dataset.length, 1);
assert.equal(unchangedRecords.review.candidate_reranker_dataset[0].candidate_id, "cat-cooper-flagg-1");
assert.equal(unchangedRecords.review.candidate_reranker_dataset[0].selected_by_system, true);
assert.equal(unchangedRecords.review.candidate_reranker_dataset[0].selected_by_writer, true);
assert.deepEqual(unchangedRecords.review.field_level_ground_truth, []);
assert.equal(unchangedRecords.review.hard_negative_samples.length, 0);
assert.equal(unchangedRecords.legacyFeedback, null);

assert.equal(
  deriveReviewOutcome({
    generatedTitle: "2025 Topps Chrome Cooper Flagg",
    correctedTitle: "2025 Topps Chrome Cooper Flagg",
    route: "TARGETED_RESCAN_REQUIRED"
  }),
  reviewOutcomes.REJECTED
);
assert.equal(
  deriveReviewOutcome({
    generatedTitle: "2025 Topps Chrome Cooper Flagg",
    correctedTitle: "2025 Topps Chrome Cooper Flagg",
    route: "TARGETED_RESCAN_REQUIRED",
    explicitOutcome: "TARGETED_RESCAN_RECOVERED",
    recovery: {
      targeted_rescan_recovered: true
    }
  }),
  reviewOutcomes.REJECTED
);
assert.equal(
  deriveReviewOutcome({
    generatedTitle: "2025 Topps Chrome Cooper Flagg",
    correctedTitle: "2025 Topps Chrome Cooper Flagg",
    route: "AI_COMPLETE_REVIEW",
    explicitOutcome: "TARGETED_RESCAN_RECOVERED",
    recovery: {
      targeted_rescan_recovered: true
    }
  }),
  reviewOutcomes.TARGETED_RESCAN_RECOVERED
);

const unchangedSave = await callFeedbackApi({
  asset_id: "asset-accepted",
  analysis_run_id: "analysis-accepted",
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  images: [
    {
      id: "front",
      storageRole: "front_original",
      objectPath: "tenants/tenant_alpha/listing-assets/2026-06-22/asset-accepted/front.jpg",
      contentSha256: frontSha
    }
  ],
  review_duration_ms: 1234,
  provider: "openai_legacy",
  model_id: "gpt-4.1-mini-2025-04-14",
  route: "AI_COMPLETE_REVIEW",
  retrieval_trace: {
    catalog_candidates: [
      {
        candidate_id: "cat-accepted",
        source_type: "APPROVED_REFERENCE",
        canonical_title: "2025 Topps Chrome Cooper Flagg",
        selected: true
      }
    ]
  }
});
assert.equal(unchangedSave.statusCode, 200);
assert.equal(unchangedSave.body.review_outcome, reviewOutcomes.ACCEPTED_UNCHANGED);
assert.equal(unchangedSave.body.legacy_feedback_saved, false);
assert.deepEqual(unchangedSave.calls.map((call) => call.table), [
  "listing_assets",
  "listing_analysis_runs",
  "listing_reviews"
]);
assert.equal(unchangedSave.calls[0].body.front_object_path, "tenants/tenant_alpha/listing-assets/2026-06-22/asset-accepted/front.jpg");
assert.equal(unchangedSave.calls[0].body.front_content_sha256, frontSha);
assert.match(unchangedSave.calls[0].body.asset_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(unchangedSave.calls[2].body.review_duration_ms, 1234);
assert.equal(unchangedSave.calls[2].body.stable_training_sample, true);
assert.equal(unchangedSave.calls[2].body.training_status, "approved_clean");
assert.equal(unchangedSave.calls[2].body.reusable_approved_title, true);
assert.equal(unchangedSave.calls[2].body.asset_fingerprint, unchangedSave.calls[0].body.asset_fingerprint);
assert.deepEqual(unchangedSave.calls[2].body.field_changes, []);
assert.equal(unchangedSave.calls[1].body.field_graph.product, "Topps Chrome");
assert.equal(unchangedSave.calls[2].body.feedback_training_event.datasets.candidate_reranker_dataset[0].candidate_id, "cat-accepted");
assert.deepEqual(unchangedSave.calls[2].body.field_level_ground_truth, []);

const schemaLagCalls = [];
let failedAnalysisOnce = false;
const schemaLagSave = await callFeedbackApi({
  asset_id: "asset-schema-lag",
  analysis_run_id: "analysis-schema-lag",
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg",
  workflow_summary: {
    schema_version: "listing-workflow-summary-v1",
    status: "LOW_TOUCH_REVIEW"
  },
  open_set_readiness: {
    status: "KNOWN_CATALOG"
  },
  workflow_sidecars: {
    paddle_ocr: { status: "NOT_TRIGGERED" }
  },
  workflow_action_plan: {
    plan_version: "workflow-sidecar-action-plan-v1"
  }
}, {
  fetchImpl: async (url, options = {}) => {
    const parsed = new URL(String(url));
    const table = parsed.pathname.split("/").at(-1);
    const body = JSON.parse(options.body || "{}");
    schemaLagCalls.push({ table, body });
    if (table === "listing_analysis_runs" && !failedAnalysisOnce) {
      failedAnalysisOnce = true;
      return {
        ok: false,
        status: 400,
        text: async () => "Could not find the 'workflow_summary' column of 'listing_analysis_runs' in the schema cache"
      };
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{ ...body, id: body.id || `${table}_row` }])
    };
  }
});
assert.equal(schemaLagSave.statusCode, 200);
assert.equal(schemaLagCalls.filter((call) => call.table === "listing_analysis_runs").length, 2);
assert.equal(schemaLagCalls[1].body.workflow_summary.status, "LOW_TOUCH_REVIEW");
assert.equal(schemaLagCalls[2].body.workflow_summary, undefined);
assert.equal(schemaLagCalls[2].body.open_set_readiness, undefined);
assert.equal(schemaLagCalls[2].body.workflow_sidecars, undefined);
assert.equal(schemaLagCalls[2].body.workflow_action_plan, undefined);
assert.equal(schemaLagCalls[2].body.field_graph, undefined);

const hardenedPathSave = await callFeedbackApi({
  asset_id: "asset-path-hardening",
  analysis_run_id: "analysis-path-hardening",
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  front_object_path: "https://storage.test/object/sign/listing-assets/front.jpg?token=secret",
  back_object_path: "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/back.jpg",
  additional_image_paths: [
    "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/direct-extra.jpg",
    "https://storage.test/object/sign/listing-assets/direct-extra.jpg?token=secret"
  ],
  images: [
    {
      id: "front",
      storageRole: "front_original",
      objectPath: "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/front.jpg",
      signedUrl: "https://storage.test/object/sign/listing-assets/front.jpg?token=secret"
    },
    {
      id: "grade",
      storageRole: "grade_crop",
      objectPath: "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/grade.jpg"
    }
  ]
});
const hardenedAsset = hardenedPathSave.calls.find((call) => call.table === "listing_assets").body;
assert.equal(hardenedAsset.front_object_path, "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/front.jpg");
assert.equal(hardenedAsset.back_object_path, "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/back.jpg");
assert.deepEqual(
  hardenedAsset.additional_image_paths.map((image) => image.object_path),
  [
    "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/direct-extra.jpg",
    "tenants/tenant_alpha/listing-assets/2026-06-22/asset-path-hardening/grade.jpg"
  ]
);
assert.doesNotMatch(JSON.stringify(hardenedAsset), /storage\.test|token=secret|signedUrl/);

const correctedFieldsSave = await callFeedbackApi({
  asset_id: "asset-corrected",
  analysis_run_id: "analysis-corrected",
  generated_title: "2025 Topps Chrome Cooper Flagg 37/50",
  corrected_title: "2025 Topps Chrome Cooper Flagg 31/50",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    serial_number: "37/50"
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    serial_number: "31/50"
  },
  field_changes: [
    {
      field: "parallel",
      from: "Gold",
      to: "Gold Wave",
      change_type: "UNTRUSTED_CLIENT_DIFF"
    }
  ],
  retrieval_trace: {
    catalog_candidates: [
      {
        candidate_id: "cat-wrong-serial",
        source_type: "APPROVED_REFERENCE",
        canonical_title: "2025 Topps Chrome Cooper Flagg 37/50",
        conflicting_fields: ["serial_number"],
        selected: true
      }
    ]
  },
  images: [
    {
      id: "front",
      storageRole: "front_original",
      objectPath: "tenants/tenant_alpha/listing-assets/2026-06-22/asset-corrected/front.jpg"
    },
    {
      id: "serial",
      storageRole: "serial_crop",
      objectPath: "tenants/tenant_alpha/listing-assets/2026-06-22/asset-corrected/serial.jpg",
      derived: true,
      sourceRegion: "serial_number"
    }
  ],
  route: "WRITER_REVIEW_REQUIRED"
});
assert.equal(correctedFieldsSave.body.review_outcome, reviewOutcomes.CORRECTED_FIELDS);
const correctedReview = correctedFieldsSave.calls.find((call) => call.table === "listing_reviews").body;
assert.equal(correctedReview.stable_training_sample, true);
assert.equal(correctedReview.training_status, "reviewed_correction");
assert.equal(correctedReview.reusable_approved_title, true);
assert.deepEqual(correctedReview.field_changes, [
  {
    field: "serial_number",
    from: "37/50",
    to: "31/50",
    change_type: "OPERATOR_CORRECTION"
  }
]);
assert.equal(correctedReview.feedback_training_event.correction_type, reviewOutcomes.CORRECTED_FIELDS);
assert.equal(correctedReview.candidate_reranker_dataset[0].candidate_id, "cat-wrong-serial");
assert.deepEqual(correctedReview.hard_negative_samples[0].conflicting_fields, ["serial_number"]);
assert.deepEqual(correctedReview.field_level_ground_truth, []);
assert.equal(correctedFieldsSave.calls.some((call) => call.table === "listing_title_feedback"), false);
const correctedAsset = correctedFieldsSave.calls.find((call) => call.table === "listing_assets").body;
assert.equal(correctedAsset.additional_image_paths[0].role, "serial_crop");
assert.equal(correctedAsset.additional_image_paths[0].object_path, "tenants/tenant_alpha/listing-assets/2026-06-22/asset-corrected/serial.jpg");

const titleOverrideSave = await callFeedbackApi({
  asset_id: "asset-title-only",
  analysis_run_id: "analysis-title-only",
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "Custom market wording",
  title_override: "Custom market wording",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  }
});
assert.equal(titleOverrideSave.body.review_outcome, reviewOutcomes.TITLE_ONLY_OVERRIDE);

const pendingRescanSave = await callFeedbackApi({
  asset_id: "asset-rescan-needed",
  analysis_run_id: "analysis-rescan-needed",
  generated_title: "2025 Topps Chrome Cooper Flagg",
  corrected_title: "2025 Topps Chrome Cooper Flagg",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"]
  },
  route: "TARGETED_RESCAN_REQUIRED"
});
assert.equal(pendingRescanSave.body.review_outcome, reviewOutcomes.REJECTED);
const pendingRescanReview = pendingRescanSave.calls.find((call) => call.table === "listing_reviews").body;
assert.equal(pendingRescanReview.approved_at, null);

const recoveredRescanSave = await callFeedbackApi({
  asset_id: "asset-rescan-recovered",
  analysis_run_id: "analysis-rescan-recovered",
  generated_title: "2025 Topps Chrome Cooper Flagg 31/50",
  corrected_title: "2025 Topps Chrome Cooper Flagg 31/50",
  generated_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    serial_number: "31/50"
  },
  corrected_resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    serial_number: "31/50"
  },
  route: "AI_COMPLETE_REVIEW",
  review_outcome: "TARGETED_RESCAN_RECOVERED",
  recovery: {
    targeted_rescan_recovered: true,
    glare_recovered: true
  }
});
assert.equal(recoveredRescanSave.body.review_outcome, reviewOutcomes.TARGETED_RESCAN_RECOVERED);
const recoveredRescanReview = recoveredRescanSave.calls.find((call) => call.table === "listing_reviews").body;
assert.ok(recoveredRescanReview.approved_at);

const metrics = summarizeReviewMetrics([
  unchangedSave.calls.find((call) => call.table === "listing_reviews").body,
  correctedReview,
  titleOverrideSave.calls.find((call) => call.table === "listing_reviews").body,
  pendingRescanReview,
  recoveredRescanReview
]);
assert.equal(metrics.total_reviews, 5);
assert.equal(metrics.by_outcome.ACCEPTED_UNCHANGED, 1);
assert.equal(metrics.by_outcome.CORRECTED_FIELDS, 1);
assert.equal(metrics.by_outcome.REJECTED, 1);
assert.equal(metrics.by_outcome.TARGETED_RESCAN_RECOVERED, 1);
assert.equal(metrics.field_correction_counts.serial_number, 1);
assert.equal(metrics.accepted_unchanged_rate, 1 / 5);

console.log("feedback review tests passed");
