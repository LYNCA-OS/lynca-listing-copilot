import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";
import { buildV4ResolvedFields } from "../lib/listing/v4/evidence/field-evidence.mjs";
import { scoreReviewedTitleSemProjection } from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";
import { buildRetrievalApplicationReplay } from "../lib/listing/evaluation/retrieval-application-replay.mjs";
import { normalizeFields } from "../lib/listing/pipeline/field-normalization.mjs";
import { extractParallelFamily } from "../lib/listing/parallel-policy.mjs";
import { fairTokenRecall, policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

// Offline replay harness: re-render every card of a recorded cloud eval
// through the CURRENT deterministic renderer (resolved_fields + evidence)
// and compare against the recorded titles. Zero API cost - validates
// renderer/policy changes before any paid cloud run.
//
// Usage:
//   node scripts/replay-render-from-eval.mjs --input <cloud-eval.json> [--max-length 80] [--out <report.json>]

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function legacyTokens(value) {
  return new Set(normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean));
}

function legacyRecall(referenceTitle, predictionTitle) {
  const reference = legacyTokens(referenceTitle);
  if (!reference.size) return null;
  const predicted = legacyTokens(predictionTitle);
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function referenceTitleForResult(result = {}) {
  return normalizeText(
    result.corrected_title_reference
    || result.corrected_title
    || result.reference_title
    || result.seller_title
    || ""
  );
}

const replaySafeBaseColors = new Set([
  "black", "blue", "bronze", "gold", "green", "orange",
  "pink", "purple", "red", "silver", "white", "yellow"
]);

function fieldFlowRawValues(result = {}, fieldGroup = "") {
  const fields = result?.pipeline_node_ledger?.field_flow?.fields;
  if (!Array.isArray(fields)) return [];
  const row = fields.find((item) => item?.field_group === fieldGroup);
  return Array.isArray(row?.raw_values) ? row.raw_values.map(normalizeText).filter(Boolean) : [];
}

function replaySafeSurfaceColor(result = {}) {
  const values = fieldFlowRawValues(result, "surface_color")
    .map((value) => value.toLowerCase());
  const colors = [...new Set(values.filter((value) => replaySafeBaseColors.has(value)))];
  if (colors.length !== 1) return null;
  return colors[0][0].toUpperCase() + colors[0].slice(1);
}

function replayResolvedFields(result = {}) {
  const rendered = result.rendered_fields && typeof result.rendered_fields === "object" && !Array.isArray(result.rendered_fields)
    ? result.rendered_fields
    : {};
  const renderedFields = rendered.fields && typeof rendered.fields === "object" && !Array.isArray(rendered.fields)
    ? rendered.fields
    : {};
  const resolved = result.resolved_fields || result.resolved || {};
  const merged = {
    ...resolved,
    ...renderedFields
  };
  // rendered_fields snapshot the POST-render state: when the old renderer
  // stripped an unverified numerator, these keys were persisted already
  // nulled. Replaying a numerator-policy change requires the resolver-stage
  // values, so print-run lineage keys always come from resolved_fields.
  for (const field of [
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator",
    "serial_number",
    "serial_denominator",
    "numerical_rarity",
    "numbered_to",
    "expected_serial_denominator"
  ]) {
    const value = resolved[field];
    if (value !== null && value !== undefined && value !== "") merged[field] = value;
  }
  if (!normalizeText(merged.surface_color)) {
    const safeColor = replaySafeSurfaceColor(result);
    if (safeColor) merged.surface_color = safeColor;
  }
  // The field-flow ledger persists the provider's RAW surface/parallel phrase
  // ("Blue Sparkle Refractor") even when normalization narrowed it to a bare
  // color. Recover the curated optical finish half exactly like the runtime
  // normalizer does, so renderer/normalizer changes to finish handling are
  // measurable offline.
  if (!normalizeText(merged.parallel_family)) {
    const rawFinishPhrases = [
      ...fieldFlowRawValues(result, "surface_color"),
      ...fieldFlowRawValues(result, "parallel_exact")
    ];
    const family = extractParallelFamily(...rawFinishPhrases);
    if (family) merged.parallel_family = family;
  }
  const observation = result.candidate_observation_snapshot
    || result.l2_candidate_debug?.candidate_observation_snapshot
    || {};
  // Mirror the runtime's draft-only current-image fallback. Offline replay
  // must not understate a change merely because the persisted public result
  // omits the pre-retrieval observation snapshot.
  for (const field of ["year", "manufacturer", "brand", "product", "set", "players", "character", "card_name", "surface_color"]) {
    const current = merged[field];
    const missing = current === null || current === undefined || current === ""
      || Array.isArray(current) && current.length === 0;
    if (missing && observation[field] !== null && observation[field] !== undefined && observation[field] !== "") {
      merged[field] = observation[field];
    }
  }
  if ((!Array.isArray(merged.players) || !merged.players.length) && observation.player) {
    merged.players = [observation.player];
  }
  // Older persisted public results can predate the renderer fix that retains
  // a selected catalog APPLY decision. Rehydrate only explicit deterministic
  // APPLY rows; SUPPORT/REJECT/BLOCK rows remain non-mutating.
  const applicationDecisions = result.retrieval_application?.decisions
    || result.l2_candidate_debug?.retrieval_application?.decisions
    || [];
  for (const decision of applicationDecisions) {
    if (decision?.decision !== "APPLY") continue;
    const field = decision.resolver_field || decision.field;
    if (!field) continue;
    const value = decision.final_value ?? decision.candidate_value;
    if (value !== null && value !== undefined && value !== "") merged[field] = value;
  }
  // Re-run the canonical V4 boundary as well as the renderer. This preserves
  // current-image subjects that were deliberately routed to writer review in
  // older artifacts instead of mistaking review highlighting for deletion.
  const normalizedMerged = normalizeFields(merged);
  return buildV4ResolvedFields({
    ...result,
    resolved: normalizedMerged,
    resolved_fields: normalizedMerged,
    rendered_fields: {
      ...rendered,
      fields: normalizedMerged
    },
    candidate_observation_snapshot: observation
  });
}

function persistedCurrentSourceCatalogContext(result = {}) {
  const debug = result.l2_candidate_debug || {};
  const traces = Array.isArray(debug.candidate_application_trace)
    ? debug.candidate_application_trace
    : [];
  const decisions = Array.isArray(debug.retrieval_application?.decisions)
    ? debug.retrieval_application.decisions
    : [];
  const candidates = traces.filter((trace) => (
    trace?.candidate_lane === "catalog"
    && trace?.anchor_agreement?.authoritative_overrides?.includes("reviewed_current_source_identity_match")
  )).map((trace) => {
    const fields = Object.fromEntries(decisions
      .filter((row) => row?.candidate_id === trace.candidate_id && row?.field && row?.candidate_value !== undefined)
      .map((row) => [row.field, row.candidate_value]));
    return {
      candidate_id: trace.candidate_id,
      candidate_identity_id: trace.candidate_identity_id,
      source_feedback_id: result.source_feedback_id,
      source_type: trace.source_type,
      source_trust: trace.source_trust,
      provider_id: "catalog",
      fields,
      anchor_agreement: trace.anchor_agreement,
      reference_metadata: {
        source_feedback_id: result.source_feedback_id,
        corrected_title_is_reviewed_title_ground_truth: true,
        prompt_safe_internal_writer_title: true
      }
    };
  });
  if (!candidates.length) return null;
  return {
    packet: {
      vector_retrieval: {
        candidates,
        field_support: [],
        assist_filter: {
          raw_candidate_count: candidates.length,
          approved_candidate_count: candidates.length,
          prompt_candidate_count: 0,
          prompt_candidate_ids: []
        }
      }
    },
    retrieval_phase: "provider_observation_catalog_replay"
  };
}

async function replayCurrentSourceCatalogDecision(result = {}, maxLength = 80) {
  const catalogContext = persistedCurrentSourceCatalogContext(result);
  if (!catalogContext) return null;
  const replay = await buildRetrievalApplicationReplay({
    result,
    catalogContext,
    vectorContext: {},
    maxLength
  });
  const projection = replay.arms?.on?.semantic_projection || null;
  if (!projection) return null;
  const appliedFields = new Set(projection.retrieval_application?.actual_applied_fields || []);
  return {
    applied_fields: [...appliedFields],
    overlay: Object.fromEntries(Object.entries(projection.resolved_fields || {})
      .filter(([field]) => appliedFields.has(field)))
  };
}

export async function replayRenderFromEval({
  inputPath,
  maxLength = 80,
  scope = "all"
} = {}) {
  const report = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const allResults = Array.isArray(report.results) ? report.results : [];
  const results = scope === "internal-reviewed"
    ? allResults.filter((result) => result?.reference_title_is_reviewed_ground_truth === true
      && normalizeText(result?.reference_title_type).toUpperCase() === "REVIEWED_INTERNAL_TITLE")
    : allResults;
  const rows = [];
  let recordedFairSum = 0;
  let replayedFairSum = 0;
  let recordedPolicyFairSum = 0;
  let replayedPolicyFairSum = 0;
  let recordedSemSum = 0;
  let replayedSemSum = 0;
  let scored = 0;
  let up = 0;
  let down = 0;
  let assistPreserved = 0;

  for (const result of results) {
    const reference = referenceTitleForResult(result);
    const recorded = normalizeText(result.title || result.final_title || "");
    const titleRenderSource = result.rendered_fields?.title_render_source
      || result.title_render_source
      || "";
    // Assist-lane titles are produced outside the plain deterministic render;
    // replay preserves them so the harness only measures renderer changes.
    const preserveRecorded = titleRenderSource === "safe_retrieval_title_assist";
    const decisionReplay = preserveRecorded ? null : await replayCurrentSourceCatalogDecision(result, maxLength);
    // Mirror the runtime's serial-numerator contract: OCR verification is
    // tri-state, and absence of an OCR reading is null (unknown), never a
    // veto. Recorded `false` values predate that contract and came from
    // no-read runs, so they replay as null; the renderer's provenance gate
    // still governs what actually prints.
    const replaySerialNumeratorVerified = result.serial_numerator_verified === true ? true : null;
    const replayed = preserveRecorded
      ? recorded
      : normalizeText(renderListingPresentation({
        resolved: {
          ...replayResolvedFields(result),
          ...(decisionReplay?.overlay || {})
        },
        evidence: result.normalized_evidence || result.evidence || {},
        serialNumeratorVerified: replaySerialNumeratorVerified,
        maxLength
      }).final_title || "");
    if (preserveRecorded) assistPreserved += 1;
    if (!reference) {
      rows.push({
        asset_id: result.asset_id || null,
        candidate_id: result.candidate_id || null,
        scored: false,
        recorded_title: recorded,
        replayed_title: replayed,
        title_render_source: titleRenderSource
      });
      continue;
    }
    const recordedFair = fairTokenRecall(reference, recorded);
    const replayedFair = fairTokenRecall(reference, replayed);
    const recordedPolicyFair = policyFairTokenRecall(reference, recorded);
    const replayedPolicyFair = policyFairTokenRecall(reference, replayed);
    const recordedSem = scoreReviewedTitleSemProjection({ referenceTitle: reference, finalTitle: recorded });
    const replayedSem = scoreReviewedTitleSemProjection({ referenceTitle: reference, finalTitle: replayed });
    recordedFairSum += recordedFair || 0;
    replayedFairSum += replayedFair || 0;
    recordedPolicyFairSum += recordedPolicyFair || 0;
    replayedPolicyFairSum += replayedPolicyFair || 0;
    recordedSemSum += recordedSem.weighted_accuracy || 0;
    replayedSemSum += replayedSem.weighted_accuracy || 0;
    scored += 1;
    if (replayedFair > recordedFair + 1e-9) up += 1;
    else if (replayedFair < recordedFair - 1e-9) down += 1;
    rows.push({
      asset_id: result.asset_id || null,
      candidate_id: result.candidate_id || null,
      scored: true,
      reference_title: reference,
      recorded_title: recorded,
      replayed_title: replayed,
      title_render_source: titleRenderSource,
      recorded_legacy_recall: legacyRecall(reference, recorded),
      recorded_fair_recall: recordedFair,
      replayed_fair_recall: replayedFair,
      recorded_policy_fair_recall: recordedPolicyFair,
      replayed_policy_fair_recall: replayedPolicyFair,
      recorded_sem_weighted_accuracy: recordedSem.weighted_accuracy,
      replayed_sem_weighted_accuracy: replayedSem.weighted_accuracy,
      recorded_sem_required_acceptance_failures: recordedSem.required_acceptance_failures,
      replayed_sem_required_acceptance_failures: replayedSem.required_acceptance_failures,
      replayed_sem_components: replayedSem.components,
      delta: Number(((replayedFair || 0) - (recordedFair || 0)).toFixed(6))
    });
  }

  const passAt = (threshold, key) => rows.filter((row) => row.scored && Number(row[key]) >= threshold).length;

  return {
    schema_version: "replay-render-from-eval-v2",
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    scope,
    max_length: maxLength,
    result_count: results.length,
    scored_count: scored,
    assist_titles_preserved: assistPreserved,
    recorded: {
      fair_avg: scored ? Number((recordedFairSum / scored).toFixed(6)) : null,
      fair_pass_at_0_72: passAt(0.72, "recorded_fair_recall"),
      fair_pass_at_0_80: passAt(0.80, "recorded_fair_recall"),
      policy_fair_avg: scored ? Number((recordedPolicyFairSum / scored).toFixed(6)) : null,
      policy_fair_pass_at_0_72: passAt(0.72, "recorded_policy_fair_recall"),
      policy_fair_pass_at_0_80: passAt(0.80, "recorded_policy_fair_recall"),
      sem_weighted_accuracy_avg: scored ? Number((recordedSemSum / scored).toFixed(6)) : null,
      sem_weighted_accuracy_min: scored ? Math.min(...rows.filter((row) => row.scored).map((row) => row.recorded_sem_weighted_accuracy)) : null
    },
    replayed: {
      fair_avg: scored ? Number((replayedFairSum / scored).toFixed(6)) : null,
      fair_pass_at_0_72: passAt(0.72, "replayed_fair_recall"),
      fair_pass_at_0_80: passAt(0.80, "replayed_fair_recall"),
      policy_fair_avg: scored ? Number((replayedPolicyFairSum / scored).toFixed(6)) : null,
      policy_fair_pass_at_0_72: passAt(0.72, "replayed_policy_fair_recall"),
      policy_fair_pass_at_0_80: passAt(0.80, "replayed_policy_fair_recall"),
      sem_weighted_accuracy_avg: scored ? Number((replayedSemSum / scored).toFixed(6)) : null,
      sem_weighted_accuracy_min: scored ? Math.min(...rows.filter((row) => row.scored).map((row) => row.replayed_sem_weighted_accuracy)) : null
    },
    up_count: up,
    down_count: down,
    rows
  };
}

export async function main(argv = process.argv) {
  const inputPath = argValue(argv, "--input");
  if (!inputPath) {
    console.error("Usage: node scripts/replay-render-from-eval.mjs --input <cloud-eval.json> [--max-length 80] [--out <report.json>]");
    return 1;
  }
  const maxLength = Number(argValue(argv, "--max-length", "80")) || 80;
  const scope = argValue(argv, "--scope", "all");
  if (!["all", "internal-reviewed"].includes(scope)) {
    throw new Error("--scope must be all or internal-reviewed");
  }
  const outPath = argValue(argv, "--out", "");
  const report = await replayRenderFromEval({ inputPath, maxLength, scope });
  if (outPath) {
    const resolved = resolve(outPath);
    if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
  }
  const lines = [
    `replay-render-from-eval: ${report.scored_count}/${report.result_count} scored (scope=${report.scope}, maxLength=${report.max_length}, assist preserved=${report.assist_titles_preserved})`,
    `recorded fair: avg=${report.recorded.fair_avg} pass@0.72=${report.recorded.fair_pass_at_0_72} pass@0.80=${report.recorded.fair_pass_at_0_80}`,
    `replayed fair: avg=${report.replayed.fair_avg} pass@0.72=${report.replayed.fair_pass_at_0_72} pass@0.80=${report.replayed.fair_pass_at_0_80}`,
    `recorded policy fair: avg=${report.recorded.policy_fair_avg} pass@0.72=${report.recorded.policy_fair_pass_at_0_72} pass@0.80=${report.recorded.policy_fair_pass_at_0_80}`,
    `replayed policy fair: avg=${report.replayed.policy_fair_avg} pass@0.72=${report.replayed.policy_fair_pass_at_0_72} pass@0.80=${report.replayed.policy_fair_pass_at_0_80}`,
    `recorded SEM: avg=${report.recorded.sem_weighted_accuracy_avg} min=${report.recorded.sem_weighted_accuracy_min}`,
    `replayed SEM: avg=${report.replayed.sem_weighted_accuracy_avg} min=${report.replayed.sem_weighted_accuracy_min}`,
    `up=${report.up_count} down=${report.down_count}`
  ];
  for (const row of report.rows.filter((item) => item.scored && Math.abs(item.delta) > 1e-9)) {
    lines.push(`${row.delta > 0 ? "UP  " : "DOWN"} ${String(row.candidate_id || "").slice(-8)} ${row.recorded_fair_recall} -> ${row.replayed_fair_recall}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`replay-render-from-eval failed: ${error.message}`);
    process.exit(1);
  }
}
