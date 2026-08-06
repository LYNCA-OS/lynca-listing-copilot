#!/usr/bin/env node

// Deterministic, provider-free 150-card replay of the evaluation-only
// positive mechanism bundle. Inputs are pinned to the already-paid cohort and
// fail closed on file, cohort, run, finisher, image, and label alignment.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  COMBINED_POSITIVE_BUNDLE_V1,
  COMBINED_POSITIVE_MECHANISMS_V1,
  runCombinedPositiveBundleV1
} from "../experiments/accuracy/combined-positive-bundle-v1.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const DEFAULT_INPUT = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_EXHAUSTIVE = "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_JSON = "docs/evaluation/accuracy-combined-positive-bundle-v1-replay-150-2026-08-02.json";
const DEFAULT_REPORT = "docs/evaluation/accuracy-combined-positive-bundle-v1-replay-150-2026-08-02.md";

const EXPECTED = Object.freeze({
  input_sha256: "2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5",
  exhaustive_sha256: "96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9",
  cohort_sha256: "c63287ca0d76f669385a720987b36f49a4495b40fe82b1133287fe2c4f272bf7",
  canonical_run_fingerprint: "ee0d30c2a3af46339b9392b9bc5eddb9241d1a761e8b7ef2ba48a6bb3e68e0e3",
  canonical_finisher_fingerprint: "566b0fc16b41a87fce8ba75e050d1e6bfa1e6f3f78518399312a2627b3b34b13",
  exhaustive_run_fingerprint: "c75199e70ed12184170eb0c7c23c43fcbaf673feea1ebd2a9a65be4f7afcaead",
  exhaustive_finisher_fingerprint: "a16861c4d5ff5a5bfa0cc95138f0b1abcc42fdb7581782fc311f2e8758bb48c7"
});

const EXCLUDED_FROM_POSITIVE_COUNT = Object.freeze([
  { mechanism: "generic_logo_exact_identity_admission", reason: "selection_biased_role_routing_held_candidate_only" },
  { mechanism: "typed_grade_compaction", reason: "no_change_on_fresh150" },
  { mechanism: "typed_patch_relic_compaction", reason: "defer_semantic_equivalence_unproven" },
  { mechanism: "typed_product_parent", reason: "no_change_on_fresh150" },
  { mechanism: "manufacturer_product_set", reason: "stop_replay_loss" },
  { mechanism: "shared_observable_components", reason: "stop_mixed_lot_semantics" },
  { mechanism: "shared_grading_info", reason: "defer_no_measured_effect" },
  { mechanism: "asset_token_diagnostic_oracle", reason: "overfit_and_reference_loss" },
  { mechanism: "world_compatibility_ranker", reason: "no_title_authority" },
  { mechanism: "residual_evidence_lane", reason: "not_yet_measured" }
]);

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (path) => sha256(readFileSync(path));
const parseRows = (body) => body.toString("utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const flatten = (value) => {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [String(value ?? "")];
};

