import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";
import {
  identityResultCacheReadEnabled,
  identityResultCacheWriteEnabled,
  identityResultCacheWriteResolvedEnabled,
  identityResultCacheTable
} from "../lib/listing/cache/identity-result-cache.mjs";

const defaultDatasetPath = "data/golden-dataset.json";
const defaultEbayCandidatesPath = "data/ebay-candidates/ebay-image-candidates-latest.json";
const defaultSupabaseLiveSnapshotPath = "data/recognition/reports/supabase-live-snapshot-2026-06-23.json";
const defaultSupabaseCandidateReportPath = "data/recognition/reports/supabase-feedback-candidates-report.json";
const defaultCommercialReviewPacketPath = "data/recognition/review/supabase-commercial-review-packet.json";
const defaultCommercialReviewWorklistPath = "data/recognition/review/supabase-commercial-review-worklist.json";
const minimumCommercialInventoryRows = 300;
const minimumCommercialGroundTruthAssets = 100;
const requiredCommercialTruthFields = Object.freeze(["year", "product", "players"]);
const retrievalSmokeDefaults = Object.freeze({
  brave: "data/smoke/brave-smoke-latest.json",
  ebay_browse: "data/smoke/ebay-smoke-latest.json",
  openai_web_search: "data/smoke/ows-smoke-latest.json"
});

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function readJsonFile(path) {
  const resolvedPath = resolve(path);
  const text = await readFile(resolvedPath, "utf8");
  return {
    path: resolvedPath,
    value: JSON.parse(text)
  };
}

async function readTextFile(path) {
  const resolvedPath = resolve(path);
  return {
    path: resolvedPath,
    text: await readFile(resolvedPath, "utf8")
  };
}

function checkResult(id, status, severity, summary, details = {}) {
  return {
    id,
    status,
    severity,
    summary,
    details
  };
}

function passed(id, summary, details = {}) {
  return checkResult(id, "passed", "info", summary, details);
}

function warning(id, summary, details = {}) {
  return checkResult(id, "warning", "warning", summary, details);
}

function blocked(id, summary, details = {}) {
  return checkResult(id, "blocked", "blocker", summary, details);
}

function formatReasons(reasons = []) {
  return reasons.length ? reasons.join("; ") : "none";
}

async function auditGoldenDataset(datasetPath) {
  try {
    const loaded = await readJsonFile(datasetPath);
    const evaluation = evaluateGoldenDataset(loaded.value);
    if (!evaluation.ok) {
      return {
        evaluation: null,
        checks: [
          blocked("golden_dataset", "Golden dataset validation failed.", {
            dataset: loaded.path,
            errors: evaluation.validation?.errors || []
          })
        ]
      };
    }

    const gate = evaluation.commercial_acceptance_gate;
    return {
      evaluation,
      checks: [
        passed("golden_dataset", "Golden dataset is readable and schema-valid.", {
          dataset: loaded.path,
          total_assets: evaluation.dataset.total_assets,
          split_counts: evaluation.dataset.split_counts
        }),
        gate.passed
          ? passed("commercial_acceptance_gate", "Held-out commercial acceptance gate passed.", {
            metric_scope: gate.metric_scope,
            held_out_commercial_assets: evaluation.held_out_commercial_evidence.total_assets,
            minimum_held_out_assets: gate.minimum_held_out_assets,
            reasons: gate.reasons,
            threshold_results: gate.threshold_results
          })
          : blocked("commercial_acceptance_gate", "Held-out commercial acceptance gate failed; commercial accuracy claims remain blocked.", {
            metric_scope: gate.metric_scope,
            held_out_commercial_assets: evaluation.held_out_commercial_evidence.total_assets,
            minimum_held_out_assets: gate.minimum_held_out_assets,
            reasons: gate.reasons,
            threshold_results: gate.threshold_results
          })
      ]
    };
  } catch (error) {
    return {
      evaluation: null,
      checks: [
        blocked("golden_dataset", "Golden dataset could not be read.", {
          dataset: resolve(datasetPath),
          error: error.message
        })
      ]
    };
  }
}

