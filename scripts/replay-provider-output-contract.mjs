#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { attachForwardEnumerationCandidates } from "../lib/listing/catalog/forward-enumeration-adapter.mjs";
import { loadConstraintModelSnapshot } from "../lib/listing/catalog/constraint-model-store.mjs";
import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import {
  providerFieldsByClass,
  providerOutputFieldClass
} from "../lib/listing/providers/provider-output-field-contract.mjs";
import { scoreReviewedTitleSemProjection } from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";
import {
  applyIdentityResolutionGate,
  identityResolverPolicyVersion
} from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

const readFields = new Set(providerFieldsByClass(providerOutputFieldClass.READ));

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function referenceTitle(result = {}) {
  return clean(
    result.corrected_title_reference
    || result.corrected_title
    || result.reference_title
    || result.seller_title
  );
}

function evidenceFieldName(item = {}) {
  return clean(item.field || item.f);
}

export function projectReadOnlyProviderSnapshot(snapshot = {}) {
  const providerFields = Object.fromEntries(Object.entries(object(snapshot.provider_fields))
    .filter(([field, value]) => readFields.has(field) && value !== null && value !== undefined && value !== ""));
  const providerFieldEvidence = (Array.isArray(snapshot.provider_field_evidence)
    ? snapshot.provider_field_evidence
    : []).filter((item) => readFields.has(evidenceFieldName(item)));
  return {
    fields: providerFields,
    field_evidence: providerFieldEvidence,
    unresolved: []
  };
}

