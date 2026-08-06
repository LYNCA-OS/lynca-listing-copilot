#!/usr/bin/env node

// Zero-call falsification replay for the local catalog world graph. This script
// never invokes a provider and never composes or mutates a listing title.

import { readFile, writeFile } from "node:fs/promises";

import { enumerateProduct, norm as catalogNorm } from "../lib/listing/catalog/constraint-enumerator.mjs";
import { loadConstraintModelSnapshot } from "../lib/listing/catalog/constraint-model-store.mjs";
import {
  buildWorldCompatibilityIndexes,
  rankProductCandidates,
  rankTeamCandidates,
  rankYearCandidates,
  worldCompatibilityRankerVersion,
  worldNorm
} from "../experiments/accuracy/world-compatibility-ranker-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const canonicalPath = arg("--canonical", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const expressionPath = arg("--expression", "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl");
const lossLedgerPath = arg("--loss-ledger", "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json");
const outputPath = arg("--out", "docs/evaluation/world-compatibility-ranker-v1-replay-150-2026-08-02.json");

const rowsFromJsonl = (body) => String(body).split("\n").filter((line) => line.trim()).map((line, index) => {
  try { return JSON.parse(line); } catch { throw new Error(`invalid_jsonl:${index + 1}`); }
});
const tokens = (value) => new Set(worldNorm(value).split(" ").filter(Boolean));
const tokenF1 = (reference, candidate) => {
  const wanted = tokens(reference);
  const got = tokens(candidate);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= Math.min(k, n - k); index += 1) result = result * (n - index + 1) / index;
  return result;
};
const twoSidedSignP = (wins, losses) => {
  const n = wins + losses;
  if (!n) return 1;
  const tail = Math.min(wins, losses);
  const probability = Array.from({ length: tail + 1 }, (_, index) => choose(n, index) / (2 ** n))
    .reduce((sum, value) => sum + value, 0);
  return Math.min(1, 2 * probability);
};
const firstYear = (value) => String(value ?? "").match(/(?:19|20)\d{2}/)?.[0] || null;
const sameMembers = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

const [canonicalBody, expressionBody, ledgerBody] = await Promise.all([
  readFile(canonicalPath, "utf8"),
  readFile(expressionPath, "utf8"),
  readFile(lossLedgerPath, "utf8")
]);
const canonicalRows = rowsFromJsonl(canonicalBody).filter((row) => row.arm === "thin_canonical_high");
const expressionRows = rowsFromJsonl(expressionBody);
const ledger = JSON.parse(ledgerBody);
if (canonicalRows.length !== 150 || expressionRows.length !== 150) {
  throw new Error(`fresh150_row_count_mismatch:${canonicalRows.length}/${expressionRows.length}`);
}
if (!sameMembers(canonicalRows.map((row) => row.asset_id), expressionRows.map((row) => row.asset_id))) {
  throw new Error("fresh150_asset_set_mismatch");
}
const model = await loadConstraintModelSnapshot();
const indexes = buildWorldCompatibilityIndexes(model);

function replayRelation({ name, kind, rank }) {
  let wins = 0;
  let losses = 0;
  let unchanged = 0;
  let eligibleCards = 0;
  let supportedCards = 0;
  let changedCards = 0;
  let hardRejections = 0;
  let valueMutations = 0;
  let candidateCountDeltas = 0;
  const deltas = [];
  const changed = [];
  for (const row of expressionRows) {
    const facts = Array.isArray(row.candidate_facts) ? row.candidate_facts : [];
    const candidates = facts.filter((fact) => fact.kind === kind);
    if (candidates.length < 2) {
      unchanged += 1;
      continue;
    }
    eligibleCards += 1;
    const before = candidates[0];
    const result = rank(candidates, facts, model, indexes);
    const after = result.candidates[0];
    if (result.decisions.some((decision) => decision.rank_score > 0)) supportedCards += 1;
    hardRejections += result.rejected_candidate_ids.length;
    valueMutations += Number(result.values_mutated);
    candidateCountDeltas += Math.abs(result.candidate_count_before - result.candidate_count_after);
    if (!sameMembers(candidates.map((candidate) => candidate.value), result.candidates.map((candidate) => candidate.value))) {
      throw new Error(`candidate_values_changed:${name}:${row.asset_id}`);
    }
    const baselineF1 = tokenF1(row.reference, before.value);
    const candidateF1 = tokenF1(row.reference, after.value);
    const delta = candidateF1 - baselineF1;
    deltas.push(delta);
    if (after !== before) changedCards += 1;
    if (delta > 1e-12) wins += 1;
    else if (delta < -1e-12) losses += 1;
    else unchanged += 1;
    if (after !== before) {
      changed.push({
        asset_id: row.asset_id,
        reference: row.reference,
        before: before.value,
        after: after.value,
        baseline_candidate_f1: baselineF1,
        ranked_candidate_f1: candidateF1,
        delta_f1: delta,
        support_edges: result.decisions[0].support_edges
      });
    }
  }
  return {
    relation: name,
    candidate_kind: kind,
    cards: expressionRows.length,
    eligible_multi_candidate_cards: eligibleCards,
    cards_with_positive_world_support: supportedCards,
    changed_top_candidate_cards: changedCards,
    wins,
    losses,
    unchanged,
    mean_delta_on_eligible_cards: mean(deltas),
    exact_two_sided_sign_p: twoSidedSignP(wins, losses),
    hard_rejections: hardRejections,
    value_mutations: valueMutations,
    candidate_count_deltas: candidateCountDeltas,
    changed
  };
}