function tokens(value) {
  return new Set(String(value ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9/']+/)
    .filter(Boolean));
}

function numericValues(value) {
  return new Set((String(value ?? "").match(/\d+/g) || []).map((part) => String(Number(part))));
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function score(expectedTitle, actualTitle) {
  const wanted = tokens(expectedTitle);
  const got = tokens(actualTitle);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return {
    recall,
    precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0
  };
}

function sign(deltas) {
  return {
    wins: deltas.filter((value) => value > 1e-12).length,
    losses: deltas.filter((value) => value < -1e-12).length,
    ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
  };
}

function candidateFactsFromObservations(observations = []) {
  return observations.flatMap((row) => {
    if (row?.label !== "logo" || row?.kind !== "printed_text") return [];
    const value = clean(row.evidence);
    return value ? [{
      value,
      kind: "affiliation",
      basis: "logo_or_symbol",
      image: row.region === "card_back" ? "image_2" : "image_1",
      region: row.region || "unknown",
      uncertainty: "none",
      source_kind: row.kind,
      source_confidence: row.confidence
    }] : [];
  });
}

function sourceEvidence(canonicalFields, expressionFields, expressionTitle, observations, candidateFacts) {
  const text = [
    ...flatten(canonicalFields),
    ...flatten(expressionFields),
    expressionTitle,
    ...observations.map((row) => row?.evidence || ""),
    ...candidateFacts.map((row) => row?.value || "")
  ].join(" ");
  const sourceTokens = tokens(text);
  const sourceNumbers = numericValues(text);
  const lotCount = clean(canonicalFields?.lot_count);
  if (/^\d+$/.test(lotCount)) sourceTokens.add(`lotx${lotCount}`.toLowerCase());

  // The selected product/finish compaction has one exact normalization:
  // plural `Refractors` becomes singular `Refractor` before composition.
  for (const token of [...sourceTokens]) {
    if (token === "refractors") sourceTokens.add("refractor");
  }
  return { sourceTokens, sourceNumbers };
}

function fieldsDeclaredBy(stage) {
  const declared = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (clean(value.field)) declared.add(value.field);
    if (clean(value.candidate_field)) declared.add(value.candidate_field);
    Object.values(value).forEach(visit);
  };
  visit(stage.actions);
  const fixed = {
    candidate_identity_v3: ["set"],
    attested_insert: ["card_name"],
    finish_family_color_only: ["print_finish", "parallel_exact"],
    product_known_manufacturer_extension: ["product"],
    serial_single_digit_v1: ["serial"],
    typed_product_finish_compaction: ["product", "parallel_exact", "print_finish"],
    exact_parallel_color_compaction: ["parallel_exact", "print_finish"]
  };
  for (const name of fixed[stage.mechanism] || []) declared.add(name);
  return declared;
}

function sanctionedLosses(stage, allLosses) {
  const sanctioned = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const token of value.sanctioned_title_losses || []) sanctioned.add(clean(token).toLowerCase());
    if (value.same_numeric_value || value.same_value) {
      for (const token of tokens(value.before)) sanctioned.add(token);
    }
    Object.values(value).forEach(visit);
  };
  visit(stage.actions);
  if ([
    "serial_single_digit_v1",
    "front_same_value_serial",
    "typed_product_finish_compaction",
    "exact_parallel_color_compaction",
    "compact_lot_quantity"
  ].includes(stage.mechanism)) {
    allLosses.forEach((token) => sanctioned.add(token));
  }
  return allLosses.filter((token) => sanctioned.has(token));
}

function transitionMetrics(expectedTitle, stage, evidence) {
  const beforeScore = score(expectedTitle, stage.before_title);
  const afterScore = score(expectedTitle, stage.after_title);
  const beforeTokens = tokens(stage.before_title);
  const afterTokens = tokens(stage.after_title);
  const expectedTokens = tokens(expectedTitle);
  const lostTitleTokens = difference(beforeTokens, afterTokens);
  const lostExpectedTokens = lostTitleTokens.filter((token) => expectedTokens.has(token));
  const addedTokens = difference(afterTokens, beforeTokens);
  const unbackedNewTokens = addedTokens.filter((token) => !evidence.sourceTokens.has(token));
  const beforeNumbers = numericValues(stage.before_title);
  const afterNumbers = numericValues(stage.after_title);
  const lostNumericValues = difference(beforeNumbers, afterNumbers);
  const unbackedNumericValues = difference(afterNumbers, beforeNumbers)
    .filter((value) => !evidence.sourceNumbers.has(value));
  const declared = fieldsDeclaredBy(stage);
  const unrelatedFieldDrift = stage.changed_fields.filter((field) => !declared.has(field));
  const sanctioned = sanctionedLosses(stage, lostTitleTokens);
  return {
    before_score: beforeScore,
    after_score: afterScore,
    delta_f1: afterScore.f1 - beforeScore.f1,
    verdict: afterScore.f1 - beforeScore.f1 > 1e-12
      ? "WIN"
      : afterScore.f1 - beforeScore.f1 < -1e-12 ? "LOSS" : "TIE",
    changed_title: stage.changed_title,
    changed_fields: stage.changed_fields,
    reference_losses: lostExpectedTokens,
    title_losses: lostTitleTokens,
    sanctioned_title_losses: sanctioned,
    unsanctioned_title_losses: lostTitleTokens.filter((token) => !sanctioned.includes(token)),
    unbacked_new_tokens: unbackedNewTokens,
    lost_numeric_values: lostNumericValues,
    unbacked_numeric_values: unbackedNumericValues,
    numeric_mutation: Boolean(lostNumericValues.length || unbackedNumericValues.length),
    unrelated_field_drift: unrelatedFieldDrift,
    over_80: stage.after_title.length > 80
  };
}

