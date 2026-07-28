#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import { analyzeSemStageLoss } from "./analyze-sem-stage-loss.mjs";

const EXPECTED_COUNT = 20;
const FIELD_ALIASES = Object.freeze({
  year: ["year", "printed_year", "release_year", "season", "product_year", "title_year"],
  manufacturer: ["manufacturer", "brand"],
  product: ["product", "product_line"],
  set: ["set", "subset", "insert"],
  subject: ["subject", "player", "players", "character"],
  card_name: ["card_name", "official_card_type", "card_type", "insert"],
  card_number: ["card_number", "checklist_code", "collector_number"],
  descriptive_rarity: ["descriptive_rarity", "rarity"],
  numerical_rarity: ["numerical_rarity", "print_run_number", "serial_number"],
  release_variant: ["release_variant", "variation"],
  print_finish: ["print_finish", "product_finish", "parallel", "parallel_exact", "parallel_family", "surface_color"],
  special_stamp: ["special_stamp", "first_bowman"],
  search_optimization: [
    "search_optimization",
    "observable_components",
    "rc",
    "auto",
    "patch",
    "relic",
    "jersey",
    "sketch",
    "redemption",
    "team"
  ]
});

const DERIVED_SEM_FIELDS = new Set(["search_optimization", "special_stamp"]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function elapsed(start, end) {
  const startMs = Date.parse(String(start || ""));
  const endMs = Date.parse(String(end || ""));
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;
}

function reconstructedTimeline(result = {}) {
  const persisted = result.provider_capacity_timeline || {};
  const provider = result.provider_slot_timing || {};
  const providerStartedAt = persisted.provider_started_at || provider.started_at || null;
  const providerCompletedAt = persisted.provider_completed_at || provider.completed_at || null;
  const waitingProviderAt = persisted.waiting_provider_at || provider.queued_at || null;
  const capacityAcquiredAt = persisted.provider_capacity_acquired_at || null;
  const capacityReleasedAt = persisted.provider_capacity_released_at || null;
  return {
    provider_slot_held_before_provider_ms: finite(persisted.provider_slot_held_before_provider_ms)
      ?? elapsed(capacityAcquiredAt, providerStartedAt),
    prepared_waiting_for_provider_ms: finite(persisted.prepared_waiting_for_provider_ms)
      ?? elapsed(waitingProviderAt, providerStartedAt),
    provider_execution_ms: finite(persisted.provider_execution_ms)
      ?? finite(provider.execution_ms)
      ?? elapsed(providerStartedAt, providerCompletedAt),
    provider_slot_release_ms: finite(persisted.provider_slot_release_ms)
      ?? elapsed(providerCompletedAt, capacityReleasedAt)
  };
}

function percentile(values, ratio) {
  const rows = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!rows.length) return null;
  return rows[Math.min(rows.length - 1, Math.max(0, Math.ceil(rows.length * ratio) - 1))];
}