const relationReplays = {
  subject_year: replayRelation({ name: "subject_year", kind: "year", rank: rankYearCandidates }),
  subject_team_year: replayRelation({ name: "subject_team_year", kind: "affiliation", rank: rankTeamCandidates }),
  product_year: replayRelation({ name: "product_year", kind: "identity", rank: rankProductCandidates })
};

function longestIdentityControl() {
  let wins = 0;
  let losses = 0;
  let unchanged = 0;
  let changedCards = 0;
  for (const row of expressionRows) {
    const candidates = (row.candidate_facts || []).filter((fact) => fact.kind === "identity");
    if (candidates.length < 2) {
      unchanged += 1;
      continue;
    }
    const before = candidates[0];
    const after = candidates.map((candidate, originalIndex) => ({
      candidate,
      originalIndex,
      tokenCount: tokens(candidate.value).size
    })).sort((left, right) => right.tokenCount - left.tokenCount || left.originalIndex - right.originalIndex)[0].candidate;
    if (after !== before) changedCards += 1;
    const delta = tokenF1(row.reference, after.value) - tokenF1(row.reference, before.value);
    if (delta > 1e-12) wins += 1;
    else if (delta < -1e-12) losses += 1;
    else unchanged += 1;
  }
  return {
    rule: "longest_identity_candidate_without_world_edges",
    changed_top_candidate_cards: changedCards,
    wins,
    losses,
    unchanged,
    exact_two_sided_sign_p: twoSidedSignP(wins, losses),
    interpretation: "higher gross recall but unsafe; world compatibility trades 18 wins to remove 10 losses in this cohort"
  };
}
const simpleControls = { longest_identity: longestIdentityControl() };

const teamFrequency = new Map();
for (const teams of Object.values(model.player_teams || {})) {
  for (const team of teams) teamFrequency.set(team, (teamFrequency.get(team) || 0) + 1);
}
const knownAmbiguousTeamLabels = [
  "rookie", "legend", "raw", "smackdown", "nxt", "legends", "toy story",
  "then", "now", "west", "east", "-", "toy story 3", "toy story 2"
];
const setEntries = Object.entries(model.set_product_years || {});
let singleProductSetKeys = 0;
for (const [, entries] of setEntries) {
  if (new Set(entries.map((entry) => String(entry).split("|").at(-1))).size === 1) singleProductSetKeys += 1;
}

const subjectCoverage = {
  occurrences: 0,
  player_years: 0,
  player_teams: 0,
  player_team_years: 0,
  unique_player_team_years: 0
};
const productEnumeration = [];
let ipFieldCards = 0;
for (const row of canonicalRows) {
  const fields = row.fields || {};
  if (fields.ip) ipFieldCards += 1;
  const year = firstYear(fields.year);
  for (const subjectValue of fields.subjects || []) {
    subjectCoverage.occurrences += 1;
    const subject = catalogNorm(subjectValue);
    if (model.player_years?.[subject]) subjectCoverage.player_years += 1;
    if (model.player_teams?.[subject]) subjectCoverage.player_teams += 1;
    const teams = year ? model.player_team_years?.[subject]?.[year] : null;
    if (Array.isArray(teams) && teams.length) {
      subjectCoverage.player_team_years += 1;
      if (teams.length === 1) subjectCoverage.unique_player_team_years += 1;
    }
  }
  const outcome = enumerateProduct({
    set: fields.set || fields.card_name,
    year: fields.year,
    manufacturer: fields.manufacturer
  }, model);
  if (outcome.status === "VALUE") {
    productEnumeration.push({
      asset_id: row.asset_id,
      reference: row.reference,
      visible_set_or_card_name: fields.set || fields.card_name,
      canonical_product: fields.product,
      enumerated_product: outcome.value,
      reason: outcome.reason
    });
  }
}