export async function replayProviderOutputContract(report = {}, {
  model = null,
  maxLength = 80
} = {}) {
  const constraintModel = model || await loadConstraintModelSnapshot();
  const results = Array.isArray(report.results) ? report.results : [];
  const rows = [];

  for (const result of results) {
    const packet = result.evaluation_decision_trace_packet;
    const snapshot = packet?.replay_snapshot;
    const repairableMissing = snapshot?.status === "PARTIAL"
      && Array.isArray(snapshot.missing_components)
      && snapshot.missing_components.length === 1
      && snapshot.missing_components[0] === "resolver_version";
    if (!snapshot || (snapshot.status !== "COMPLETE" && !repairableMissing)) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: snapshot ? `SNAPSHOT_${snapshot.status || "PARTIAL"}` : "SNAPSHOT_ABSENT"
      });
      continue;
    }

    const projected = projectReadOnlyProviderSnapshot(snapshot);
    const evidenceDocument = providerPayloadToEvidenceDocument(projected);
    const base = {
      provider: "openai_legacy",
      source: "openai_legacy",
      fields: projected.fields,
      raw_provider_fields: projected.fields,
      raw_provider_field_evidence: projected.field_evidence,
      raw_observed_fields: evidenceDocument.resolved,
      evidence: evidenceDocument.evidence,
      normalized_evidence: evidenceDocument.evidence,
      resolved: evidenceDocument.resolved,
      resolved_fields: evidenceDocument.resolved,
      unresolved: evidenceDocument.unresolved,
      recognition_status: "RESOLVED"
    };
    const candidateInput = attachForwardEnumerationCandidates(base, constraintModel, { shadow: false });
    const candidate = applyIdentityResolutionGate(candidateInput, {
      maxLength,
      providerId: "openai_legacy"
    });
    const terminalTitle = clean(result.final_title || result.title);
    const snapshotTitle = clean(snapshot.final_title);
    const baselineTitle = terminalTitle || snapshotTitle;
    const candidateTitle = clean(candidate.final_title || candidate.title);
    const reference = referenceTitle(result);
    const baselineRecall = reference ? policyFairTokenRecall(reference, baselineTitle) : null;
    const candidateRecall = reference ? policyFairTokenRecall(reference, candidateTitle) : null;
    const baselineSem = reference
      ? scoreReviewedTitleSemProjection({ referenceTitle: reference, finalTitle: baselineTitle })
      : null;
    const candidateSem = reference
      ? scoreReviewedTitleSemProjection({ referenceTitle: reference, finalTitle: candidateTitle })
      : null;
    const derived = candidate.forward_enumeration_trace || [];
    const scoreRegression = Number.isFinite(baselineRecall) && Number.isFinite(candidateRecall)
      ? candidateRecall + 1e-9 < baselineRecall
      : false;
    const semRegression = baselineSem && candidateSem
      ? candidateSem.weighted_accuracy + 1e-9 < baselineSem.weighted_accuracy
        || candidateSem.required_acceptance_failures > baselineSem.required_acceptance_failures
      : false;
    rows.push({
      asset_id: result.asset_id || null,
      replayable: true,
      replay_snapshot_status: repairableMissing ? "REPAIRED" : "COMPLETE",
      replay_snapshot_repaired_components: repairableMissing ? [{
        component: "resolver_version",
        value: identityResolverPolicyVersion,
        reason: "exact deployed source revision has a canonical static resolver owner version"
      }] : [],
      baseline_title: baselineTitle,
      replay_snapshot_title: snapshotTitle || null,
      replay_snapshot_terminal_title_match: Boolean(snapshotTitle && baselineTitle === snapshotTitle),
      candidate_title: candidateTitle,
      title_changed: baselineTitle !== candidateTitle,
      reference_title: reference || null,
      baseline_policy_fair_token_recall: baselineRecall,
      candidate_policy_fair_token_recall: candidateRecall,
      baseline_sem_weighted_accuracy: baselineSem?.weighted_accuracy ?? null,
      candidate_sem_weighted_accuracy: candidateSem?.weighted_accuracy ?? null,
      baseline_sem_required_acceptance_failures: baselineSem?.required_acceptance_failures ?? null,
      candidate_sem_required_acceptance_failures: candidateSem?.required_acceptance_failures ?? null,
      contract_regression: scoreRegression || semRegression,
      forward_value_fields: derived.filter((item) => item.status === "VALUE").map((item) => item.field),
      forward_unknown_fields: derived.filter((item) => item.status === "UNKNOWN").map((item) => item.field),
      derived_values_applied: (candidate.retrieval_application?.actual_applied_fields || []).slice()
    });
  }

  const replayable = rows.filter((row) => row.replayable);
  const scored = replayable.filter((row) => Number.isFinite(row.baseline_policy_fair_token_recall));
  const average = (values) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
    : null;
  return {
    schema_version: "provider-output-contract-replay-v1",
    result_count: results.length,
    replayable_count: replayable.length,
    incomplete_snapshot_count: results.length - replayable.length,
    scored_count: scored.length,
    title_changed_count: replayable.filter((row) => row.title_changed).length,
    contract_regression_count: replayable.filter((row) => row.contract_regression).length,
    forward_value_count: replayable.reduce((sum, row) => sum + row.forward_value_fields.length, 0),
    derived_application_count: replayable.reduce((sum, row) => sum + row.derived_values_applied.length, 0),
    baseline_policy_fair_token_recall: average(scored.map((row) => row.baseline_policy_fair_token_recall)),
    candidate_policy_fair_token_recall: average(scored.map((row) => row.candidate_policy_fair_token_recall)),
    gate_passed: results.length > 0
      && replayable.length === results.length
      && replayable.every((row) => row.contract_regression === false),
    rows
  };
}

export async function main(argv = process.argv) {
  const inputPath = argValue(argv, "--input");
  if (!inputPath) throw new Error("--input is required");
  const outputPath = argValue(argv, "--out");
  const maxLength = Math.max(1, Number(argValue(argv, "--max-length", "80")) || 80);
  const report = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const replay = await replayProviderOutputContract(report, { maxLength });
  if (outputPath) {
    const resolved = resolve(outputPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  }
  process.stdout.write([
    `provider contract replay: ${replay.replayable_count}/${replay.result_count} replayable`,
    `policy recall: ${replay.baseline_policy_fair_token_recall} -> ${replay.candidate_policy_fair_token_recall}`,
    `title changed=${replay.title_changed_count} regressions=${replay.contract_regression_count}`,
    `forward values=${replay.forward_value_count} applied=${replay.derived_application_count}`,
    `gate=${replay.gate_passed}`
  ].join("\n") + "\n");
  return replay.gate_passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
