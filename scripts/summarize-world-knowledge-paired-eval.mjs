#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function mean(values = []) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function median(values = []) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function results(report = {}) {
  return Array.isArray(report.results) ? report.results : [];
}

function resolved(row = {}) {
  return row.l2_status?.resolved_fields || row.resolved_fields || row.resolved || {};
}

function summarizeArm(report = {}, { candidate = false } = {}) {
  const rows = results(report);
  const world = rows.map((row) => row.evaluation_decision_trace_packet?.world_knowledge_shadow_assist).filter(Boolean);
  const count = (field) => world.reduce((sum, item) => sum + Number(item?.[field] || 0), 0);
  return {
    cards: rows.length,
    complete: rows.filter((row) => row.ok === true && row.writer_ready === true && row.l2_ready === true).length,
    policy_fair_token_recall: mean(rows.map((row) => row.final_scoring?.policy_fair_token_recall)),
    provider_latency_p50_ms: median(rows.map((row) => row.provider_latency_ms)),
    writer_ready_p50_ms: median(rows.map((row) => row.time_to_writer_ready_ms)),
    provider_output_tokens_mean: mean(rows.map((row) => row.output_tokens ?? row.provider_output_tokens)),
    team_present: rows.filter((row) => cleanText(resolved(row).team)).length,
    product_present: rows.filter((row) => cleanText(resolved(row).product)).length,
    ...(candidate ? {
      world_knowledge_trace_coverage: `${world.length}/${rows.length}`,
      shadow_assist_requested: world.filter((item) => item.requested === true).length,
      shadow_assist_not_run: world.filter((item) => item.execution_status === "NOT_RUN").length,
      shadow_paid_provider_calls: count("paid_provider_calls")
    } : {})
  };
}

export function summarizeCohort(baseline = {}, candidate = {}) {
  const left = summarizeArm(baseline);
  const right = summarizeArm(candidate, { candidate: true });
  return {
    baseline: left,
    candidate: right,
    delta: {
      policy_fair_token_recall: right.policy_fair_token_recall === null || left.policy_fair_token_recall === null
        ? null
        : right.policy_fair_token_recall - left.policy_fair_token_recall,
      provider_latency_p50_ms: right.provider_latency_p50_ms === null || left.provider_latency_p50_ms === null
        ? null
        : right.provider_latency_p50_ms - left.provider_latency_p50_ms,
      team_present: right.team_present - left.team_present,
      product_present: right.product_present - left.product_present
    }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const familiarBaseline = JSON.parse(await readFile(resolve(argValue(argv, "--familiar-baseline")), "utf8"));
  const familiarCandidate = JSON.parse(await readFile(resolve(argValue(argv, "--familiar-candidate")), "utf8"));
  const unseenBaseline = JSON.parse(await readFile(resolve(argValue(argv, "--unseen-baseline")), "utf8"));
  const unseenCandidate = JSON.parse(await readFile(resolve(argValue(argv, "--unseen-candidate")), "utf8"));
  const summary = {
    schema_version: "world-knowledge-paired20-summary-v2",
    generated_at: new Date().toISOString(),
    unique_cards: 20,
    provider_calls_expected: 40,
    familiar: summarizeCohort(familiarBaseline, familiarCandidate),
    unseen: summarizeCohort(unseenBaseline, unseenCandidate)
  };
  const output = argValue(argv, "--out", "");
  if (output) await writeFile(resolve(output), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
