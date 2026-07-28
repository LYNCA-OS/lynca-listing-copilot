#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  providerAuxRouteReplayInputHash,
  providerAuxRoutes
} from "../lib/listing/v4/route-planner/provider-aux-route-shadow.mjs";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function increment(counter, key) {
  const normalized = String(key || "UNKNOWN").trim() || "UNKNOWN";
  counter[normalized] = Number(counter[normalized] || 0) + 1;
}

function before(left, right) {
  const leftMs = Date.parse(String(left || ""));
  const rightMs = Date.parse(String(right || ""));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) ? leftMs < rightMs : null;
}

function hasExplicit(objectValue, field) {
  return Object.hasOwn(object(objectValue), field);
}

function legacyEmptyPreproviderReplay(row = {}) {
  const trace = object(row.evaluation_decision_trace_packet);
  const preflight = object(trace.recognition_preflight);
  const exactAnchor = object(row.exact_anchor_fast_final_shadow);
  const rendezvous = object(row.preingestion_ocr_rendezvous);
  const anchors = row.preingestion_retrieval_anchor_fields;
  const usableImageObserved = Number(row.image_count || 0) > 0
    || (
      Boolean(String(row.asset_id || "").trim())
      && Number(providerCalls(row) || 0) > 0
      && String(row.response_status || row.provider_diagnostics?.response_status || "").toLowerCase() === "completed"
    );
  const hasRequiredShape = hasExplicit(exactAnchor, "eligible")
    && hasExplicit(rendezvous, "patch_count")
    && Array.isArray(anchors)
    && hasExplicit(preflight, "worker_finished_before_provider")
    && hasExplicit(preflight, "evidence_field_count");
  if (!hasRequiredShape || !usableImageObserved) return null;
  if (exactAnchor.eligible === true
    || Number(rendezvous.patch_count) !== 0
    || anchors.length !== 0
    || Number(row.pre_l2_anchor_patch_count || 0) !== 0) return null;
  // A Worker that had not finished at the cutoff contributes no route input.
  // If it had finished, the old packet is reconstructable only when it
  // explicitly produced zero evidence fields.
  if (preflight.worker_finished_before_provider === true
    && Number(preflight.evidence_field_count) !== 0) return null;
  return {
    route: providerAuxRoutes.TARGETED_MODEL_ASSIST,
    input_class: "NOVEL_IMAGE",
    evidence_class: "OFFLINE_REPLAY_EMPTY_WITH_FROZEN_CONSTRAINT",
    trace_admissible_for_activation: false,
    reason_codes: [
      "NO_PREPROVIDER_PUBLISHABLE_EVIDENCE",
      "TARGET_FIELDS_REPLAYED_FROM_EMPTY_SNAPSHOT",
      "LEGACY_ROUTE_TIMESTAMP_MISSING"
    ]
  };
}

function nativeRoute(row = {}) {
  const route = object(row.evaluation_decision_trace_packet?.provider_aux_route);
  if (!route.schema_version || !route.route_input_hash) return null;
  const providerStartedAt = row.provider_capacity_timeline?.provider_started_at
    || row.provider_slot_timing?.started_at
    || null;
  const frozenBeforeProvider = before(route.route_decided_at, providerStartedAt);
  const replayInputHashMatches = route.replay_input
    ? providerAuxRouteReplayInputHash(route.replay_input) === route.preprovider_snapshot_hash
    : false;
  const admissible = route.trace_completeness === "COMPLETE"
    && route.source_availability === "COMPLETE"
    && replayInputHashMatches
    && frozenBeforeProvider === true
    && Number(route.provider_derived_field_count || 0) === 0
    && Number(route.post_cutoff_evidence_count || 0) === 0;
  return {
    ...route,
    evidence_class: "NATIVE_FROZEN_PREPROVIDER_TRACE",
    decision_frozen_before_provider: frozenBeforeProvider,
    replay_input_hash_matches: replayInputHashMatches,
    trace_admissible_for_activation: admissible
  };
}

function providerWorkMs(row = {}) {
  return finite(row.provider_capacity_timeline?.provider_execution_ms)
    ?? finite(row.provider_slot_timing?.execution_ms)
    ?? finite(row.provider_latency_ms);
}

function providerCalls(row = {}) {
  return finite(row.provider_calls)
    ?? finite(row.evaluation_decision_trace_packet?.provider_aux_route?.observed_provider_calls)
    ?? null;
}

function rate(count, total) {
  return total ? count / total : null;
}

