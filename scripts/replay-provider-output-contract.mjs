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
import { normalizeFieldValue } from "../lib/identity-resolution/normalizer.mjs";
import { parsePrintRunValue } from "../lib/listing/print-run/print-run-fields.mjs";
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

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  const text = clean(value);
  return value !== null && value !== undefined && text !== "" && text.toUpperCase() !== "UNKNOWN";
}

function sourceForCandidate(candidate = {}) {
  const source = clean(candidate.source).toUpperCase();
  const trust = clean(candidate.source_trust).toUpperCase();
  if (source.includes("VECTOR")) return "VECTOR_APPROVED_REFERENCE";
  if (source.includes("OFFICIAL") || trust.includes("OFFICIAL")) return "OFFICIAL_CHECKLIST";
  if (source.includes("INTERNAL") || trust.includes("APPROVED_REFERENCE")) return "INTERNAL_APPROVED_HISTORY";
  if (source.includes("MARKETPLACE") || source.includes("EBAY")) return "MARKETPLACE";
  return "STRUCTURED_DATABASE";
}

function recordedCandidateApplication(result = {}, packet = {}) {
  const recorded = object(
    result.l2_candidate_debug?.retrieval_application
    || result.retrieval_application
    || packet?.replay_snapshot?.semantic_retrieval_application
  );
  const decisions = Array.isArray(recorded.decisions) ? recorded.decisions : [];
  const recordedContractPresent = typeof recorded.enabled === "boolean"
    && Array.isArray(recorded.decisions);
  const identityEvidenceItems = [];
  const seen = new Set();
  for (const action of decisions) {
    const applicationDecision = clean(action.decision || action.action).toUpperCase();
    const field = clean(action.resolver_field || action.field);
    const value = action.resolver_value ?? action.candidate_value ?? action.value;
    if (!["APPLY", "SUPPORT"].includes(applicationDecision) || !field || !present(value)) continue;
    const key = `${action.candidate_id || ""}:${field}:${JSON.stringify(value)}:${applicationDecision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    identityEvidenceItems.push({
      field,
      value,
      source: sourceForCandidate({
        source: action.source || action.source_type || action.candidate_lane,
        source_trust: action.source_trust
      }),
      confidence: Number.isFinite(Number(action.confidence))
        ? Number(action.confidence)
        : applicationDecision === "APPLY" ? 0.72 : 0.58,
      metadata: {
        candidate_id: action.candidate_id || null,
        candidate_identity_id: action.candidate_identity_id || null,
        candidate_lane: action.candidate_lane || null,
        permission: action.permission || null,
        retrieval_application_decision: applicationDecision,
        retrieval_application_reason: action.reason || null,
        candidate_is_evidence_not_truth: true,
        replayed_from_evaluation_trace: true
      }
    });
  }
  return {
    enabled: recorded.enabled === true || identityEvidenceItems.length > 0,
    // An explicitly disabled semantic application stage still owns the
    // candidate boundary: it means no legacy candidate path may bypass that
    // decision in replay.
    owns_candidate_application: recordedContractPresent || identityEvidenceItems.length > 0,
    selected_candidate_id: recorded.selected_candidate_id || null,
    identity_evidence_items: identityEvidenceItems
  };
}

function validPrintRunProjection(fields = {}) {
  const direct = fields.print_run_number;
  const composite = !present(direct)
    && present(fields.print_run_numerator)
    && present(fields.print_run_denominator)
    ? `${fields.print_run_numerator}/${fields.print_run_denominator}`
    : direct;
  const parsed = parsePrintRunValue(composite);
  if (!parsed.print_run_number) return {};
  return Object.fromEntries([
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator"
  ].filter((field) => present(parsed[field])).map((field) => [field, parsed[field]]));
}

export function projectReadOnlyProviderSnapshot(snapshot = {}) {
  // The output-contract experiment changes only the GPT transport. OCR,
  // focused rereads and other current-image observations remain available, so
  // replay must begin from the terminal observed snapshot rather than silently
  // deleting those independent sensor values.
  const observed = {
    ...object(snapshot.provider_fields),
    ...object(snapshot.observed_fields)
  };
  const observedReadFields = Object.fromEntries(Object.entries(observed)
    .map(([field, value]) => [field, normalizeFieldValue(field, value)])
    .filter(([field, value]) => readFields.has(field) && present(value)));
  const providerFieldEvidence = (Array.isArray(snapshot.provider_field_evidence)
    ? snapshot.provider_field_evidence
    : []).filter((item) => readFields.has(evidenceFieldName(item)));
  const recordedEvidence = object(snapshot.normalized_evidence);
  // Terminal normalized evidence also contains independent OCR/focused-reread
  // values that are intentionally absent from `observed_fields`.  Dropping
  // them makes replay incomparable with the deployed baseline (notably slab
  // grade and current-instance print run).  Only READ-owned, present values
  // may re-enter the replay input; DERIVED/DROP fields remain excluded.
  const recordedReadFields = Object.fromEntries(Object.entries(recordedEvidence)
    .map(([field, state]) => {
      const evidenceState = object(state);
      const rawValue = evidenceState.normalized_value ?? evidenceState.value;
      return [field, normalizeFieldValue(field, rawValue)];
    })
    .filter(([field, value]) => readFields.has(field) && present(value)));
  const unguardedProviderFields = {
    ...observedReadFields,
    ...recordedReadFields
  };
  const providerFields = {
    ...Object.fromEntries(Object.entries(unguardedProviderFields)
      .filter(([field]) => !["print_run_number", "print_run_numerator", "print_run_denominator"].includes(field))),
    ...validPrintRunProjection(unguardedProviderFields)
  };
  const normalizedEvidence = Object.fromEntries(Object.entries(providerFields).map(([field, value]) => [
    field,
    recordedEvidence[field] || {
      value,
      status: "REVIEW",
      sources: [{
        source_type: "VISION_MODEL",
        observed_text: Array.isArray(value) ? value.join(" / ") : String(value),
        source_inference_method: "evaluation_replay_observed_snapshot"
      }],
      candidates: [{ value, confidence: 0.65 }],
      confidence: 0.65,
      normalized_value: value
    }
  ]));
  return {
    fields: providerFields,
    field_evidence: providerFieldEvidence,
    normalized_evidence: normalizedEvidence,
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
    const strategyTitle = clean(result.strategy_replay_trace?.observed_output?.final_title);
    const terminalTitle = clean(result.final_title || result.title);
    const missingEffectiveSerialState = snapshot
      && !snapshot.effective_terminal_renderer_inputs
      && snapshot.renderer_inputs?.serial_numerator_verified == null
      && /#\s*\/\s*\d+/.test(terminalTitle)
      && !/#\s*\/\s*\d+/.test(strategyTitle);
    if (missingEffectiveSerialState) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "TRACE_MISSING_EFFECTIVE_SERIAL_PRESENTATION_STATE"
      });
      continue;
    }
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
    // Replay the real normalization boundary so canonical aliases such as
    // serial_number/numbered_to are deterministically rebuilt from the READ
    // print-run fields.  Keep the recorded current-image evidence on top so
    // direct OCR/slab provenance is not weakened by replay synthesis.
    const evidenceDocument = providerPayloadToEvidenceDocument({
      fields: projected.fields,
      field_evidence: projected.field_evidence,
      unresolved: projected.unresolved
    });
    const replayEvidence = {
      ...evidenceDocument.evidence,
      ...projected.normalized_evidence
    };
    const replayApplication = recordedCandidateApplication(result, packet);
    const base = {
      provider: "openai_legacy",
      source: "openai_legacy",
      fields: evidenceDocument.resolved,
      raw_provider_fields: projected.fields,
      raw_provider_field_evidence: projected.field_evidence,
      raw_observed_fields: evidenceDocument.resolved,
      evidence: replayEvidence,
      normalized_evidence: replayEvidence,
      resolved: evidenceDocument.resolved,
      resolved_fields: evidenceDocument.resolved,
      unresolved: evidenceDocument.unresolved,
      retrieval_application: replayApplication,
      recognition_status: "RESOLVED"
    };
    const candidateInput = attachForwardEnumerationCandidates(base, constraintModel, { shadow: false });
    const candidate = applyIdentityResolutionGate(candidateInput, {
      maxLength,
      providerId: "openai_legacy"
    });
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