function subjectYearHardRejectAudit() {
  const counts = { covered_cards: 0, true_positive_wrong_year_rejected: 0, false_positive_correct_year_rejected: 0, true_negative_correct_year_kept: 0, false_negative_wrong_year_kept: 0 };
  for (const row of canonicalRows) {
    const candidateYear = firstYear(row.fields?.year);
    const referenceYear = firstYear(row.reference);
    const contradictions = [];
    for (const subjectValue of row.fields?.subjects || []) {
      const years = model.player_years?.[catalogNorm(subjectValue)];
      if (years?.length && candidateYear) contradictions.push(!years.map(String).includes(candidateYear));
    }
    if (!contradictions.length) continue;
    counts.covered_cards += 1;
    const wouldReject = contradictions.every(Boolean);
    const candidateWrong = candidateYear !== referenceYear;
    if (wouldReject && candidateWrong) counts.true_positive_wrong_year_rejected += 1;
    else if (wouldReject) counts.false_positive_correct_year_rejected += 1;
    else if (candidateWrong) counts.false_negative_wrong_year_kept += 1;
    else counts.true_negative_correct_year_kept += 1;
  }
  const rejected = counts.true_positive_wrong_year_rejected + counts.false_positive_correct_year_rejected;
  const correct = counts.false_positive_correct_year_rejected + counts.true_negative_correct_year_kept;
  return {
    ...counts,
    rejection_precision: rejected ? counts.true_positive_wrong_year_rejected / rejected : null,
    false_positive_rate: correct ? counts.false_positive_correct_year_rejected / correct : null
  };
}

const productYearIndex = new Map(Object.entries(model.product_years || {}).map(([key, years]) => [worldNorm(key), { key, years }]));
const productAliases = (fields = {}) => {
  const raw = worldNorm(fields.product);
  const manufacturer = worldNorm(fields.manufacturer);
  const values = new Set([raw]);
  if (manufacturer && raw.startsWith(`${manufacturer} `)) values.add(raw.slice(manufacturer.length + 1));
  for (const suffix of [" basketball", " baseball", " football", " soccer", " hockey", " tennis", " trading cards", " cards"]) {
    if (raw.endsWith(suffix)) values.add(raw.slice(0, -suffix.length));
  }
  if (manufacturer) for (const value of [...values]) values.add(`${manufacturer} ${value}`);
  return [...values];
};
function productYearHardRejectAudit() {
  const counts = { covered_cards: 0, true_positive_wrong_year_rejected: 0, false_positive_correct_year_rejected: 0, true_negative_correct_year_kept: 0, false_negative_wrong_year_kept: 0 };
  for (const row of canonicalRows) {
    const candidateYear = firstYear(row.fields?.year);
    const referenceYear = firstYear(row.reference);
    const entry = productAliases(row.fields).map((value) => productYearIndex.get(value)).find(Boolean);
    if (!entry || !candidateYear) continue;
    counts.covered_cards += 1;
    const wouldReject = !entry.years.map(String).includes(candidateYear);
    const candidateWrong = candidateYear !== referenceYear;
    if (wouldReject && candidateWrong) counts.true_positive_wrong_year_rejected += 1;
    else if (wouldReject) counts.false_positive_correct_year_rejected += 1;
    else if (candidateWrong) counts.false_negative_wrong_year_kept += 1;
    else counts.true_negative_correct_year_kept += 1;
  }
  const rejected = counts.true_positive_wrong_year_rejected + counts.false_positive_correct_year_rejected;
  const correct = counts.false_positive_correct_year_rejected + counts.true_negative_correct_year_kept;
  return {
    ...counts,
    rejection_precision: rejected ? counts.true_positive_wrong_year_rejected / rejected : null,
    false_positive_rate: correct ? counts.false_positive_correct_year_rejected / correct : null
  };
}

const stageOneItems = ledger.items.filter((item) => item.stage === "exhaustive_not_expressed");
const worldFamilies = new Set(["subject_or_name", "team_or_league", "year_or_season", "product_set_or_ip"]);
const worldAddressableUpperBound = stageOneItems.filter((item) => worldFamilies.has(item.structural_family));
const structuralFamilies = Object.fromEntries([...new Set(stageOneItems.map((item) => item.structural_family))]
  .map((family) => [family, stageOneItems.filter((item) => item.structural_family === family).length])
  .sort((left, right) => right[1] - left[1]));