function summarizeTransitions(rows) {
  const deltas = rows.map((row) => row.metrics.delta_f1);
  const beforeMacro = mean(rows.map((row) => row.metrics.before_score.f1));
  const afterMacro = mean(rows.map((row) => row.metrics.after_score.f1));
  const summary = {
    before_macro_f1: beforeMacro,
    after_macro_f1: afterMacro,
    delta_macro_f1: afterMacro - beforeMacro,
    ...sign(deltas),
    changed_cards: rows.filter((row) => row.metrics.changed_title).length,
    field_change_cards: rows.filter((row) => row.metrics.changed_fields.length).length,
    reference_loss_cards: rows.filter((row) => row.metrics.reference_losses.length).length,
    reference_loss_tokens: rows.reduce((sum, row) => sum + row.metrics.reference_losses.length, 0),
    title_loss_cards: rows.filter((row) => row.metrics.title_losses.length).length,
    title_loss_tokens: rows.reduce((sum, row) => sum + row.metrics.title_losses.length, 0),
    sanctioned_title_loss_cards: rows.filter((row) => row.metrics.sanctioned_title_losses.length).length,
    unsanctioned_title_loss_cards: rows.filter((row) => row.metrics.unsanctioned_title_losses.length).length,
    unbacked_new_token_cards: rows.filter((row) => row.metrics.unbacked_new_tokens.length).length,
    unbacked_numeric_cards: rows.filter((row) => row.metrics.unbacked_numeric_values.length).length,
    numeric_mutation_cards: rows.filter((row) => row.metrics.numeric_mutation).length,
    unrelated_field_drift_cards: rows.filter((row) => row.metrics.unrelated_field_drift.length).length,
    over_80_cards: rows.filter((row) => row.metrics.over_80).length
  };
  summary.positive_asset = summary.changed_cards > 0
    && summary.delta_macro_f1 > 1e-12
    && summary.wins > 0
    && summary.losses === 0
    && summary.reference_loss_cards === 0
    && summary.unbacked_new_token_cards === 0
    && summary.unbacked_numeric_cards === 0
    && summary.numeric_mutation_cards === 0
    && summary.unrelated_field_drift_cards === 0
    && summary.over_80_cards === 0;
  summary.literal_title_lossless = summary.title_loss_cards === 0;
  return summary;
}

function compactAction(action) {
  const compact = {};
  for (const key of [
    "mechanism", "kind", "field", "candidate_field", "candidate_value",
    "admission_reason", "restored_bracket", "source_field", "reason"
  ]) {
    if (action?.[key] !== undefined) compact[key] = action[key];
  }
  if (Array.isArray(action?.details)) compact.details = action.details.map(compactAction);
  return compact;
}

function finalTransition(bundle) {
  return {
    mechanism: "final_bundle",
    before_title: bundle.baseline.title,
    after_title: bundle.candidate.title,
    changed_title: bundle.baseline.title !== bundle.candidate.title,
    changed_fields: [...new Set(bundle.stages.flatMap((stage) => stage.changed_fields))],
    actions: bundle.stages.flatMap((stage) => stage.actions),
    rejected: []
  };
}