async function auditProviderPolicy() {
  const registry = await readTextFile("lib/listing/providers/provider-registry.mjs");
  const statusApi = await readTextFile("api/listing-provider-status.js");
  const appJs = await readTextFile("app/listing-copilot.js");
  const profileAdapter = await readTextFile("lib/listing/v4/application/recognition-profile-adapter.mjs");
  const failures = [];

  if (/allowLegacyDefault/.test(registry.text)) {
    failures.push("provider registry still contains allowLegacyDefault");
  }
  if (!/const defaultId = envDefault \|\| visionProviderIds\.OPENAI_LEGACY/.test(registry.text)) {
    failures.push("GPT is not the implicit production default provider in selectVisionProvider");
  }
  if (!/\[visionProviderIds\.OPENAI_LEGACY\]/.test(registry.text)) {
    failures.push("provider registry does not expose the GPT provider");
  }
  if (!/role:\s*providerRoles\.PRIMARY/.test(registry.text)) {
    failures.push("OpenAI provider is not marked as the production primary role");
  }
  if (!/openai\?\.selectable/.test(statusApi.text)) {
    failures.push("provider status API does not default to selectable OpenAI");
  }
  if (!/state\.selectedProvider = payload\.default_provider \|\| ""/.test(appJs.text)) {
    failures.push("frontend does not use the server default provider");
  }
  if (/state\.selectedProvider\s*=\s*["']openai_legacy["']/.test(appJs.text)) {
    failures.push("frontend hard-codes GPT instead of using the server default provider");
  }
  if (!/defaultProviderOptionsFromEnv/.test(profileAdapter.text) || !/writerAssistedProviderOverrides/.test(profileAdapter.text)) {
    failures.push("server recognition profile does not own production provider defaults");
  }
  if (!/withRecognitionRequestIntent/.test(appJs.text) || !/data-priority-retry/.test(appJs.text)) {
    failures.push("frontend does not preserve stable recognition intent and durable retry controls");
  }
  if (/provider_options\s*:|provider === "openai_legacy"/.test(appJs.text)) {
    failures.push("frontend still owns provider selection or algorithm options");
  }

  const details = {
    gpt_production_default: failures.length === 0,
    single_gpt_provider_only: failures.length === 0,
    gpt_primary_fast_vision: true,
    gpt_provider_present: /\[visionProviderIds\.OPENAI_LEGACY\]/.test(registry.text),
    mixed_model_cascade: /cascade_fast|secondary_provider_id/i.test(registry.text) ? "present" : "removed",
    gpt_implicit_default: failures.length === 0 ? "production_primary" : "unknown",
    standalone_gpt_default: failures.length === 0 ? "server_default" : "unknown",
    gpt_visible_button: /providerControl/.test(appJs.text),
    gpt_emergency_retry_action: /data-priority-retry/.test(appJs.text),
    recognition_profile_server_owned: /defaultProviderOptionsFromEnv/.test(profileAdapter.text),
    client_algorithm_controls_absent: !/provider_options\s*:|provider === "openai_legacy"/.test(appJs.text),
    checked_files: [registry.path, statusApi.path, appJs.path, profileAdapter.path],
    failures
  };

  return failures.length
    ? blocked("provider_default_policy", "Provider default policy is not safe enough for commercial readiness.", details)
    : passed("provider_default_policy", "The configured GPT model is the only production vision provider; automatic mixed-model cascade is removed.", details);
}

function destinationIdsFromPublisherContract(source) {
  const match = source.match(/publishDestinations\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/:\s*"([^"]+)"/g)).map((entry) => entry[1]);
}