const report = {
  schema_version: "world-compatibility-ranker-v1-replay-v1",
  authority: "evaluation_only_no_provider_no_production",
  production_promoted: false,
  decision: "STOP_HARD_REJECTION_HOLD_RANK_ONLY",
  sources: {
    canonical: canonicalPath,
    expression: expressionPath,
    loss_ledger: lossLedgerPath,
    constraint_snapshot_version: model.snapshot_version,
    constraint_snapshot_source_sha256: model.snapshot_source_sha256,
    source_card_count: model.source_card_count
  },
  validation: {
    canonical_cards: canonicalRows.length,
    expression_cards: expressionRows.length,
    same_asset_set: true,
    reference_used_as_ranker_input: false,
    provider_calls: 0,
    title_compositions: 0,
    title_mutations: 0,
    hard_rejections: Object.values(relationReplays).reduce((sum, row) => sum + row.hard_rejections, 0),
    candidate_value_mutations: Object.values(relationReplays).reduce((sum, row) => sum + row.value_mutations, 0),
    candidate_count_deltas: Object.values(relationReplays).reduce((sum, row) => sum + row.candidate_count_deltas, 0)
  },
  snapshot_quality: {
    relation_cardinalities: {
      player_years: Object.keys(model.player_years || {}).length,
      player_teams: Object.keys(model.player_teams || {}).length,
      player_team_years: Object.keys(model.player_team_years || {}).length,
      set_product_years: Object.keys(model.set_product_years || {}).length,
      product_years: Object.keys(model.product_years || {}).length,
      product_sports: Object.keys(model.product_sports || {}).length,
      ip_relations: Object.keys(model).filter((key) => /(^|_)ip(_|$)/i.test(key)).length
    },
    player_team_subject_share_of_player_year_subjects: Object.keys(model.player_teams || {}).length / Object.keys(model.player_years || {}).length,
    team_value_contract_present: Boolean(model.team_value_contract),
    edge_level_provenance_present: Boolean(model.edge_provenance || model.edge_contracts),
    known_ambiguous_or_non_team_labels: Object.fromEntries(knownAmbiguousTeamLabels.map((label) => [label, teamFrequency.get(label) || 0])),
    known_ambiguous_or_non_team_edge_count: knownAmbiguousTeamLabels.reduce((sum, label) => sum + (teamFrequency.get(label) || 0), 0),
    set_keys_with_one_product_across_all_years: singleProductSetKeys,
    set_keys_with_multiple_products_across_all_years: setEntries.length - singleProductSetKeys
  },
  fresh150_coverage: {
    subject_occurrences: subjectCoverage,
    ip_field_cards: ipFieldCards,
    product_enumerator_value_cards: productEnumeration.length,
    product_enumerator_values: productEnumeration,
    typed_set_candidate_counterfactual_cards: 0,
    typed_ip_candidate_counterfactual_cards: 0
  },
  hard_rejection_falsification: {
    subject_year: subjectYearHardRejectAudit(),
    product_year: productYearHardRejectAudit(),
    conclusion: "current absence is not contradiction; hard rejection is unsafe"
  },
  candidate_rank_replay: relationReplays,
  simple_controls: simpleControls,
  fresh150_exhaustive_loss_scope: {
    occurrences: stageOneItems.length,
    structural_families: structuralFamilies,
    identity_world_family_upper_bound_occurrences: worldAddressableUpperBound.length,
    identity_world_family_upper_bound_share: worldAddressableUpperBound.length / stageOneItems.length,
    warning: "rankers cannot recover an absent candidate; this is an addressability ceiling, not a recovery forecast"
  },
  historical_359_context: {
    source: "user_provided_historical_classification_not_recomputed_here",
    team_or_league: 5,
    year_or_number_mixed: 42,
    finish_color_attribute_rarity_subtotal: 133,
    product_or_set_incomplete: "inside_unquantified_other_bucket",
    warning: "most historical misses are not subject-team-year or product-set/IP ranking problems"
  },
  gates: {
    hard_reject: "STOP_missing_complete_edge_provenance_and_high_false_reject_rate",
    subject_team_year_rank: "STOP_negative_title_usefulness_replay",
    subject_year_rank: "HOLD_4_wins_0_losses_but_no_statistical_power",
    product_year_rank: "HOLD_positive_same_cohort_signal_requires_independent_unseen_candidate_replay",
    set_rank: "STOP_no_typed_counterfactual_and_current_enumerator_has_known_false_value",
    ip_rank: "STOP_no_local_relation",
    production: "STOP_evaluation_only"
  }
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  decision: report.decision,
  snapshot_version: report.sources.constraint_snapshot_version,
  relation_replays: Object.fromEntries(Object.entries(relationReplays).map(([key, row]) => [key, {
    eligible: row.eligible_multi_candidate_cards,
    changed: row.changed_top_candidate_cards,
    wins: row.wins,
    losses: row.losses,
    unchanged: row.unchanged,
    p: row.exact_two_sided_sign_p
  }])),
  hard_rejection_falsification: report.hard_rejection_falsification,
  out: outputPath,
  ranker_version: worldCompatibilityRankerVersion
}, null, 2));