function cohortRows(inputBody, exhaustiveBody) {
  const inputRows = parseRows(inputBody);
  const exhaustiveRows = parseRows(exhaustiveBody);
  if (inputRows.length !== 300 || exhaustiveRows.length !== 150) {
    throw new Error(`combined_replay_source_row_count_mismatch:${inputRows.length}:${exhaustiveRows.length}`);
  }
  const canonical = inputRows.filter((row) => row.arm === "thin_canonical_high" && row.fields);
  const free = inputRows.filter((row) => row.arm === "thin_budgeted");
  const exhaustive = exhaustiveRows.filter((row) => row.arm === "exhaustive_observation_high");
  for (const [name, rows] of Object.entries({ canonical, free, exhaustive })) {
    if (rows.length !== 150 || new Set(rows.map((row) => row.asset_id)).size !== 150) {
      throw new Error(`combined_replay_${name}_count_or_uniqueness_mismatch`);
    }
  }

  const freeById = new Map(free.map((row) => [row.asset_id, row]));
  const exhaustiveById = new Map(exhaustive.map((row) => [row.asset_id, row]));
  const ids = canonical.map((row) => row.asset_id);
  if (sha256([...ids].sort().join("\n")) !== EXPECTED.cohort_sha256) {
    throw new Error("combined_replay_cohort_fingerprint_mismatch");
  }
  for (const row of canonical) {
    const freeRow = freeById.get(row.asset_id);
    const exhaustiveRow = exhaustiveById.get(row.asset_id);
    if (!freeRow || !exhaustiveRow) throw new Error(`combined_replay_unpaired_asset:${row.asset_id}`);
    for (const name of ["reference", "image_set_sha256"]) {
      if (row[name] !== freeRow[name] || row[name] !== exhaustiveRow[name]) {
        throw new Error(`combined_replay_${name}_mismatch:${row.asset_id}`);
      }
    }
    if (row.run_fingerprint !== EXPECTED.canonical_run_fingerprint
      || freeRow.run_fingerprint !== EXPECTED.canonical_run_fingerprint
      || row.finisher_fingerprint !== EXPECTED.canonical_finisher_fingerprint
      || freeRow.finisher_fingerprint !== EXPECTED.canonical_finisher_fingerprint
      || exhaustiveRow.run_fingerprint !== EXPECTED.exhaustive_run_fingerprint
      || exhaustiveRow.finisher_fingerprint !== EXPECTED.exhaustive_finisher_fingerprint) {
      throw new Error(`combined_replay_row_fingerprint_mismatch:${row.asset_id}`);
    }
  }
  return { canonical, freeById, exhaustiveById };
}