function packetFields(packet, pathName) {
  const value = pathName.split(".").reduce((current, key) => current?.[key], packet);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasAlias(fields, field) {
  return (FIELD_ALIASES[field] || [field]).some((alias) => Object.hasOwn(fields, alias));
}

function classifyMissing(row, packet) {
  // These SEM fields are assembled from several normalized observations. They
  // are not raw Provider contract fields, so absence of a same-named Provider
  // key must never be reported as a Provider observation miss.
  if (DERIVED_SEM_FIELDS.has(row.field)) return "DERIVED_SEM_NOT_EMITTED";
  const lineage = (Array.isArray(packet.field_lineage) ? packet.field_lineage : [])
    .find((entry) => entry?.field === row.field);
  if (lineage) {
    if (!Array.isArray(lineage.provider?.values) || lineage.provider.values.length === 0) return "PROVIDER_NOT_OBSERVED";
    if (!Array.isArray(lineage.normalization?.values) || lineage.normalization.values.length === 0) return "NORMALIZATION_DROPPED";
    return "CATALOG_NOT_RETRIEVED";
  }
  if (!hasAlias(packetFields(packet, "provider_observation_fields"), row.field)) return "PROVIDER_NOT_OBSERVED";
  if (!hasAlias(packetFields(packet, "normalization.output"), row.field)) return "NORMALIZATION_DROPPED";
  return "CATALOG_NOT_RETRIEVED";
}

function increment(counter = {}, key = "") {
  const normalized = String(key || "").trim() || "UNSPECIFIED";
  counter[normalized] = Number(counter[normalized] || 0) + 1;
}

function knowledgeFirstRouteAudit(results = []) {
  const routeCounts = {};
  const productionActionCounts = {};
  const visualTargetCounts = {};
  const knowledgeTargetCounts = {};
  const traced = [];
  for (const row of results) {
    const route = row.evaluation_decision_trace_packet?.knowledge_first_route;
    if (!route || typeof route !== "object" || Array.isArray(route)) continue;
    traced.push(route);
    increment(routeCounts, route.route);
    increment(productionActionCounts, route.production_action);
    for (const field of Array.isArray(route.visual_field_targets) ? route.visual_field_targets : []) {
      increment(visualTargetCounts, field);
    }
    for (const field of Array.isArray(route.knowledge_field_targets) ? route.knowledge_field_targets : []) {
      increment(knowledgeTargetCounts, field);
    }
  }
  const safetyViolations = traced.filter((route) => (
    route.production_effect !== "SHADOW_ONLY"
    || route.production_action !== "RUN_FULL_PROVIDER"
    || route.complete_title_output_allowed === true
    || Number(route.model_call_budget || 0) > 1
  ));
  return {
    trace_count: traced.length,
    route_counts: routeCounts,
    production_action_counts: productionActionCounts,
    zero_model_call_count: traced.filter((route) => Number(route.model_call_budget || 0) === 0).length,
    targeted_model_assist_count: traced.filter((route) => Number(route.model_call_budget || 0) === 1).length,
    visual_target_counts: visualTargetCounts,
    knowledge_target_counts: knowledgeTargetCounts,
    shadow_safety_violation_count: safetyViolations.length
  };
}

export function analyzeFixed20ColdBenchmark(report = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  const cacheViolations = results.filter((row) => row.identity_cache_hit === true
    || row.provider_call_skipped === true
    || Number(row.provider_calls) !== 1
    || row.recognition_benchmark_profile !== recognitionBenchmarkProfileIds.COLD_ALGORITHM);
  const traceRows = results.filter((row) => row.evaluation_decision_trace_packet?.trace_level === "evaluation");
  const knowledgeFirstRoute = knowledgeFirstRouteAudit(results);
  const timelineRows = results.map(reconstructedTimeline);
  const sem = analyzeSemStageLoss(report);
  const resultByJob = new Map(results.map((row) => [row.job_id, row]));
  const missingBreakdown = {};
  for (const row of sem.rows.filter((entry) => entry.classification === "EVIDENCE_OR_RETRIEVAL_MISSING")) {
    const category = classifyMissing(row, resultByJob.get(row.job_id)?.evaluation_decision_trace_packet || {});
    missingBreakdown[category] = (missingBreakdown[category] || 0) + 1;
  }
  const metric = (name) => timelineRows.map((row) => row[name]).map(finite).filter((value) => value !== null);
  const timing = Object.fromEntries([
    "provider_slot_held_before_provider_ms",
    "prepared_waiting_for_provider_ms",
    "provider_execution_ms",
    "provider_slot_release_ms"
  ].map((name) => {
    const values = metric(name);
    return [name, {
      measured_count: values.length,
      total_ms: values.reduce((sum, value) => sum + value, 0),
      p50_ms: percentile(values, 0.5),
      p95_ms: percentile(values, 0.95)
    }];
  }));
  const integrity = {
    exact_count: results.length === EXPECTED_COUNT,
    all_l2_ready: Number(report.summary?.l2_ready_count || 0) === EXPECTED_COUNT,
    zero_technical_failures: Number(report.summary?.technical_failure_count || 0) === 0
      && Number(report.summary?.ok_count || 0) === EXPECTED_COUNT,
    cold_cache_contract: cacheViolations.length === 0,
    evaluation_trace_coverage: traceRows.length === EXPECTED_COUNT,
    knowledge_first_route_trace_coverage: knowledgeFirstRoute.trace_count === EXPECTED_COUNT,
    knowledge_first_route_shadow_safe: knowledgeFirstRoute.shadow_safety_violation_count === 0
  };
  return {
    schema_version: "fixed20-cold-algorithm-audit-v2",
    generated_at: new Date().toISOString(),
    integrity,
    passed: Object.values(integrity).every(Boolean),
    cache_violation_count: cacheViolations.length,
    evaluation_trace_count: traceRows.length,
    provider_capacity_timeline_count: timelineRows.length,
    provider_capacity_timing: timing,
    knowledge_first_route: knowledgeFirstRoute,
    sem_stage_loss: {
      confirmed_field_count: sem.confirmed_field_count,
      preserved_field_count: sem.preserved_field_count,
      missing_field_count: sem.missing_field_count,
      preservation_rate: sem.preservation_rate,
      classification_counts: sem.classification_counts,
      evidence_or_retrieval_missing_breakdown: missingBreakdown
    },
    performance: {
      run_wall_ms: report.summary?.run_wall_ms ?? report.run_wall_ms ?? null,
      cards_per_minute: report.summary?.completed_cards_per_minute ?? report.summary?.cards_per_minute ?? null,
      writer_ready_p50_ms: report.summary?.writer_ready_p50_ms ?? null,
      writer_ready_p95_ms: report.summary?.writer_ready_p95_ms ?? null,
      writer_visible_recognition_p50_ms: report.summary?.writer_visible_recognition_p50_ms ?? null,
      writer_visible_recognition_p95_ms: report.summary?.writer_visible_recognition_p95_ms ?? null,
      provider_latency_p50_ms: report.summary?.provider_diagnostics?.provider_latency_p50_ms ?? null,
      provider_latency_p95_ms: report.summary?.provider_diagnostics?.provider_latency_p95_ms ?? null
    },
    accuracy: report.summary?.final_accuracy_proxy || null
  };
}

async function main(argv = process.argv.slice(2)) {
  const [inputPath, outputPath] = argv;
  if (!inputPath) throw new Error("Usage: analyze-fixed20-cold-benchmark.mjs <report.json> [output.json]");
  const report = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const analysis = analyzeFixed20ColdBenchmark(report);
  const serialized = `${JSON.stringify(analysis, null, 2)}\n`;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, serialized);
  } else process.stdout.write(serialized);
  if (!analysis.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
