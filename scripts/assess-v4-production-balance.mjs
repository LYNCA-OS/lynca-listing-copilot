#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateRow, metricRow } from "./compare-concurrency-sweep.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratio(numerator, denominator) {
  const top = numberOrNull(numerator);
  const bottom = numberOrNull(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return Number((top / bottom).toFixed(6));
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const output = resolve(path);
  if (!existsSync(dirname(output))) await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

export function accuracyEvidence(report = {}) {
  const cardExact = report.metrics?.ai_card_exact_accuracy;
  if (cardExact && numberOrNull(cardExact.rate) !== null) {
    return {
      eligible: true,
      evidence_type: "REVIEWED_FIELD_CARD_EXACT",
      value: numberOrNull(cardExact.rate),
      correct: numberOrNull(cardExact.correct),
      total: numberOrNull(cardExact.total),
      boundary: "all applicable reviewed identity fields must match"
    };
  }

  const reviewedTitleGroundTruth = report.accuracy_policy?.corrected_title_is_reviewed_title_ground_truth === true
    || report.accuracy_policy?.corrected_title_as_reviewed_title_gt === true;
  if (reviewedTitleGroundTruth) {
    const attempted = numberOrNull(report.attempted_count ?? report.summary?.attempted_count);
    const passCount = numberOrNull(
      report.policy_fair_pass_at_0_72_count
      ?? report.summary?.final_accuracy_proxy?.policy_fair_pass_at_0_72
    );
    const explicitRate = numberOrNull(report.policy_fair_pass_at_0_72_rate);
    return {
      eligible: explicitRate !== null || (attempted !== null && passCount !== null),
      evidence_type: "REVIEWED_TITLE_POLICY_ACCEPTANCE",
      value: explicitRate ?? ratio(passCount, attempted),
      correct: passCount,
      total: attempted,
      boundary: "reviewed title-level acceptance; not field-level card exact"
    };
  }

  return {
    eligible: false,
    evidence_type: "NO_REVIEWED_GROUND_TRUTH",
    value: null,
    correct: null,
    total: null,
    boundary: report.blind_policy?.seller_title_is_ground_truth === false
      ? "sealed marketplace title is a weak diagnostic only"
      : "accuracy report does not prove reviewed ground truth"
  };
}

export function assessStabilityReport(report = {}, {
  minimumCards = 50,
  maximumWriterP95Ms = 120_000,
  requireVectorRuntime = false,
  requireStabilityEnvelope = true
} = {}) {
  const envelope = report.schema_version === "v4-stability-envelope-v1"
    ? report
    : report.stability_envelope?.schema_version === "v4-stability-envelope-v1"
      ? report.stability_envelope
      : null;
  if (envelope) {
    const aggregate = envelope.aggregate || {};
    const rejectionReasons = [...(Array.isArray(envelope.rejection_reasons) ? envelope.rejection_reasons : [])];
    if (Number(aggregate.attempted_count || 0) < minimumCards) rejectionReasons.push("STABILITY_SAMPLE_TOO_SMALL");
    if (numberOrNull(aggregate.writer_ready_p95_ms) === null) rejectionReasons.push("WRITER_P95_MISSING");
    if (numberOrNull(aggregate.writer_ready_p95_ms) !== null && Number(aggregate.writer_ready_p95_ms) > maximumWriterP95Ms) {
      rejectionReasons.push("WRITER_P95_ABOVE_BUDGET");
    }
    const vectorRuntimeUnavailableCount = Number(report.summary?.vector_runtime_status_breakdown?.UNAVAILABLE || 0);
    if (requireVectorRuntime && vectorRuntimeUnavailableCount > 0) {
      rejectionReasons.push("VECTOR_RUNTIME_REQUIRED_BUT_UNAVAILABLE");
    }
    return {
      pass: rejectionReasons.length === 0 && envelope.pass === true,
      evidence_type: "MULTI_WAVE_MULTI_TENANT_ENVELOPE",
      attempted_count: Number(aggregate.attempted_count || 0),
      minimum_cards: minimumCards,
      wave_count: Number(aggregate.wave_count || 0),
      tenant_count: Number(aggregate.tenant_count || 0),
      technical_availability: numberOrNull(aggregate.technical_availability),
      tenant_completion_fairness: numberOrNull(aggregate.tenant_completion_fairness),
      residual_backlog_count: Number(aggregate.residual_backlog_count || 0),
      completed_cards_per_minute: numberOrNull(report.summary?.completed_cards_per_minute),
      writer_ready_p50_ms: numberOrNull(report.summary?.writer_ready_p50_ms),
      writer_ready_p95_ms: numberOrNull(aggregate.writer_ready_p95_ms),
      maximum_writer_p95_ms: maximumWriterP95Ms,
      scheduler_queue_wait_p95_ms: numberOrNull(report.summary?.scheduler_queue_wait_p95_ms),
      provider_latency_p95_ms: numberOrNull(report.summary?.provider_diagnostics?.provider_latency_p95_ms),
      ocr_stage_global_capacity: numberOrNull(report.summary?.preingestion_ocr?.stage_global_capacity_latest),
      ocr_stage_capacity_wait_p95_ms: numberOrNull(report.summary?.preingestion_ocr?.stage_capacity_wait_p95_ms),
      ocr_worker_timeout_count: Number(report.summary?.preingestion_ocr?.worker_timeout_count || 0),
      vector_runtime_unavailable_count: vectorRuntimeUnavailableCount,
      rejection_reasons: [...new Set(rejectionReasons)],
      warning_reasons: Array.isArray(envelope.warning_reasons) ? envelope.warning_reasons : []
    };
  }
  const row = metricRow(report, "", report.concurrency ?? report.configured_concurrency ?? 0);
  const evaluated = evaluateRow(row, row);
  const rejectionReasons = [...evaluated.rejection_reasons];
  if (requireStabilityEnvelope) rejectionReasons.push("MULTI_WAVE_STABILITY_ENVELOPE_REQUIRED");
  if (row.attempted_count < minimumCards) rejectionReasons.push("STABILITY_SAMPLE_TOO_SMALL");
  if (row.writer_ready_p95_ms === null) rejectionReasons.push("WRITER_P95_MISSING");
  if (row.writer_ready_p95_ms !== null && row.writer_ready_p95_ms > maximumWriterP95Ms) {
    rejectionReasons.push("WRITER_P95_ABOVE_BUDGET");
  }
  if (requireVectorRuntime && row.vector_runtime_unavailable_count > 0) {
    rejectionReasons.push("VECTOR_RUNTIME_REQUIRED_BUT_UNAVAILABLE");
  }
  return {
    pass: rejectionReasons.length === 0,
    evidence_type: "SINGLE_RUN_LEGACY",
    attempted_count: row.attempted_count,
    minimum_cards: minimumCards,
    completed_cards_per_minute: row.completed_cards_per_minute,
    writer_ready_p50_ms: row.writer_ready_p50_ms,
    writer_ready_p95_ms: row.writer_ready_p95_ms,
    maximum_writer_p95_ms: maximumWriterP95Ms,
    scheduler_queue_wait_p95_ms: row.scheduler_queue_wait_p95_ms,
    provider_latency_p95_ms: row.provider_latency_p95_ms,
    ocr_stage_global_capacity: row.ocr_stage_global_capacity,
    ocr_stage_capacity_wait_p95_ms: row.ocr_stage_capacity_wait_p95_ms,
    ocr_worker_timeout_count: row.ocr_worker_timeout_count,
    vector_runtime_unavailable_count: row.vector_runtime_unavailable_count,
    rejection_reasons: [...new Set(rejectionReasons)],
    warning_reasons: evaluated.warning_reasons
  };
}

export function assessCapacityReport(report = {}) {
  const recommended = numberOrNull(report.recommended_concurrency);
  const row = (Array.isArray(report.rows) ? report.rows : [])
    .find((item) => Number(item.concurrency) === recommended);
  const rejectionReasons = [];
  if (recommended === null) rejectionReasons.push("NO_RECOMMENDED_CONCURRENCY");
  if (!row) rejectionReasons.push("RECOMMENDED_CONCURRENCY_ROW_MISSING");
  if (row && row.stable !== true) rejectionReasons.push("RECOMMENDED_CONCURRENCY_NOT_STABLE");
  return {
    pass: rejectionReasons.length === 0,
    recommended_concurrency: recommended,
    recommendation_confidence: report.recommendation_confidence || null,
    completed_cards_per_minute: numberOrNull(row?.completed_cards_per_minute),
    writer_ready_p95_ms: numberOrNull(row?.writer_ready_p95_ms),
    rejection_reasons: rejectionReasons
  };
}

export function assessProductionBalance({
  accuracyReport = {},
  stabilityReport = {},
  capacityReport = {},
  accuracyTarget = 0.87,
  minimumStabilityCards = 50,
  maximumWriterP95Ms = 120_000,
  requireVectorRuntime = false,
  requireStabilityEnvelope = true
} = {}) {
  const accuracy = accuracyEvidence(accuracyReport);
  const accuracyPass = accuracy.eligible === true
    && accuracy.value !== null
    && accuracy.value >= accuracyTarget;
  const stability = assessStabilityReport(stabilityReport, {
    minimumCards: minimumStabilityCards,
    maximumWriterP95Ms,
    requireVectorRuntime,
    requireStabilityEnvelope
  });
  const capacity = assessCapacityReport(capacityReport);
  const rejectionReasons = [
    ...(!accuracy.eligible ? ["REVIEWED_ACCURACY_EVIDENCE_MISSING"] : []),
    ...(accuracy.eligible && !accuracyPass ? ["ACCURACY_BELOW_TARGET"] : []),
    ...stability.rejection_reasons,
    ...capacity.rejection_reasons
  ];
  return {
    schema_version: "v4-production-balance-assessment-v1",
    generated_at: new Date().toISOString(),
    pass: rejectionReasons.length === 0,
    targets: {
      accuracy: accuracyTarget,
      minimum_stability_cards: minimumStabilityCards,
      maximum_writer_p95_ms: maximumWriterP95Ms,
      require_vector_runtime: requireVectorRuntime,
      require_stability_envelope: requireStabilityEnvelope
    },
    accuracy: {
      ...accuracy,
      target: accuracyTarget,
      pass: accuracyPass
    },
    speed: {
      pass: stability.writer_ready_p95_ms !== null && stability.writer_ready_p95_ms <= maximumWriterP95Ms,
      completed_cards_per_minute: stability.completed_cards_per_minute,
      writer_ready_p50_ms: stability.writer_ready_p50_ms,
      writer_ready_p95_ms: stability.writer_ready_p95_ms,
      scheduler_queue_wait_p95_ms: stability.scheduler_queue_wait_p95_ms,
      provider_latency_p95_ms: stability.provider_latency_p95_ms
    },
    stability,
    capacity,
    rejection_reasons: [...new Set(rejectionReasons)]
  };
}

export async function main(argv = process.argv) {
  const accuracyPath = argValue(argv, "--accuracy", "");
  const stabilityPath = argValue(argv, "--stability", "");
  const capacityPath = argValue(argv, "--capacity", "");
  const outPath = argValue(argv, "--out", "");
  if (!accuracyPath || !stabilityPath || !capacityPath) {
    throw new Error("--accuracy, --stability, and --capacity are required");
  }
  const assessment = assessProductionBalance({
    accuracyReport: await readJson(accuracyPath),
    stabilityReport: await readJson(stabilityPath),
    capacityReport: await readJson(capacityPath),
    accuracyTarget: numberOrNull(argValue(argv, "--accuracy-target", "")) ?? 0.87,
    minimumStabilityCards: numberOrNull(argValue(argv, "--minimum-stability-cards", "")) ?? 50,
    maximumWriterP95Ms: numberOrNull(argValue(argv, "--maximum-writer-p95-ms", "")) ?? 120_000,
    requireVectorRuntime: hasFlag(argv, "--require-vector-runtime"),
    requireStabilityEnvelope: !hasFlag(argv, "--allow-single-wave-stability")
  });
  if (outPath) await writeJson(outPath, assessment);
  console.log(JSON.stringify(assessment, null, 2));
  return assessment.pass ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Production balance assessment failed: ${error.message}`);
    process.exitCode = 2;
  });
}