function markdown(result) {
  const number = (value) => Number(value).toFixed(6);
  const stageRows = result.stage_summaries.map((row) => (
    `| ${row.mechanism} | ${number(row.before_macro_f1)} -> ${number(row.after_macro_f1)} | ${row.delta_macro_f1 >= 0 ? "+" : ""}${number(row.delta_macro_f1)} | ${row.wins}/${row.losses}/${row.ties} | ${row.changed_cards} | ${row.reference_loss_cards} | ${row.title_loss_cards} | ${row.unbacked_new_token_cards} | ${row.numeric_mutation_cards} | ${row.unrelated_field_drift_cards} | ${row.over_80_cards} | ${row.positive_asset ? "KEEP" : "STOP"} |`
  )).join("\n");
  const changedRows = result.changed_cards.map((row) => (
    `| \`${row.asset_id}\` | ${row.changed_mechanisms.join(", ")} | ${row.final_delta_f1 >= 0 ? "+" : ""}${number(row.final_delta_f1)} | ${row.reference_losses.join(", ") || "none"} | ${row.title_losses.join(", ") || "none"} |`
  )).join("\n");
  const interactionRows = result.interactions.length
    ? result.interactions.map((row) => (
      `| \`${row.asset_id}\` | ${row.isolated_changed_mechanisms.join(", ") || "none"} | ${row.sequential_changed_mechanisms.join(", ") || "none"} | ${row.interaction_kind} | ${row.interaction_delta >= 0 ? "+" : ""}${number(row.interaction_delta)} |`
    )).join("\n")
    : "| none | none | none | none | 0.000000 |";
  const excludedRows = result.positive_asset_count.excluded.map((row) => `| ${row.mechanism} | ${row.reason} |`).join("\n");
  const strict = result.positive_asset_count.literal_title_lossless_mechanisms.join(", ") || "none";
  const paidEligible = result.positive_asset_count.paid_fresh150_eligible.join(", ") || "none";
  const sameCohortOnly = result.positive_asset_count.same_cohort_only
    .map((row) => `${row.mechanism} (${row.reason})`).join(", ") || "none";

  return `# Combined positive bundle v1 — zero-cost 150-card replay (2026-08-02)\n\n## Decision\n\nThe tempting opposing claim is that every mechanism previously called positive can simply be added together. The unified replay rejects that shortcut: it replays the exact 150 paired IDs under one fixed order, measures every marginal step, and separately records overlap, title displacement, and isolated-vs-sequential interaction.\n\nThe combined result is **${number(result.final_summary.baseline_macro_f1)} -> ${number(result.final_summary.candidate_macro_f1)}** (**+${number(result.final_summary.delta_macro_f1)}**), with **${result.final_summary.wins} wins / ${result.final_summary.losses} losses / ${result.final_summary.ties} ties**. It changes ${result.final_summary.changed_cards} cards and has zero reference-token loss, zero unbacked new token, zero numeric mutation, zero unrelated field drift, and zero title over 80. This is an evaluation candidate, not a production promotion. Provider calls: 0.\n\n## Positive-asset count\n\n**${result.positive_asset_count.count} mechanisms** meet the same-cohort replay gate: they fired, improved macro F1, had at least one win, no F1 loss, and passed the reference/backing/numeric/drift/80 safety checks. No-change, deferred, stopped, world-ranker no-title, residual-unmeasured, and diagnostic-oracle mechanisms are not counted.\n\nLiteral title-token-lossless subset (${result.positive_asset_count.literal_title_lossless_count}): ${strict}. The larger ${result.positive_asset_count.count}-mechanism count permits typed formatting/compaction when reference tokens and numeric meaning are preserved; all raw title losses remain listed below rather than hidden.\n\nEligible for the independent paid fresh-150 bundle (${result.positive_asset_count.paid_fresh150_eligible_count}): ${paidEligible}. Same-cohort only: ${sameCohortOnly}. The exact-identity generic-logo branch inside the phrase resolver is held as candidate-only and contributes neither title changes nor the count.\n\n## Stage ledger\n\n| mechanism | macro F1 | step delta | W/L/T | changed | reference loss | title loss | unbacked new | numeric mutations | unrelated drift | >80 | gate |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${stageRows}\n\n## Final safety\n\n| metric | value |\n|---|---:|\n| paired cards | ${result.source.cards} |\n| changed cards | ${result.final_summary.changed_cards} |\n| reference-loss cards / tokens | ${result.final_summary.reference_loss_cards} / ${result.final_summary.reference_loss_tokens} |\n| raw title-loss cards / tokens | ${result.final_summary.title_loss_cards} / ${result.final_summary.title_loss_tokens} |\n| sanctioned / unsanctioned title-loss cards | ${result.final_summary.sanctioned_title_loss_cards} / ${result.final_summary.unsanctioned_title_loss_cards} |\n| unbacked-new-token cards | ${result.final_summary.unbacked_new_token_cards} |\n| unbacked-numeric cards | ${result.final_summary.unbacked_numeric_cards} |\n| numeric-mutation cards | ${result.final_summary.numeric_mutation_cards} |\n| unrelated-field-drift cards | ${result.final_summary.unrelated_field_drift_cards} |\n| titles over 80 | ${result.final_summary.over_80_cards} |\n\n## Every changed card\n\n| asset | mechanisms that changed title | final delta F1 | reference tokens lost | raw title tokens lost |\n|---|---|---:|---|---|\n${changedRows}\n\n## All detected interactions\n\nAn interaction is recorded when two or more isolated mechanisms affect the same card, when sequential and isolated firing differ, or when the final per-card delta differs from the sum of isolated deltas. Deduplicated means an earlier mechanism already supplied the same result; nonlinear metric overlap means both mechanisms survived but set-F1 is not additive.\n\n| asset | isolated changes | sequential changes | kind | final - sum(isolated) |\n|---|---|---|---|---:|\n${interactionRows}\n\n## Explicitly excluded from the count\n\n| mechanism | reason |\n|---|---|\n${excludedRows}\n\n## Evidence boundary\n\n- Input SHA-256: \`${result.source.input_sha256}\`.\n- Exhaustive SHA-256: \`${result.source.exhaustive_sha256}\`.\n- Cohort SHA-256: \`${result.source.cohort_sha256}\`.\n- Exactly 150 unique paired IDs; image fingerprints and labels match across all three arms.\n- Rules receive no scoring labels or cohort identifiers.\n- World ranker changes no title and residual evidence is not yet measured, so neither contributes to F1 or the positive count.\n- Default and production paths are unchanged. A genuinely new paid 150 cohort remains the independent promotion gate.\n`;
}