export function analyzeProviderAuxRouteShadow(report = {}) {
  const rows = array(report.results);
  const decisions = rows.map((row) => {
    const native = nativeRoute(row);
    if (native) return { row, decision: native, source: "NATIVE" };
    const legacy = legacyEmptyPreproviderReplay(row);
    if (legacy) return { row, decision: legacy, source: "LEGACY_EMPTY_REPLAY" };
    return {
      row,
      source: "UNKNOWN",
      decision: {
        route: null,
        input_class: "UNKNOWN",
        evidence_class: "UNKNOWN_NOT_RECONSTRUCTABLE",
        trace_admissible_for_activation: false,
        reason_codes: ["FROZEN_PREPROVIDER_INPUT_NOT_AVAILABLE"]
      }
    };
  });
  const novel = decisions.filter(({ decision }) => decision.input_class !== "EXACT_REPLAY");
  const laneCounts = {};
  const evidenceClassCounts = {};
  const productionActionCounts = {};
  for (const { row, decision } of novel) {
    increment(laneCounts, decision.route);
    increment(evidenceClassCounts, decision.evidence_class);
    const calls = providerCalls(row);
    increment(productionActionCounts, calls === null ? "UNKNOWN" : calls > 0 ? "RUN_FULL_PROVIDER" : "RETURN_WITHOUT_PROVIDER");
  }

  const countLane = (lane) => novel.filter(({ decision }) => decision.route === lane).length;
  const fastCount = countLane(providerAuxRoutes.FAST_DETERMINISTIC);
  const targetedCount = countLane(providerAuxRoutes.TARGETED_MODEL_ASSIST);
  const fallbackCount = countLane(providerAuxRoutes.FULL_PROVIDER_FALLBACK);
  const unknownCount = novel.filter(({ decision }) => !decision.route).length;
  const nativeCount = decisions.filter(({ source }) => source === "NATIVE").length;
  const admissibleNativeCount = decisions.filter(({ source, decision }) => (
    source === "NATIVE" && decision.trace_admissible_for_activation === true
  )).length;
  const targetedExecutorEvaluatedCount = decisions.filter(({ decision }) => (
    decision.route === providerAuxRoutes.TARGETED_MODEL_ASSIST
    && decision.targeted_executor_status
    && decision.targeted_executor_status !== "NOT_IMPLEMENTED"
  )).length;
  const fullProviderRows = novel.filter(({ row }) => Number(providerCalls(row) || 0) > 0);
  const measuredWorkRows = fullProviderRows
    .map(({ row }) => providerWorkMs(row))
    .filter((value) => value !== null);
  const targetedBaselineRows = novel.filter(({ decision }) => (
    decision.route === providerAuxRoutes.TARGETED_MODEL_ASSIST
  ));
  const targetedGrossWork = targetedBaselineRows
    .map(({ row }) => providerWorkMs(row))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const targetedGrossTokens = targetedBaselineRows
    .map(({ row }) => finite(row.total_tokens))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const allNativeAdmissible = nativeCount === rows.length && admissibleNativeCount === rows.length;

  return {
    schema_version: "provider-aux-route-shadow-audit-v1",
    generated_at: new Date().toISOString(),
    sample_count: rows.length,
    novel_image_count: novel.length,
    exact_replay_count: decisions.length - novel.length,
    trace: {
      native_frozen_trace_count: nativeCount,
      native_activation_admissible_count: admissibleNativeCount,
      legacy_empty_replay_count: decisions.filter(({ source }) => source === "LEGACY_EMPTY_REPLAY").length,
      unknown_not_reconstructable_count: decisions.filter(({ source }) => source === "UNKNOWN").length,
      evidence_class_counts: evidenceClassCounts,
      preprovider_route_trace_coverage: rate(nativeCount, rows.length)
    },
    lanes: {
      counts: laneCounts,
      rates: {
        FAST_DETERMINISTIC: rate(fastCount, novel.length),
        TARGETED_MODEL_ASSIST: rate(targetedCount, novel.length),
        FULL_PROVIDER_FALLBACK: rate(fallbackCount, novel.length),
        UNKNOWN: rate(unknownCount, novel.length)
      },
      final_full_provider_fallback_lower_bound: fallbackCount,
      final_full_provider_fallback_upper_bound: fallbackCount + targetedCount + unknownCount,
      targeted_safe_success_measured_count: 0
    },
    observed_production: {
      action_counts: productionActionCounts,
      full_provider_call_count: fullProviderRows.reduce((sum, { row }) => sum + Number(providerCalls(row) || 0), 0),
      measured_provider_work_count: measuredWorkRows.length,
      measured_provider_work_ms: measuredWorkRows.reduce((sum, value) => sum + value, 0),
      total_tokens: fullProviderRows
        .map(({ row }) => finite(row.total_tokens))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0)
    },
    counterfactual_cost_boundary: {
      targeted_full_provider_work_gross_ceiling_ms: targetedGrossWork,
      targeted_full_provider_tokens_gross_ceiling: targetedGrossTokens,
      targeted_model_work_measured: false,
      targeted_model_tokens_measured: false,
      proven_net_provider_work_saving_ms: 0,
      proven_net_token_saving: 0,
      note: "Gross ceiling is baseline work assigned to targeted substitution, not proven saving."
    },
    activation_gate: {
      eligible: false,
      native_frozen_trace_complete: allNativeAdmissible,
      targeted_executor_evaluated_count: targetedExecutorEvaluatedCount,
      targeted_accuracy_non_regression_proven: false,
      targeted_latency_improvement_proven: false,
      production_title_change_allowed: false,
      blockers: [
        ...(!allNativeAdmissible ? ["FROZEN_PREPROVIDER_TRACE_INCOMPLETE"] : []),
        ...(targetedCount > 0 && targetedExecutorEvaluatedCount === 0 ? ["TARGETED_EXECUTOR_NOT_EVALUATED"] : []),
        ...(unknownCount > 0 ? ["UNKNOWN_ROUTE_INPUTS"] : []),
        "ACCURACY_NON_REGRESSION_UNPROVEN",
        "LATENCY_IMPROVEMENT_UNPROVEN",
        "SHADOW_ONLY"
      ]
    },
    decisions: decisions.map(({ row, decision, source }) => ({
      job_id: row.job_id || null,
      source,
      route: decision.route,
      input_class: decision.input_class,
      evidence_class: decision.evidence_class,
      trace_admissible_for_activation: decision.trace_admissible_for_activation,
      reason_codes: array(decision.reason_codes)
    }))
  };
}

async function main(argv = process.argv.slice(2)) {
  const [inputPath, outputPath] = argv;
  if (!inputPath) throw new Error("Usage: analyze-provider-aux-route-shadow.mjs <report.json> [output.json]");
  const report = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const analysis = analyzeProviderAuxRouteShadow(report);
  const serialized = `${JSON.stringify(analysis, null, 2)}\n`;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, serialized);
  } else process.stdout.write(serialized);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
