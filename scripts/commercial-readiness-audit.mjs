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
const defaultAgnesSmokePath = "data/smoke/agnes-smoke-latest.json";
const defaultEbayCandidatesPath = "data/ebay-candidates/ebay-image-candidates-latest.json";
const defaultPublicCardEvalPath = "data/eval/agnes-public-card-image-eval-latest.json";
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

function safeSmokeCapability(capability = {}) {
  const detailAllowlist = new Set([
    "model_id",
    "parse_source",
    "finish_reason",
    "image_count",
    "provider_calls",
    "error_code",
    "status"
  ]);
  const details = Object.fromEntries(
    Object.entries(capability.details || {})
      .filter(([key]) => detailAllowlist.has(key))
      .map(([key, value]) => [key, String(value).slice(0, 160)])
  );

  return {
    name: String(capability.name || ""),
    status: String(capability.status || ""),
    required: capability.required === true,
    ...(Object.keys(details).length ? { details } : {})
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

async function auditAgnesSmoke(smokePath) {
  if (!existsSync(resolve(smokePath))) {
    return {
      smoke: null,
      check: blocked("agnes_live_smoke", "Agnes live smoke report is missing.", {
        report: resolve(smokePath),
        required_capability: "single_image_json"
      })
    };
  }

  try {
    const loaded = await readJsonFile(smokePath);
    const smoke = loaded.value;
    const capabilities = Array.isArray(smoke.capabilities)
      ? smoke.capabilities.map(safeSmokeCapability)
      : [];
    const singleImage = capabilities.find((capability) => capability.name === "single_image_json");
    const optionalFailures = capabilities.filter((capability) => {
      return capability.status === "failed" && capability.required !== true;
    });
    const jsonBaselinePassed = smoke.provider === "agnes"
      && ["passed", "passed_with_limitations"].includes(String(smoke.status || ""))
      && singleImage?.status === "passed";
    const details = {
      report: loaded.path,
      provider: smoke.provider || null,
      status: smoke.status || null,
      generated_at: smoke.generated_at || null,
      json_baseline_verified: jsonBaselinePassed,
      capabilities
    };

    if (!jsonBaselinePassed) {
      return {
        smoke,
        check: blocked("agnes_live_smoke", "Agnes JSON baseline smoke is not verified.", details)
      };
    }

    if (optionalFailures.length) {
      return {
        smoke,
        check: warning("agnes_live_smoke", "Agnes JSON baseline is verified, but optional smoke capabilities still have limitations.", {
          ...details,
          optional_failures: optionalFailures.map((capability) => capability.name)
        })
      };
    }

    return {
      smoke,
      check: passed("agnes_live_smoke", "Agnes live smoke baseline is verified.", details)
    };
  } catch (error) {
    return {
      smoke: null,
      check: blocked("agnes_live_smoke", "Agnes smoke report could not be parsed.", {
        report: resolve(smokePath),
        error: error.message
      })
    };
  }
}

async function auditProviderPolicy() {
  const registry = await readTextFile("lib/listing/providers/provider-registry.mjs");
  const statusApi = await readTextFile("api/listing-provider-status.js");
  const appJs = await readTextFile("app/listing-copilot.js");
  const failures = [];

  if (/allowLegacyDefault/.test(registry.text)) {
    failures.push("provider registry still contains allowLegacyDefault");
  }
  if (!/const defaultId = envDefault \|\| visionProviderIds\.GEMINI/.test(registry.text)) {
    failures.push("Gemini is not the implicit default provider in selectVisionProvider");
  }
  if (!/\[visionProviderIds\.GEMINI\]/.test(registry.text)) {
    failures.push("Gemini provider is missing from provider registry");
  }
  if (!/primary_provider_id:\s*visionProviderIds\.OPENAI_LEGACY/.test(registry.text)
    || !/secondary_provider_id:\s*visionProviderIds\.AGNES/.test(registry.text)) {
    failures.push("Cascade A/B path does not declare GPT-4.1 mini primary plus Agnes secondary verifier");
  }
  if (!/GPT-4\.1 single-provider mode may only be used through an explicit manual retry/.test(registry.text)) {
    failures.push("GPT-4.1 explicit manual single-provider guard is missing");
  }
  if (!/provider\.id === visionProviderIds\.OPENAI_LEGACY/.test(registry.text)) {
    failures.push("OpenAI single-provider branch is missing from explicit retry guard");
  }
  if (!/gemini\?\.selectable/.test(statusApi.text)) {
    failures.push("provider status API does not default to selectable Gemini");
  }
  if (!/state\.selectedProvider = payload\.default_provider \|\| ""/.test(appJs.text)) {
    failures.push("frontend does not use the server default provider");
  }
  if (/state\.selectedProvider\s*=\s*["']openai_legacy["']/.test(appJs.text)) {
    failures.push("frontend default-selects GPT-4.1 single-provider mode instead of cascade");
  }
  if (!/provider === "openai_legacy"/.test(appJs.text) || !/data-emergency-retry/.test(appJs.text)) {
    failures.push("frontend does not expose GPT-4.1 as a separate manual action");
  }

  const details = {
    gemini_implicit_default: failures.length === 0,
    gpt_primary_fast_vision: /primary_provider_id:\s*visionProviderIds\.OPENAI_LEGACY/.test(registry.text),
    agnes_auxiliary_verifier: /secondary_provider_id:\s*visionProviderIds\.AGNES/.test(registry.text),
    agnes_conditional_verifier: /secondary_provider_id:\s*visionProviderIds\.AGNES/.test(registry.text),
    gpt_implicit_default: failures.length === 0 ? "fallback_and_ab_test_only" : "unknown",
    standalone_gpt_default: failures.length === 0 ? "blocked_by_policy" : "unknown",
    gpt_visible_button: /provider === "openai_legacy"/.test(appJs.text),
    gpt_emergency_retry_action: /data-emergency-retry/.test(appJs.text),
    checked_files: [registry.path, statusApi.path, appJs.path],
    failures
  };

  return failures.length
    ? blocked("provider_default_policy", "Provider default policy is not safe enough for commercial readiness.", details)
    : passed("provider_default_policy", "Gemini is the implicit default; GPT-4.1 remains explicit fallback/A/B; Agnes remains the auxiliary verifier in cascade mode.", details);
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
  if (!/destination: "mock_b_end"/.test(appJs.text) || !/dry_run: true/.test(appJs.text)) {
    approvalFailures.push("frontend mock publish path is not fixed to dry-run mock_b_end");
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
      : passed("publishing_approval_gate", "Publishing requires an approved ListingDraft and keeps the frontend mock publish path dry-run.", approvalDetails),
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

async function auditPublicCardReferenceEval(env = process.env) {
  const reportPath = env.AGNES_PUBLIC_CARD_EVAL_OUT || defaultPublicCardEvalPath;
  const threshold = Number(env.AGNES_PUBLIC_CARD_NAME_THRESHOLD || 0.95);

  if (!existsSync(resolve(reportPath))) {
    return warning("public_card_reference_eval", "Public 300-card reference eval is missing; this does not affect the commercial held-out gate.", {
      report: resolve(reportPath),
      target_count: 300,
      attempted_count: 0,
      commercial_accuracy_claim_allowed: false,
      name_threshold: Number.isFinite(threshold) ? threshold : 0.95
    });
  }

  try {
    const loaded = await readJsonFile(reportPath);
    const report = loaded.value || {};
    const attemptedCount = Number(report.attempted_count || 0);
    const evaluatedCount = Number(report.evaluated_count || 0);
    const exactCount = Number(report.card_name_exact_count || 0);
    const exactRate = Number(report.card_name_exact_rate);
    const correctedCount = report.structured_reference_name_exact_or_corrected_count === undefined
      ? exactCount
      : Number(report.structured_reference_name_exact_or_corrected_count || 0);
    const correctedRate = Number(report.structured_reference_name_exact_or_corrected_rate);
    const thresholdRate = Number.isFinite(correctedRate) ? correctedRate : exactRate;
    const thresholdValue = Number.isFinite(threshold) ? threshold : Number(report.name_threshold || 0.95);
    const details = {
      report: loaded.path,
      status: report.status || "unknown",
      provider: report.provider || "agnes",
      target_count: Number(report.target_count || 300),
      attempted_count: attemptedCount,
      evaluated_count: evaluatedCount,
      provider_error_count: Number(report.provider_error_count || 0),
      card_name_exact_count: exactCount,
      card_name_exact_rate: Number.isFinite(exactRate) ? exactRate : null,
      structured_reference_name_exact_or_corrected_count: correctedCount,
      structured_reference_name_exact_or_corrected_rate: Number.isFinite(correctedRate) ? correctedRate : null,
      structured_reference_name_corrected_count: Number(report.structured_reference_name_corrected_count || 0),
      structured_reference_name_review_suggested_count: Number(report.structured_reference_name_review_suggested_count || 0),
      name_threshold: thresholdValue,
      commercial_accuracy_claim_allowed: report.commercial_accuracy_claim_allowed === true,
      commercial_accuracy_eval_eligible: report.commercial_accuracy_eval_eligible === true,
      reference_scope: report.reference_scope || "public_structured_card_name_reference"
    };

    if (report.status === "completed" && attemptedCount >= 300 && thresholdRate >= thresholdValue) {
      return passed("public_card_reference_eval", "Public 300-card reference eval passed its non-commercial card-name threshold.", details);
    }

    return warning("public_card_reference_eval", "Public card reference eval is incomplete or below threshold; commercial held-out gate remains unchanged.", details);
  } catch (error) {
    return warning("public_card_reference_eval", "Public card reference eval report could not be parsed; commercial held-out gate remains unchanged.", {
      report: resolve(reportPath),
      error: error.message,
      commercial_accuracy_claim_allowed: false
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
    const correctedTitleUsedAsGroundTruth = candidateSummary.corrected_title_used_as_ground_truth === true
      || candidateStatus.corrected_title_used_as_ground_truth === true;
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
      corrected_title_used_as_ground_truth: correctedTitleUsedAsGroundTruth,
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

    if (correctedTitleUsedAsGroundTruth) {
      checks.push(blocked("supabase_commercial_ground_truth", "Corrected titles are being treated as ground truth; field-level commercial accuracy would be invalid.", details));
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
      corrected_title_used_as_ground_truth: false
    });
  }

  try {
    const loaded = await readJsonFile(packetPath);
    const packet = loaded.value || {};
    const tasks = Array.isArray(packet.tasks) ? packet.tasks : [];
    const correctedTitleUsedAsGroundTruth = packet.summary?.corrected_title_used_as_ground_truth === true
      || tasks.some((task) => task.corrected_title_used_as_ground_truth === true);
    const details = {
      packet: loaded.path,
      schema_version: packet.schema_version || "unknown",
      task_count: Number(packet.summary?.task_count ?? tasks.length),
      corrected_title_hint_count: Number(packet.summary?.corrected_title_hint_count || 0),
      corrected_title_used_as_ground_truth: correctedTitleUsedAsGroundTruth,
      suggested_field_task_count: Number(packet.summary?.suggested_field_task_count || 0),
      suggested_field_counts: packet.summary?.suggested_field_counts || {},
      suggested_fields_are_ground_truth: packet.summary?.suggested_fields_are_ground_truth === true,
      required_critical_fields: packet.summary?.required_critical_fields || []
    };

    if (correctedTitleUsedAsGroundTruth || details.suggested_fields_are_ground_truth) {
      return blocked("commercial_review_packet", "Commercial review packet incorrectly marks title hints as ground truth.", details);
    }
    if (details.task_count > 0) {
      return passed("commercial_review_packet", "Commercial field-level review packet is ready for operator labeling.", details);
    }
    return warning("commercial_review_packet", "Commercial field-level review packet has no tasks.", details);
  } catch (error) {
    return warning("commercial_review_packet", "Commercial review packet could not be parsed.", {
      packet: resolve(packetPath),
      error: error.message,
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
    cache_ttl_days: Number(env.LISTING_IDENTITY_CACHE_TTL_DAYS || 30),
    data_api_service_role_required: true,
    training_table: false,
    stores_signed_urls: false,
    failures: []
  };

  try {
    const cacheModule = await readTextFile("lib/listing/cache/identity-result-cache.mjs");
    const titleApi = await readTextFile("api/listing-copilot-title.js");
    const migration = await readTextFile("supabase/migrations/20260623_listing_identity_result_cache.sql");
    const envExample = await readTextFile(".env.example");
    details.checked_files = [cacheModule.path, titleApi.path, migration.path, envExample.path];

    if (!/buildIdentityResultCacheKey/.test(cacheModule.text) || !/content_sha256/.test(cacheModule.text)) {
      details.failures.push("cache key does not require content SHA-256 fingerprints");
    }
    if (!/storage_verified/.test(cacheModule.text) || !/identity_resolution_abstain/.test(cacheModule.text)) {
      details.failures.push("cacheability guard does not require verified storage and abstain rejection");
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
  agnesSmokePath = defaultAgnesSmokePath,
  env = process.env
} = {}) {
  const checks = [];
  const golden = await auditGoldenDataset(datasetPath);
  checks.push(...golden.checks);

  const agnes = await auditAgnesSmoke(agnesSmokePath);
  checks.push(agnes.check);
  checks.push(await auditProviderPolicy());
  checks.push(...await auditPublishingBoundary());
  checks.push(await auditRetrievalSmoke(env));
  checks.push(await auditEbayImageCandidates(env));
  checks.push(await auditPublicCardReferenceEval(env));
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
      agnes_smoke: agnes.smoke
        ? {
          report_path: resolve(agnesSmokePath),
          provider: agnes.smoke.provider || null,
          status: agnes.smoke.status || null,
          generated_at: agnes.smoke.generated_at || null
        }
        : null,
      public_card_reference_eval: checks.find((check) => check.id === "public_card_reference_eval")?.details || null,
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
  const agnesStatus = report.evidence.agnes_smoke?.status || "missing";
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
  const publicCardEval = report.checks.find((check) => check.id === "public_card_reference_eval");
  const publicCardSummary = publicCardEval
    ? `${publicCardEval.details.status || "missing"} exact ${publicCardEval.details.card_name_exact_count ?? 0}/${publicCardEval.details.attempted_count ?? 0} (${publicCardEval.details.card_name_exact_rate ?? "n/a"}), trusted ${publicCardEval.details.structured_reference_name_exact_or_corrected_count ?? publicCardEval.details.card_name_exact_count ?? 0}/${publicCardEval.details.attempted_count ?? 0} (${publicCardEval.details.structured_reference_name_exact_or_corrected_rate ?? publicCardEval.details.card_name_exact_rate ?? "n/a"})`
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
    ? `${reviewPacket.status} tasks ${reviewPacket.details.task_count ?? 0}, corrected-title-as-truth ${reviewPacket.details.corrected_title_used_as_ground_truth === true ? "yes" : "no"}, suggested-field-hints ${reviewPacket.details.suggested_field_task_count ?? 0}`
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
    `agnes_smoke_status: ${agnesStatus}`,
    `external_retrieval_smoke_statuses: ${retrievalSmokeSummary}`,
    `ebay_image_candidates: ${ebayCandidateSummary}`,
    `public_card_reference_eval: ${publicCardSummary}`,
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
  const agnesSmokePath = argValue(argv, "--agnes-smoke-report", env.SMOKE_PROVIDER_REPORT_PATH || defaultAgnesSmokePath);
  const reportPath = argValue(argv, "--report", env.COMMERCIAL_READINESS_REPORT_PATH || "");
  const asJson = hasFlag(argv, "--json");
  const report = await createCommercialReadinessReport({
    datasetPath,
    agnesSmokePath,
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