const inputPath = arg("--input", DEFAULT_INPUT);
const exhaustivePath = arg("--exhaustive", DEFAULT_EXHAUSTIVE);
const jsonPath = arg("--out-json", DEFAULT_JSON);
const reportPath = arg("--out-report", DEFAULT_REPORT);
const inputBody = readFileSync(inputPath);
const exhaustiveBody = readFileSync(exhaustivePath);
const inputHash = sha256(inputBody);
const exhaustiveHash = sha256(exhaustiveBody);
if (inputHash !== EXPECTED.input_sha256 || exhaustiveHash !== EXPECTED.exhaustive_sha256) {
  throw new Error("combined_replay_source_file_fingerprint_mismatch");
}

const { canonical, freeById, exhaustiveById } = cohortRows(inputBody, exhaustiveBody);
const artifactSha = exhaustiveHash;
const cards = canonical.map((canonicalRow) => {
  const freeRow = freeById.get(canonicalRow.asset_id);
  const exhaustiveRow = exhaustiveById.get(canonicalRow.asset_id);
  const observations = exhaustiveRow.observations || [];
  const expression = projectFreeTitleThroughCsm(freeRow.title);
  const candidateFacts = candidateFactsFromObservations(observations);
  const context = {
    expressionFields: expression.fields,
    expressionTitle: freeRow.title,
    candidateFacts,
    observations,
    provenance: { source: "exhaustive_observation_high", checkpoint_sha256: artifactSha }
  };
  const evidence = sourceEvidence(canonicalRow.fields, expression.fields, freeRow.title, observations, candidateFacts);
  const bundle = runCombinedPositiveBundleV1(canonicalRow.fields, context);
  const sequential = bundle.stages.map((stage) => ({
    mechanism: stage.mechanism,
    metrics: transitionMetrics(canonicalRow.reference, stage, evidence),
    before_title: stage.before_title,
    after_title: stage.after_title,
    actions: stage.actions.map(compactAction),
    rejected_count: stage.rejected.length
  }));
  const isolated = Object.fromEntries(COMBINED_POSITIVE_MECHANISMS_V1.map((mechanism) => {
    const replay = runCombinedPositiveBundleV1(canonicalRow.fields, {
      ...context,
      enabledMechanisms: [mechanism]
    });
    const isolatedStage = finalTransition(replay);
    return [mechanism, {
      title: replay.candidate.title,
      metrics: transitionMetrics(canonicalRow.reference, isolatedStage, evidence)
    }];
  }));
  const finalStage = finalTransition(bundle);
  const finalMetrics = transitionMetrics(canonicalRow.reference, finalStage, evidence);
  const stageDrift = new Set(sequential.flatMap((stage) => stage.metrics.unrelated_field_drift));
  const stageSanctions = new Set(sequential.flatMap((stage) => stage.metrics.sanctioned_title_losses));
  finalMetrics.unrelated_field_drift = [...stageDrift];
  finalMetrics.sanctioned_title_losses = finalMetrics.title_losses
    .filter((token) => stageSanctions.has(token));
  finalMetrics.unsanctioned_title_losses = finalMetrics.title_losses
    .filter((token) => !stageSanctions.has(token));
  return {
    asset_id: canonicalRow.asset_id,
    reference: canonicalRow.reference,
    baseline_title: bundle.baseline.title,
    candidate_title: bundle.candidate.title,
    sequential,
    isolated,
    final_metrics: finalMetrics
  };
});