async function auditPublishingBoundary() {
  const contract = await readTextFile("lib/listing/publishing/publisher-contract.mjs");
  const listingDraft = await readTextFile("lib/listing/publishing/listing-draft.mjs");
  const publishDraft = await readTextFile("lib/listing/publishing/publish-listing-draft.mjs");
  const appJs = await readTextFile("app/listing-copilot.js");
  const destinations = destinationIdsFromPublisherContract(contract.text);
  const approvalFailures = [];

  if (!/assertApprovedListingDraft\(listingDraftInput\)/.test(publishDraft.text)) {
    approvalFailures.push("publishListingDraft does not assert approved ListingDraft input");
  }
  if (!/review_status must be APPROVED before publishing/.test(listingDraft.text)) {
    approvalFailures.push("ListingDraft validator does not require APPROVED review_status");
  }
  if (!/approved_by is required before publishing/.test(listingDraft.text)) {
    approvalFailures.push("ListingDraft validator does not require approved_by");
  }
  if (!/approved_at is required before publishing/.test(listingDraft.text)) {
    approvalFailures.push("ListingDraft validator does not require approved_at");
  }
  if (!/publish_status must be READY before publishing/.test(listingDraft.text)) {
    approvalFailures.push("ListingDraft validator does not require READY publish_status");
  }
  if (/fetch\("\/api\/listing-publish-draft"/.test(appJs.text) || /data-publish-draft|data-quick-approve-publish/.test(appJs.text)) {
    approvalFailures.push("frontend title review surface exposes direct publish controls");
  }

  const approvalDetails = {
    checked_files: [contract.path, listingDraft.path, publishDraft.path, appJs.path],
    failures: approvalFailures
  };
  const destinationDetails = {
    destinations,
    mock_only: destinations.length === 1 && destinations[0] === "mock_b_end",
    checked_file: contract.path
  };

  return [
    approvalFailures.length
      ? blocked("publishing_approval_gate", "Publishing approval gate is not sufficiently enforced.", approvalDetails)
      : passed("publishing_approval_gate", "Publishing requires an approved ListingDraft and the V4 title review surface has no direct publish controls.", approvalDetails),
    destinationDetails.mock_only
      ? blocked("publishing_destination", "Only mock_b_end is configured; real B-end publishing remains blocked until API docs and an adapter exist.", destinationDetails)
      : passed("publishing_destination", "At least one non-mock publish destination is configured.", destinationDetails)
  ];
}

async function readOptionalSmokeReport(providerId, path) {
  if (!existsSync(resolve(path))) {
    return {
      provider: providerId,
      report: resolve(path),
      status: "missing"
    };
  }

  try {
    const loaded = await readJsonFile(path);
    return {
      provider: providerId,
      report: loaded.path,
      status: loaded.value.status || "unknown",
      generated_at: loaded.value.generated_at || null
    };
  } catch (error) {
    return {
      provider: providerId,
      report: resolve(path),
      status: "unreadable",
      error: error.message
    };
  }
}

async function auditRetrievalSmoke(env = process.env) {
  const reports = await Promise.all([
    readOptionalSmokeReport("brave", env.BRAVE_SMOKE_REPORT_PATH || retrievalSmokeDefaults.brave),
    readOptionalSmokeReport("ebay_browse", env.EBAY_SMOKE_REPORT_PATH || retrievalSmokeDefaults.ebay_browse),
    readOptionalSmokeReport("openai_web_search", env.OWS_SMOKE_REPORT_PATH || retrievalSmokeDefaults.openai_web_search)
  ]);
  const passedReports = reports.filter((report) => report.status === "passed");
  const failedReports = reports.filter((report) => !["passed", "missing"].includes(report.status));
  const details = {
    reports
  };

  if (passedReports.length === reports.length) {
    return passed("external_retrieval_live_smoke", "External retrieval providers have live smoke evidence.", details);
  }

  if (passedReports.length > 0 && failedReports.length === 0) {
    return warning("external_retrieval_live_smoke", "Some external retrieval smoke reports are present, but commercial readiness still needs the remaining providers.", details);
  }

  return blocked("external_retrieval_live_smoke", "No complete live smoke evidence exists for Brave, eBay Browse, and OWS retrieval paths.", details);
}

async function auditEbayImageCandidates(env = process.env) {
  const reportPath = env.EBAY_IMAGE_CANDIDATES_OUT || defaultEbayCandidatesPath;
  if (!existsSync(resolve(reportPath))) {
    return blocked("ebay_300_image_candidates", "eBay 300-image candidate report is missing.", {
      report: resolve(reportPath),
      target_count: 300,
      collected_count: 0,
      accuracy_eval_eligible: false
    });
  }

  try {
    const loaded = await readJsonFile(reportPath);
    const report = loaded.value || {};
    const targetCount = Number(report.target_count || 300);
    const collectedCount = Number(report.collected_count || 0);
    const items = Array.isArray(report.items) ? report.items : [];
    const eligibleItems = items.filter((item) => item.accuracy_eval_eligible === true);
    const details = {
      report: loaded.path,
      status: report.status || "unknown",
      target_count: targetCount,
      collected_count: collectedCount,
      accuracy_eval_eligible_items: eligibleItems.length,
      blocked_reason: report.blocked_reason || ""
    };

    if (report.status === "collected" && collectedCount >= targetCount && targetCount >= 300) {
      return warning("ebay_300_image_candidates", "eBay 300-image candidate queue exists, but it is not accuracy evidence until ground truth labels are added.", details);
    }

    return blocked("ebay_300_image_candidates", "eBay 300-image candidate queue is incomplete; no eBay image accuracy test can be claimed.", details);
  } catch (error) {
    return blocked("ebay_300_image_candidates", "eBay image candidate report could not be parsed.", {
      report: resolve(reportPath),
      error: error.message,
      accuracy_eval_eligible: false
    });
  }
}

async function auditSupabaseCommercialSample(env = process.env) {
  const snapshotPath = env.SUPABASE_LIVE_SNAPSHOT_PATH || defaultSupabaseLiveSnapshotPath;
  const candidateReportPath = env.SUPABASE_RECOGNITION_CANDIDATE_REPORT_PATH || defaultSupabaseCandidateReportPath;
  const checks = [];

  if (!existsSync(resolve(snapshotPath))) {
    const details = {
      snapshot: resolve(snapshotPath),
      minimum_rows: minimumCommercialInventoryRows,
      rows: 0,
      image_backed_rows: 0,
      rows_without_images: 0
    };
    return {
      evidence: null,
      checks: [
        blocked("supabase_commercial_inventory", "Supabase commercial snapshot is missing; the 351-row commercial sample is not auditable.", details),
        blocked("supabase_commercial_ground_truth", "Supabase commercial field-level ground truth is missing.", details)
      ]
    };
  }

  try {
    const snapshot = await readJsonFile(snapshotPath);
    const feedbackTable = snapshot.value?.tables?.["public.listing_title_feedback"] || {};
    const storageObjects = snapshot.value?.tables?.["storage.objects"] || {};
    const candidateStatus = snapshot.value?.candidate_export_status || {};
    const rows = Number(feedbackTable.rows || candidateStatus.mcp_rows_full_table_count || 0);
    const imageBackedRows = Number(feedbackTable.image_backed_rows || candidateStatus.local_candidate_count || 0);
    const rowsWithoutImages = Math.max(0, rows - imageBackedRows);
    const correctedTitleRows = Number(feedbackTable.rows_with_corrected_title || 0);
    let candidateReport = null;

    if (existsSync(resolve(candidateReportPath))) {
      candidateReport = await readJsonFile(candidateReportPath);
    }

    const candidateSummary = candidateReport?.value?.summary || {};
    const datasetStats = candidateReport?.value?.dataset_stats || {};
    const groundTruthFieldCounts = datasetStats.ground_truth_field_counts || {};
    const candidateValidation = candidateReport?.value?.validation || null;
    const candidateCount = Number(candidateSummary.item_count || candidateStatus.local_candidate_count || 0);
    const requiredCoverage = Object.fromEntries(
      requiredCommercialTruthFields.map((field) => [field, Number(groundTruthFieldCounts[field] || 0)])
    );
    const fullyCoveredRequiredFields = requiredCommercialTruthFields.filter((field) => {
      return Number(groundTruthFieldCounts[field] || 0) >= minimumCommercialGroundTruthAssets;
    });
    const correctedTitleReviewedTitleGroundTruth = correctedTitleRows > 0
      || candidateSummary.corrected_title_is_reviewed_title_ground_truth === true
      || candidateStatus.corrected_title_is_reviewed_title_ground_truth === true;
    const correctedTitleUsedAsFieldGroundTruth = candidateSummary.corrected_title_used_as_field_ground_truth === true
      || candidateStatus.corrected_title_used_as_field_ground_truth === true
      || candidateSummary.title_derived_fields_are_ground_truth === true
      || candidateStatus.title_derived_fields_are_ground_truth === true;
    const details = {
      snapshot: snapshot.path,
      candidate_report: candidateReport?.path || resolve(candidateReportPath),
      generated_at: snapshot.value?.generated_at || null,
      source_project_id: snapshot.value?.source?.project_id || null,
      source_project_name: snapshot.value?.source?.project_name || null,
      table_rows: rows,
      corrected_title_rows: correctedTitleRows,
      image_backed_rows: imageBackedRows,
      rows_without_images: rowsWithoutImages,
      storage_object_rows: Number(storageObjects.rows || 0),
      candidate_count: candidateCount,
      candidate_validation_ok: candidateValidation?.ok === true,
      candidate_validation_error_count: Number(candidateValidation?.errors?.length || candidateSummary.validation_error_count || 0),
      review_status: candidateSummary.review_status || candidateStatus.ground_truth_status || "unknown",
      corrected_title_is_reviewed_title_ground_truth: correctedTitleReviewedTitleGroundTruth,
      corrected_title_used_as_ground_truth: correctedTitleUsedAsFieldGroundTruth,
      corrected_title_used_as_field_ground_truth: correctedTitleUsedAsFieldGroundTruth,
      title_derived_fields_are_ground_truth: candidateSummary.title_derived_fields_are_ground_truth === true
        || candidateStatus.title_derived_fields_are_ground_truth === true,
      ground_truth_field_counts: groundTruthFieldCounts,
      required_truth_field_coverage: requiredCoverage,
      minimum_commercial_inventory_rows: minimumCommercialInventoryRows,
      minimum_commercial_ground_truth_assets: minimumCommercialGroundTruthAssets,
      no_image_rows_counted_separately: rowsWithoutImages === Number(candidateStatus.filtered_out_no_image_count || candidateStatus.table_records_without_images || rowsWithoutImages)
    };

    if (rows >= minimumCommercialInventoryRows && imageBackedRows > 0 && rowsWithoutImages >= 0) {
      checks.push(passed("supabase_commercial_inventory", "Supabase commercial sample inventory is present and no-image rows are counted separately.", details));
    } else {
      checks.push(blocked("supabase_commercial_inventory", "Supabase commercial sample inventory is incomplete or not image-backed.", details));
    }

    if (correctedTitleUsedAsFieldGroundTruth) {
      checks.push(blocked("supabase_commercial_ground_truth", "Corrected-title-derived fields are being treated as field-level ground truth; field-level commercial accuracy would be invalid.", details));
    } else if (
      candidateCount >= minimumCommercialGroundTruthAssets
      && fullyCoveredRequiredFields.length === requiredCommercialTruthFields.length
      && candidateSummary.review_status !== "NEEDS_REVIEW"
      && candidateValidation?.ok === true
    ) {
      checks.push(passed("supabase_commercial_ground_truth", "Supabase commercial sample has enough reviewed field-level ground truth for held-out evaluation.", details));
    } else {
      checks.push(blocked("supabase_commercial_ground_truth", "Supabase commercial rows exist, but field-level reviewed ground truth is not sufficient for a 95% exact-resolution claim.", {
        ...details,
        missing_required_truth_fields: requiredCommercialTruthFields.filter((field) => {
          return Number(groundTruthFieldCounts[field] || 0) < minimumCommercialGroundTruthAssets;
        })
      }));
    }

    return {
      evidence: details,
      checks
    };
  } catch (error) {
    const details = {
      snapshot: resolve(snapshotPath),
      candidate_report: resolve(candidateReportPath),
      error: error.message
    };
    return {
      evidence: null,
      checks: [
        blocked("supabase_commercial_inventory", "Supabase commercial snapshot could not be parsed.", details),
        blocked("supabase_commercial_ground_truth", "Supabase commercial ground truth could not be audited.", details)
      ]
    };
  }
}

async function auditCommercialReviewPacket(env = process.env) {
  const packetPath = env.COMMERCIAL_REVIEW_PACKET_PATH || defaultCommercialReviewPacketPath;

  if (!existsSync(resolve(packetPath))) {
    return warning("commercial_review_packet", "Commercial field-level review packet is missing; Supabase rows are not yet ready for operator labeling.", {
      packet: resolve(packetPath),
      task_count: 0,
      corrected_title_is_reviewed_title_ground_truth: false,
      corrected_title_used_as_field_ground_truth: false,
      corrected_title_used_as_ground_truth: false
    });
  }

  try {
    const loaded = await readJsonFile(packetPath);
    const packet = loaded.value || {};
    const tasks = Array.isArray(packet.tasks) ? packet.tasks : [];
    const correctedTitleReviewedTitleGroundTruth = packet.summary?.corrected_title_is_reviewed_title_ground_truth === true
      || tasks.some((task) => task.corrected_title_is_reviewed_title_ground_truth === true || Boolean(task.corrected_title_hint || task.source_titles?.corrected_title));
    const correctedTitleUsedAsFieldGroundTruth = packet.summary?.corrected_title_used_as_field_ground_truth === true
      || packet.summary?.corrected_title_used_as_ground_truth === true
      || tasks.some((task) => task.corrected_title_used_as_field_ground_truth === true || task.corrected_title_used_as_ground_truth === true);
    const details = {
      packet: loaded.path,
      schema_version: packet.schema_version || "unknown",
      task_count: Number(packet.summary?.task_count ?? tasks.length),
      corrected_title_hint_count: Number(packet.summary?.corrected_title_hint_count || 0),
      corrected_title_is_reviewed_title_ground_truth: correctedTitleReviewedTitleGroundTruth,
      corrected_title_used_as_ground_truth: correctedTitleUsedAsFieldGroundTruth,
      corrected_title_used_as_field_ground_truth: correctedTitleUsedAsFieldGroundTruth,
      suggested_field_task_count: Number(packet.summary?.suggested_field_task_count || 0),
      suggested_field_counts: packet.summary?.suggested_field_counts || {},
      suggested_fields_are_ground_truth: packet.summary?.suggested_fields_are_ground_truth === true,
      required_critical_fields: packet.summary?.required_critical_fields || []
    };

    if (correctedTitleUsedAsFieldGroundTruth || details.suggested_fields_are_ground_truth) {
      return blocked("commercial_review_packet", "Commercial review packet incorrectly marks title-derived fields as field-level ground truth.", details);
    }
    if (details.task_count > 0) {
      return passed("commercial_review_packet", "Commercial field-level review packet is ready for operator labeling.", details);
    }
    return warning("commercial_review_packet", "Commercial field-level review packet has no tasks.", details);
  } catch (error) {
    return warning("commercial_review_packet", "Commercial review packet could not be parsed.", {
      packet: resolve(packetPath),
      error: error.message,
      corrected_title_is_reviewed_title_ground_truth: false,
      corrected_title_used_as_field_ground_truth: false,
      corrected_title_used_as_ground_truth: false
    });
  }
}

async function auditCommercialReviewWorklist(env = process.env) {
  const worklistPath = env.COMMERCIAL_REVIEW_WORKLIST_PATH || defaultCommercialReviewWorklistPath;

  if (!existsSync(resolve(worklistPath))) {
    return warning("commercial_review_worklist", "Commercial review worklist is missing; operator labeling has no prioritized queue.", {
      worklist: resolve(worklistPath),
      task_count: 0,
      worklist_uses_ground_truth: false
    });
  }

  try {
    const loaded = await readJsonFile(worklistPath);
    const worklist = loaded.value || {};
    const items = Array.isArray(worklist.items) ? worklist.items : [];
    const badPolicyCount = Number(worklist.summary?.bad_policy_task_count || 0)
      + Number(worklist.summary?.corrected_title_used_as_ground_truth_count || 0)
      + Number(worklist.summary?.suggestions_are_ground_truth_count || 0);
    const details = {
      worklist: loaded.path,
      schema_version: worklist.schema_version || "unknown",
      task_count: Number(worklist.summary?.task_count ?? items.length),
      source_task_count: Number(worklist.summary?.source_task_count || 0),
      priority_band_counts: worklist.summary?.priority_band_counts || {},
      review_effort_counts: worklist.summary?.review_effort_counts || {},
      bad_policy_task_count: badPolicyCount,
      worklist_uses_ground_truth: worklist.summary?.worklist_uses_ground_truth === true
    };

    if (badPolicyCount > 0 || details.worklist_uses_ground_truth) {
      return blocked("commercial_review_worklist", "Commercial review worklist incorrectly uses title hints as ground truth.", details);
    }
    if (details.task_count > 0) {
      return passed("commercial_review_worklist", "Commercial review worklist is ready for prioritized operator labeling.", details);
    }
    return warning("commercial_review_worklist", "Commercial review worklist has no tasks.", details);
  } catch (error) {
    return warning("commercial_review_worklist", "Commercial review worklist could not be parsed.", {
      worklist: resolve(worklistPath),
      error: error.message,
      worklist_uses_ground_truth: false
    });
  }
}

async function auditIdentityResultCache(env = process.env) {
  const details = {
    table: identityResultCacheTable,
    read_enabled: identityResultCacheReadEnabled(env),
    write_enabled: identityResultCacheWriteEnabled(env),
    write_resolved_enabled: identityResultCacheWriteResolvedEnabled(env),
    terminal_l2_abstain_replay_enabled: true,
    cache_ttl_days: Number(env.LISTING_IDENTITY_CACHE_TTL_DAYS || 30),
    data_api_service_role_required: true,
    training_table: false,
    stores_signed_urls: false,
    failures: []
  };

  try {
    const cacheModule = await readTextFile("lib/listing/cache/identity-result-cache.mjs");
    const titleApi = await readTextFile("lib/listing/v4/pipeline/native-recognition-core.mjs");
    const migration = await readTextFile("supabase/migrations/20260623_listing_identity_result_cache.sql");
    const envExample = await readTextFile(".env.example");
    details.checked_files = [cacheModule.path, titleApi.path, migration.path, envExample.path];

    if (!/buildIdentityResultCacheKey/.test(cacheModule.text) || !/content_sha256/.test(cacheModule.text)) {
      details.failures.push("cache key does not require content SHA-256 fingerprints");
    }
    if (!/storage_verified/.test(cacheModule.text)
      || !/final_title_required/.test(cacheModule.text)
      || !/year_required/.test(cacheModule.text)
      || !/product_required/.test(cacheModule.text)
      || !/subject_required/.test(cacheModule.text)
      || !/ambiguity_status_ambiguous/.test(cacheModule.text)) {
      details.failures.push("cacheability guard does not require verified storage and complete non-ambiguous writer-ready L2");
    }
    if (!/resolution_trace/.test(cacheModule.text)) {
      details.failures.push("cache module does not preserve resolution_trace");
    }
    if (!/createIdentityCacheTitle/.test(titleApi.text) || !/withIdentityCacheWrite/.test(titleApi.text)) {
      details.failures.push("title API is not wired for identity cache read/write");
    }
    if (!/readListingImageVerificationRecord/.test(titleApi.text) || !/content_hash_verification_mismatch/.test(titleApi.text)) {
      details.failures.push("title API does not re-check durable image verification before cache use");
    }
    if (!/alter table public\.listing_identity_resolution_cache enable row level security/i.test(migration.text)) {
      details.failures.push("identity cache table does not enable RLS");
    }
    if (!/grant select, insert, update, delete on table public\.listing_identity_resolution_cache to service_role/i.test(migration.text)) {
      details.failures.push("identity cache table does not explicitly grant Data API access to service_role");
    }
    if (!/revoke all on table public\.listing_identity_resolution_cache from anon, authenticated/i.test(migration.text)) {
      details.failures.push("identity cache table does not explicitly keep anon/authenticated out");
    }
    if (/grant\s+[^;]*\s+to\s+(anon|authenticated)/i.test(migration.text)) {
      details.failures.push("identity cache migration grants browser roles access");
    }
    if (!/Not a training table/i.test(migration.text)) {
      details.failures.push("identity cache migration does not state the cache is not training data");
    }
    if (!/LISTING_IDENTITY_CACHE_READ_ENABLED/.test(envExample.text) || !/LISTING_IDENTITY_CACHE_WRITE_ENABLED/.test(envExample.text)) {
      details.failures.push("identity cache env toggles are missing from .env.example");
    }

    return details.failures.length
      ? blocked("identity_result_cache", "Identity result cache exists but violates the safety or audit contract.", details)
      : passed("identity_result_cache", "Identity result cache is wired as a verified-hash, server-only, non-training fast path.", details);
  } catch (error) {
    return warning("identity_result_cache", "Identity result cache is not fully present; duplicate-image cost reduction is not active.", {
      ...details,
      error: error.message
    });
  }
}

export async function createCommercialReadinessReport({
  datasetPath = defaultDatasetPath,
  env = process.env
} = {}) {
  const checks = [];
  const golden = await auditGoldenDataset(datasetPath);
  checks.push(...golden.checks);

  checks.push(await auditProviderPolicy());
  checks.push(...await auditPublishingBoundary());
  checks.push(await auditRetrievalSmoke(env));
  checks.push(await auditEbayImageCandidates(env));
  const supabaseCommercial = await auditSupabaseCommercialSample(env);
  checks.push(...supabaseCommercial.checks);
  checks.push(await auditCommercialReviewPacket(env));
  checks.push(await auditCommercialReviewWorklist(env));
  checks.push(await auditIdentityResultCache(env));

  const blockers = checks.filter((check) => check.status === "blocked");
  const warnings = checks.filter((check) => check.status === "warning");

  return {
    ok: blockers.length === 0,
    status: blockers.length ? "blocked" : warnings.length ? "ready_with_warnings" : "ready",
    generated_at: new Date().toISOString(),
    checks,
    blockers: blockers.map((check) => ({
      id: check.id,
      summary: check.summary
    })),
    warnings: warnings.map((check) => ({
      id: check.id,
      summary: check.summary
    })),
    evidence: {
      golden_dataset: golden.evaluation
        ? {
          dataset_path: resolve(datasetPath),
          total_assets: golden.evaluation.dataset.total_assets,
          split_counts: golden.evaluation.dataset.split_counts,
          held_out_commercial_assets: golden.evaluation.held_out_commercial_evidence.total_assets,
          commercial_acceptance_gate: golden.evaluation.commercial_acceptance_gate
        }
        : null,
      supabase_commercial_sample: supabaseCommercial.evidence,
      commercial_review_packet: checks.find((check) => check.id === "commercial_review_packet")?.details || null,
      commercial_review_worklist: checks.find((check) => check.id === "commercial_review_worklist")?.details || null,
      identity_result_cache: checks.find((check) => check.id === "identity_result_cache")?.details || null
    }
  };
}

export function formatCommercialReadinessReport(report) {
  const commercialGate = report.evidence.golden_dataset?.commercial_acceptance_gate || {};
  const heldOutCount = report.evidence.golden_dataset?.held_out_commercial_assets ?? "n/a";
  const providerPolicy = report.checks.find((check) => check.id === "provider_default_policy");
  const retrievalSmoke = report.checks
    .find((check) => check.id === "external_retrieval_live_smoke")
    ?.details?.reports || [];
  const retrievalSmokeSummary = retrievalSmoke.length
    ? retrievalSmoke.map((item) => `${item.provider}=${item.status}`).join(", ")
    : "n/a";
  const ebayCandidates = report.checks.find((check) => check.id === "ebay_300_image_candidates");
  const ebayCandidateSummary = ebayCandidates
    ? `${ebayCandidates.details.status || "missing"} ${ebayCandidates.details.collected_count ?? 0}/${ebayCandidates.details.target_count ?? 300}`
    : "n/a";
  const supabaseSample = report.checks.find((check) => check.id === "supabase_commercial_inventory");
  const supabaseTruth = report.checks.find((check) => check.id === "supabase_commercial_ground_truth");
  const supabaseSampleSummary = supabaseSample
    ? `${supabaseSample.status} rows ${supabaseSample.details.table_rows ?? 0}, image-backed ${supabaseSample.details.image_backed_rows ?? 0}, no-image ${supabaseSample.details.rows_without_images ?? 0}`
    : "n/a";
  const supabaseTruthSummary = supabaseTruth
    ? `${supabaseTruth.status} required fields ${Object.entries(supabaseTruth.details.required_truth_field_coverage || {}).map(([field, count]) => `${field}=${count}`).join(", ")}`
    : "n/a";
  const reviewPacket = report.checks.find((check) => check.id === "commercial_review_packet");
  const reviewPacketSummary = reviewPacket
    ? `${reviewPacket.status} tasks ${reviewPacket.details.task_count ?? 0}, reviewed-title-gt ${reviewPacket.details.corrected_title_is_reviewed_title_ground_truth === true ? "yes" : "no"}, field-gt-from-title ${reviewPacket.details.corrected_title_used_as_field_ground_truth === true || reviewPacket.details.corrected_title_used_as_ground_truth === true ? "yes" : "no"}, suggested-field-hints ${reviewPacket.details.suggested_field_task_count ?? 0}`
    : "n/a";
  const reviewWorklist = report.checks.find((check) => check.id === "commercial_review_worklist");
  const reviewWorklistSummary = reviewWorklist
    ? `${reviewWorklist.status} tasks ${reviewWorklist.details.task_count ?? 0}, P0 ${reviewWorklist.details.priority_band_counts?.P0 ?? 0}, P1 ${reviewWorklist.details.priority_band_counts?.P1 ?? 0}, uses-ground-truth ${reviewWorklist.details.worklist_uses_ground_truth === true ? "yes" : "no"}`
    : "n/a";
  const identityCache = report.checks.find((check) => check.id === "identity_result_cache");
  const identityCacheSummary = identityCache
    ? `${identityCache.status} read ${identityCache.details.read_enabled ? "yes" : "no"}, write ${identityCache.details.write_enabled ? "yes" : "no"}, training ${identityCache.details.training_table === true ? "yes" : "no"}`
    : "n/a";
  const lines = [
    `Commercial readiness audit ${report.status}`,
    `held_out_commercial_assets: ${heldOutCount}`,
    `commercial_acceptance_gate: ${commercialGate.passed === true ? "passed" : "blocked"}`,
    `commercial_acceptance_reasons: ${formatReasons(commercialGate.reasons || [])}`,
    `external_retrieval_smoke_statuses: ${retrievalSmokeSummary}`,
    `ebay_image_candidates: ${ebayCandidateSummary}`,
    `supabase_commercial_sample: ${supabaseSampleSummary}`,
    `supabase_commercial_ground_truth: ${supabaseTruthSummary}`,
    `commercial_review_packet: ${reviewPacketSummary}`,
    `commercial_review_worklist: ${reviewWorklistSummary}`,
    `identity_result_cache: ${identityCacheSummary}`,
    `gpt_implicit_default: ${providerPolicy?.details?.gpt_implicit_default || "unknown"}`,
    `standalone_gpt_default: ${providerPolicy?.details?.standalone_gpt_default || "unknown"}`,
    "",
    "checks:"
  ];

  report.checks.forEach((check) => {
    lines.push(`- ${check.id}: ${check.status} - ${check.summary}`);
  });

  if (report.blockers.length) {
    lines.push("", "blockers:");
    report.blockers.forEach((check) => {
      lines.push(`- ${check.id}: ${check.summary}`);
    });
  }

  if (report.warnings.length) {
    lines.push("", "warnings:");
    report.warnings.forEach((check) => {
      lines.push(`- ${check.id}: ${check.summary}`);
    });
  }

  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv, env = process.env) {
  const datasetPath = argValue(argv, "--dataset", env.GOLDEN_DATASET_PATH || defaultDatasetPath);
  const reportPath = argValue(argv, "--report", env.COMMERCIAL_READINESS_REPORT_PATH || "");
  const asJson = hasFlag(argv, "--json");
  const report = await createCommercialReadinessReport({
    datasetPath,
    env
  });

  if (reportPath) {
    const resolvedPath = resolve(reportPath);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : formatCommercialReadinessReport(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Commercial readiness audit failed: ${error.message}`);
    process.exit(1);
  }
}