const stageSummaries = COMBINED_POSITIVE_MECHANISMS_V1.map((mechanism, index) => ({
  mechanism,
  ...summarizeTransitions(cards.map((card) => ({ metrics: card.sequential[index].metrics })))
}));
const finalSummaryCore = summarizeTransitions(cards.map((card) => ({ metrics: card.final_metrics })));
const finalSummary = {
  baseline_macro_f1: mean(cards.map((card) => card.final_metrics.before_score.f1)),
  candidate_macro_f1: mean(cards.map((card) => card.final_metrics.after_score.f1)),
  ...finalSummaryCore
};
const positiveMechanisms = stageSummaries.filter((row) => row.positive_asset).map((row) => row.mechanism);
const literalTitleLosslessMechanisms = stageSummaries
  .filter((row) => row.positive_asset && row.literal_title_lossless)
  .map((row) => row.mechanism);
const sameCohortOnly = positiveMechanisms.includes("candidate_identity_v3")
  ? [{
    mechanism: "candidate_identity_v3",
    reason: "generic_logo_does_not_prove_set_role_and_one_card_displaces_visible_finish_tokens"
  }]
  : [];
const paidFresh150Eligible = positiveMechanisms.filter((mechanism) => (
  !sameCohortOnly.some((row) => row.mechanism === mechanism)
));

const changedCards = cards.filter((card) => card.final_metrics.changed_title).map((card) => ({
  asset_id: card.asset_id,
  reference: card.reference,
  baseline_title: card.baseline_title,
  candidate_title: card.candidate_title,
  final_delta_f1: card.final_metrics.delta_f1,
  reference_losses: card.final_metrics.reference_losses,
  title_losses: card.final_metrics.title_losses,
  unbacked_new_tokens: card.final_metrics.unbacked_new_tokens,
  lost_numeric_values: card.final_metrics.lost_numeric_values,
  unbacked_numeric_values: card.final_metrics.unbacked_numeric_values,
  unrelated_field_drift: card.final_metrics.unrelated_field_drift,
  changed_mechanisms: card.sequential.filter((stage) => stage.metrics.changed_title)
    .map((stage) => stage.mechanism),
  stages: card.sequential.filter((stage) => stage.metrics.changed_title).map((stage) => ({
    mechanism: stage.mechanism,
    before_title: stage.before_title,
    after_title: stage.after_title,
    delta_f1: stage.metrics.delta_f1,
    reference_losses: stage.metrics.reference_losses,
    title_losses: stage.metrics.title_losses,
    sanctioned_title_losses: stage.metrics.sanctioned_title_losses,
    unsanctioned_title_losses: stage.metrics.unsanctioned_title_losses,
    actions: stage.actions
  }))
}));

const interactions = cards.flatMap((card) => {
  const isolatedChanged = COMBINED_POSITIVE_MECHANISMS_V1
    .filter((mechanism) => card.isolated[mechanism].metrics.changed_title);
  const sequentialChanged = card.sequential.filter((stage) => stage.metrics.changed_title)
    .map((stage) => stage.mechanism);
  const sumIsolated = COMBINED_POSITIVE_MECHANISMS_V1.reduce(
    (sum, mechanism) => sum + card.isolated[mechanism].metrics.delta_f1,
    0
  );
  const interactionDelta = card.final_metrics.delta_f1 - sumIsolated;
  const firingDiffers = isolatedChanged.join("\n") !== sequentialChanged.join("\n");
  if (new Set([...isolatedChanged, ...sequentialChanged]).size < 2
    && !firingDiffers
    && Math.abs(interactionDelta) <= 1e-12) return [];
  return [{
    asset_id: card.asset_id,
    isolated_changed_mechanisms: isolatedChanged,
    sequential_changed_mechanisms: sequentialChanged,
    isolated_delta_sum: sumIsolated,
    final_delta_f1: card.final_metrics.delta_f1,
    interaction_delta: interactionDelta,
    interaction_kind: firingDiffers
      ? "deduplicated"
      : interactionDelta > 1e-12
        ? "constructive"
        : interactionDelta < -1e-12 ? "nonlinear_metric_overlap" : "additive",
    firing_differs: firingDiffers
  }];
});

const result = {
  schema_version: `${COMBINED_POSITIVE_BUNDLE_V1}-replay-150`,
  authority: "evaluation_only",
  production_promoted: false,
  provider_calls: 0,
  source: {
    input_path: inputPath,
    exhaustive_path: exhaustivePath,
    input_sha256: inputHash,
    exhaustive_sha256: exhaustiveHash,
    cohort_sha256: EXPECTED.cohort_sha256,
    canonical_run_fingerprint: EXPECTED.canonical_run_fingerprint,
    canonical_finisher_fingerprint: EXPECTED.canonical_finisher_fingerprint,
    exhaustive_run_fingerprint: EXPECTED.exhaustive_run_fingerprint,
    exhaustive_finisher_fingerprint: EXPECTED.exhaustive_finisher_fingerprint,
    cards: 150,
    arms: ["thin_canonical_high", "thin_budgeted", "exhaustive_observation_high"]
  },
  implementation: {
    bundle_sha256: fileSha256(new URL("../experiments/accuracy/combined-positive-bundle-v1.mjs", import.meta.url)),
    expression_overlay_sha256: fileSha256(new URL("../lib/listing/thin/accuracy-expression-overlay-v1.mjs", import.meta.url)),
    schema73_overlay_sha256: fileSha256(new URL("../lib/listing/thin/accuracy-schema73-overlay-v1.mjs", import.meta.url)),
    phrase_resolver_sha256: fileSha256(new URL("../lib/listing/thin/accuracy-phrase-aware-resolver-v1.mjs", import.meta.url)),
    composer_recovery_sha256: fileSha256(new URL("../experiments/accuracy/composer-downstream-generalizable-v1.mjs", import.meta.url)),
    lot_recovery_sha256: fileSha256(new URL("../experiments/accuracy/lot-contract-recovery-v1.mjs", import.meta.url)),
    replay_script_sha256: fileSha256(new URL("./replay-combined-positive-bundle-v1.mjs", import.meta.url))
  },
  mechanism_order: COMBINED_POSITIVE_MECHANISMS_V1,
  positive_asset_count: {
    count: positiveMechanisms.length,
    mechanisms: positiveMechanisms,
    literal_title_lossless_count: literalTitleLosslessMechanisms.length,
    literal_title_lossless_mechanisms: literalTitleLosslessMechanisms,
    paid_fresh150_eligible_count: paidFresh150Eligible.length,
    paid_fresh150_eligible: paidFresh150Eligible,
    same_cohort_only: sameCohortOnly,
    gate: "changed_and_positive_with_zero_f1_reference_backing_numeric_drift_length_failures",
    excluded: EXCLUDED_FROM_POSITIVE_COUNT
  },
  stage_summaries: stageSummaries,
  final_summary: finalSummary,
  interactions,
  changed_cards: changedCards,
  cards: cards.map((card) => ({
    asset_id: card.asset_id,
    baseline_title: card.baseline_title,
    candidate_title: card.candidate_title,
    final_delta_f1: card.final_metrics.delta_f1,
    verdict: card.final_metrics.verdict,
    changed_mechanisms: card.sequential.filter((stage) => stage.metrics.changed_title)
      .map((stage) => stage.mechanism)
  }))
};

if (positiveMechanisms.length < 10) {
  throw new Error(`combined_replay_positive_mechanism_count_below_gate:${positiveMechanisms.length}`);
}
if (finalSummary.losses || finalSummary.reference_loss_cards || finalSummary.unbacked_new_token_cards
  || finalSummary.unbacked_numeric_cards || finalSummary.numeric_mutation_cards
  || finalSummary.unrelated_field_drift_cards || finalSummary.over_80_cards) {
  throw new Error(`combined_replay_final_safety_gate_failed:${JSON.stringify(finalSummary)}`);
}

writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(reportPath, markdown(result));
console.log(JSON.stringify({
  schema_version: result.schema_version,
  json: jsonPath,
  report: reportPath,
  provider_calls: 0,
  positive_asset_count: result.positive_asset_count.count,
  final_summary: result.final_summary,
  interactions: result.interactions.length,
  changed_cards: result.changed_cards.length
}, null, 2));
