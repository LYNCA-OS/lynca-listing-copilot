#!/usr/bin/env node

// Deterministic, zero-provider-cost replay of the schema73 overlay on the
// already-paid 150-card canonical/free/exhaustive checkpoints.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyExpressionOverlayV1 } from "../lib/listing/thin/accuracy-expression-overlay-v1.mjs";
import {
  ACCURACY_SCHEMA73_MECHANISMS,
  applyAccuracySchema73MechanismV1,
  applyAccuracySchema73OverlayV1
} from "../lib/listing/thin/accuracy-schema73-overlay-v1.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const readRows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (path) => sha256(readFileSync(path));
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

function score(reference, title) {
  const wanted = tokens(reference);
  const got = tokens(title);
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

function referenceLosses(reference, before, after) {
  const wanted = tokens(reference);
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
}

function flattenChanges(changes = []) {
  return changes.flatMap((change) => change.details || []);
}

function sanctionedTitleLossTokens(changes = []) {
  return new Set(flattenChanges(changes).flatMap((change) => [
    ...(change.same_numeric_value ? [...tokens(change.before)] : []),
    ...(change.sanctioned_title_losses || [])
  ]));
}

function allTitleTokenLosses(before, after) {
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  return [...oldTokens].filter((token) => !newTokens.has(token));
}

function titleTokenLosses(before, after, changes = []) {
  const sanctioned = sanctionedTitleLossTokens(changes);
  return allTitleTokenLosses(before, after).filter((token) => !sanctioned.has(token));
}

function sanctionedTitleTokenLosses(before, after, changes = []) {
  const sanctioned = sanctionedTitleLossTokens(changes);
  return allTitleTokenLosses(before, after).filter((token) => sanctioned.has(token));
}

function unbackedNumericAdditions(before, after, changes = []) {
  const oldTokens = tokens(before);
  const sourceTokens = tokens(flattenChanges(changes)
    .map((change) => change.source?.evidence || "").join(" "));
  return [...tokens(after)]
    .filter((token) => /\d/.test(token) && !oldTokens.has(token) && !sourceTokens.has(token));
}

function serialParts(value) {
  const match = clean(value).replace(/\s*\/\s*/g, "/").match(/^(\d{1,5})\/(\d{1,5})$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function serialNumericMutation(beforeFields, afterFields) {
  if (clean(beforeFields.serial) === clean(afterFields.serial)) return false;
  const before = serialParts(beforeFields.serial);
  const after = serialParts(afterFields.serial);
  return !before || !after || before[0] !== after[0] || before[1] !== after[1];
}

function factsFromObservations(observations = []) {
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

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [String(value ?? "")];
}

const OLD_DIRECT_OCCURRENCES = Object.freeze([
  ["dfba61396ec82f2b864e", "19"], ["3c690ab7d28f6c3d3e89", "fc"],
  ["3215d29874a3dad22bbb", "nbl"], ["8541091b7125268e2d05", "ultra"],
  ["a38ced8b163264d9d95a", "21"], ["72e1bdac368317a7c3b1", "graphite"],
  ["89cde2e9bc69a6edb4fd", "kings"], ["46be33ef1f2dbc0956af", "los"],
  ["46be33ef1f2dbc0956af", "angeles"], ["f371844dc1d0c6e49f92", "star"],
  ["f371844dc1d0c6e49f92", "wars"], ["d3bcbaa288c732ffed37", "disney"],
  ["940144961215fef91c18", "5"], ["940144961215fef91c18", "pick"],
  ["940144961215fef91c18", "2"], ["940144961215fef91c18", "027/150"],
  ["bc9654d83b13db44d507", "kc"], ["12f2d135218a7ca35d3e", "derby"],
  ["8b3024b5cc435830e80c", "throwback"], ["316c9c2012386b0a64ed", "jersey"],
  ["c279329f2f78d7f65071", "19"], ["5578954f2c4a40caf3bc", "5/5"],
  ["6683a671093f786a0948", "jersey"], ["b514a8918dbc221a17bd", "los"],
  ["b514a8918dbc221a17bd", "angeles"], ["d768c8f01fbfdd779bb0", "1st"],
  ["c6ecb08d49256335aa6b", "1st"], ["4c8131eeda536c66d385", "redemption"],
  ["4c8131eeda536c66d385", "card"], ["ee03ba06dd634655b4ba", "kaboom"],
  ["ee03ba06dd634655b4ba", "horizontal"], ["8922f71c190ac8dbeca8", "disney"],
  ["c4905891fd0ed7eb8308", "draft"], ["7059d3b39d01402f0e61", "veefriends"],
  ["89e97f6cf6442bdbc497", "04/25"], ["1f3be5eca26948c10405", "038/220"],
  ["8cabcafd0596fbab0bb0", "optic"]
]);

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "docs/evaluation/accuracy-schema73-overlay-v1-replay-150-2026-08-02.json");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit !== 150) throw new Error("schema73_replay_requires_exactly_150_cards");

const inputBody = readFileSync(inputPath);
const exhaustiveBody = readFileSync(exhaustivePath);
const inputRows = readRows(inputPath);
const exhaustiveRows = readRows(exhaustivePath).filter((row) => row.arm === "exhaustive_observation_high");
const canonical = inputRows.filter((row) => row.arm === "thin_canonical_high" && row.fields);
const free = inputRows.filter((row) => row.arm === "thin_budgeted");
const unique = (rows) => new Set(rows.map((row) => row.asset_id)).size === rows.length;
if (canonical.length !== limit || free.length !== limit || exhaustiveRows.length !== limit
    || !unique(canonical) || !unique(free) || !unique(exhaustiveRows)) {
  throw new Error("schema73_replay_cohort_count_or_uniqueness_mismatch");
}

const canonicalIds = new Set(canonical.map((row) => row.asset_id));
const canonicalByAsset = new Map(canonical.map((row) => [row.asset_id, row]));
const freeByAsset = new Map(free.map((row) => [row.asset_id, row]));
const exhaustiveByAsset = new Map(exhaustiveRows.map((row) => [row.asset_id, row]));
if (free.some((row) => !canonicalIds.has(row.asset_id))
    || exhaustiveRows.some((row) => !canonicalIds.has(row.asset_id))
    || canonical.some((row) => !freeByAsset.has(row.asset_id) || !exhaustiveByAsset.has(row.asset_id))) {
  throw new Error("schema73_replay_asset_set_mismatch");
}

const cards = canonical.map((row) => {
  const freeRow = freeByAsset.get(row.asset_id);
  const diagnostic = exhaustiveByAsset.get(row.asset_id);
  const observations = diagnostic.observations || [];
  const expression = projectFreeTitleThroughCsm(freeRow.title);
  const prior = applyAccuracyExpressionOverlayV1(row.fields, {
    expressionFields: expression.fields,
    expressionTitle: freeRow.title,
    candidateFacts: factsFromObservations(observations),
    observations
  });

  let cumulativeFields = structuredClone(prior.fields);
  const stages = {};
  for (const name of ACCURACY_SCHEMA73_MECHANISMS) {
    const applied = applyAccuracySchema73MechanismV1(name, cumulativeFields, { observations });
    cumulativeFields = applied.fields;
    stages[name] = {
      title: composeFromCanonicalFields(cumulativeFields).title,
      fields: structuredClone(cumulativeFields),
      changes: applied.changes
    };
  }
  const overlay = applyAccuracySchema73OverlayV1(prior.fields, { observations });
  const candidate = composeFromCanonicalFields(overlay.fields);
  const priorScore = score(row.reference, prior.composed.title);
  const candidateScore = score(row.reference, candidate.title);

  return {
    asset_id: row.asset_id,
    reference: row.reference,
    canonical_title: composeFromCanonicalFields(row.fields).title,
    prior_overlay_title: prior.composed.title,
    candidate_title: candidate.title,
    prior_score: priorScore,
    candidate_score: candidateScore,
    delta_f1: candidateScore.f1 - priorScore.f1,
    changes: overlay.changes,
    reference_losses: referenceLosses(row.reference, prior.composed.title, candidate.title),
    sanctioned_title_token_losses: sanctionedTitleTokenLosses(prior.composed.title, candidate.title, overlay.changes),
    unrelated_title_token_losses: titleTokenLosses(prior.composed.title, candidate.title, overlay.changes),
    unbacked_numeric_additions: unbackedNumericAdditions(prior.composed.title, candidate.title, overlay.changes),
    serial_numeric_mutation: serialNumericMutation(prior.fields, overlay.fields),
    over_80: candidate.title.length > 80,
    stages,
    exhaustive_observations: observations
  };
});

function stageSummary(beforeTitle, afterTitle, beforeFields, afterFields, changes) {
  const rows = cards.map((card) => {
    const before = beforeTitle(card);
    const after = afterTitle(card);
    const delta = score(card.reference, after).f1 - score(card.reference, before).f1;
    const rowChanges = changes(card);
    return {
      delta,
      changed: before !== after,
      reference_losses: referenceLosses(card.reference, before, after),
      sanctioned_title_losses: sanctionedTitleTokenLosses(before, after, rowChanges),
      title_losses: titleTokenLosses(before, after, rowChanges),
      unbacked_numeric: unbackedNumericAdditions(before, after, rowChanges),
      numeric_mutation: serialNumericMutation(beforeFields(card), afterFields(card)),
      over_80: after.length > 80
    };
  });
  const deltas = rows.map((row) => row.delta);
  const summary = {
    ...sign(deltas),
    delta_macro_f1: mean(deltas),
    changed_cards: rows.filter((row) => row.changed).length,
    reference_loss_cards: rows.filter((row) => row.reference_losses.length).length,
    sanctioned_title_token_loss_cards: rows.filter((row) => row.sanctioned_title_losses.length).length,
    sanctioned_title_token_losses: rows.reduce((sum, row) => sum + row.sanctioned_title_losses.length, 0),
    unrelated_title_token_loss_cards: rows.filter((row) => row.title_losses.length).length,
    unbacked_numeric_addition_cards: rows.filter((row) => row.unbacked_numeric.length).length,
    serial_numeric_mutation_cards: rows.filter((row) => row.numeric_mutation).length,
    over_80_cards: rows.filter((row) => row.over_80).length
  };
  summary.status = summary.losses || summary.reference_loss_cards
    || summary.unrelated_title_token_loss_cards || summary.unbacked_numeric_addition_cards
    || summary.serial_numeric_mutation_cards || summary.over_80_cards
    ? "STOP"
    : summary.wins ? "REPLAY_CANDIDATE" : "NO_CHANGE";
  return summary;
}

// Isolate every new mechanism on top of the current expression overlay.
const perMechanism = {};
for (const name of ACCURACY_SCHEMA73_MECHANISMS) {
  const rows = cards.map((card) => {
    const canonicalRow = canonicalByAsset.get(card.asset_id);
    const freeRow = freeByAsset.get(card.asset_id);
    const observations = card.exhaustive_observations;
    const expression = projectFreeTitleThroughCsm(freeRow.title);
    const prior = applyAccuracyExpressionOverlayV1(canonicalRow.fields, {
      expressionFields: expression.fields,
      expressionTitle: freeRow.title,
      candidateFacts: factsFromObservations(observations),
      observations
    });
    const applied = applyAccuracySchema73MechanismV1(name, prior.fields, { observations });
    const after = composeFromCanonicalFields(applied.fields).title;
    const wrappedChanges = applied.changes.length ? [{ mechanism: name, details: applied.changes }] : [];
    return {
      delta: score(card.reference, after).f1 - score(card.reference, prior.composed.title).f1,
      changed: after !== prior.composed.title,
      reference_losses: referenceLosses(card.reference, prior.composed.title, after),
      sanctioned_title_losses: sanctionedTitleTokenLosses(prior.composed.title, after, wrappedChanges),
      title_losses: titleTokenLosses(prior.composed.title, after, wrappedChanges),
      unbacked_numeric: unbackedNumericAdditions(prior.composed.title, after, wrappedChanges),
      numeric_mutation: serialNumericMutation(prior.fields, applied.fields),
      over_80: after.length > 80
    };
  });
  const deltas = rows.map((row) => row.delta);
  perMechanism[name] = {
    ...sign(deltas),
    delta_macro_f1: mean(deltas),
    changed_cards: rows.filter((row) => row.changed).length,
    reference_loss_cards: rows.filter((row) => row.reference_losses.length).length,
    sanctioned_title_token_loss_cards: rows.filter((row) => row.sanctioned_title_losses.length).length,
    sanctioned_title_token_losses: rows.reduce((sum, row) => sum + row.sanctioned_title_losses.length, 0),
    unrelated_title_token_loss_cards: rows.filter((row) => row.title_losses.length).length,
    unbacked_numeric_addition_cards: rows.filter((row) => row.unbacked_numeric.length).length,
    serial_numeric_mutation_cards: rows.filter((row) => row.numeric_mutation).length,
    over_80_cards: rows.filter((row) => row.over_80).length
  };
  perMechanism[name].status = perMechanism[name].losses
    || perMechanism[name].reference_loss_cards
    || perMechanism[name].unrelated_title_token_loss_cards
    || perMechanism[name].unbacked_numeric_addition_cards
    || perMechanism[name].serial_numeric_mutation_cards
    || perMechanism[name].over_80_cards
    ? "STOP"
    : perMechanism[name].wins ? "REPLAY_CANDIDATE" : "NO_CHANGE";
}

const priorMacroF1 = mean(cards.map((card) => card.prior_score.f1));
const candidateMacroF1 = mean(cards.map((card) => card.candidate_score.f1));
const canonicalMacroF1 = mean(cards.map((card) => score(card.reference, card.canonical_title).f1));
const candidateVsCanonicalDeltas = cards.map((card) => card.candidate_score.f1
  - score(card.reference, card.canonical_title).f1);
const combined = stageSummary(
  (card) => card.prior_overlay_title,
  (card) => card.candidate_title,
  (card) => {
    const row = canonicalByAsset.get(card.asset_id);
    const freeRow = freeByAsset.get(card.asset_id);
    const expression = projectFreeTitleThroughCsm(freeRow.title);
    return applyAccuracyExpressionOverlayV1(row.fields, {
      expressionFields: expression.fields,
      expressionTitle: freeRow.title,
      candidateFacts: factsFromObservations(card.exhaustive_observations),
      observations: card.exhaustive_observations
    }).fields;
  },
  (card) => card.stages.typed_exact_admission.fields,
  (card) => card.changes
);
combined.prior_overlay_macro_f1 = priorMacroF1;
combined.candidate_macro_f1 = candidateMacroF1;
combined.delta_macro_f1 = candidateMacroF1 - priorMacroF1;
combined.canonical_macro_f1 = canonicalMacroF1;
combined.delta_vs_canonical_macro_f1 = candidateMacroF1 - canonicalMacroF1;
combined.vs_canonical = sign(candidateVsCanonicalDeltas);
combined.field_actions = cards.reduce((sum, card) => sum + flattenChanges(card.changes).length, 0);
combined.field_actions_by_field = cards.reduce((counts, card) => {
  for (const change of flattenChanges(card.changes)) {
    counts[change.field] = (counts[change.field] || 0) + 1;
  }
  return counts;
}, {});

const cardBySuffix = (suffix) => cards.find((card) => card.asset_id.endsWith(suffix));
const oldDirectLedger = OLD_DIRECT_OCCURRENCES.map(([assetSuffix, token]) => {
  const card = cardBySuffix(assetSuffix);
  if (!card) throw new Error(`old_direct_asset_missing:${assetSuffix}`);
  const canonicalHas = tokens(card.canonical_title).has(token);
  const priorHas = tokens(card.prior_overlay_title).has(token);
  const candidateHas = tokens(card.candidate_title).has(token);
  const observationHas = tokens(card.exhaustive_observations.map((row) => row.evidence).join(" ")).has(token);
  const canonicalRow = canonicalByAsset.get(card.asset_id);
  const canonicalFieldHas = tokens(values(canonicalRow.fields).join(" ")).has(token);
  let status;
  let recoveredBy = null;
  if (canonicalHas) status = "already_in_fresh_canonical";
  else if (priorHas) status = "prior_expression_overlay_recovery";
  else if (candidateHas) {
    status = "schema73_new_recovery";
    recoveredBy = ACCURACY_SCHEMA73_MECHANISMS.find((name) => tokens(card.stages[name].title).has(token)) || null;
  } else if (!observationHas) status = "exhaustive_no_longer_expressed";
  else if (canonicalFieldHas) status = "downstream_composition";
  else status = "schema_compression_remaining";
  return { asset_id: card.asset_id, token, status, recovered_by: recoveredBy };
});

const oldDirectStatus = oldDirectLedger.reduce((counts, row) => {
  counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}, {});

const result = {
  schema_version: "accuracy-schema73-overlay-v1-replay-150",
  authority: "evaluation_only",
  production_promoted: false,
  provider_calls: 0,
  source: {
    input_path: inputPath,
    exhaustive_path: exhaustivePath,
    input_sha256: sha256(inputBody),
    exhaustive_sha256: sha256(exhaustiveBody),
    cohort_sha256: sha256([...canonicalIds].sort().join("\n")),
    overlay_sha256: fileSha256(new URL("../lib/listing/thin/accuracy-schema73-overlay-v1.mjs", import.meta.url)),
    prior_overlay_sha256: fileSha256(new URL("../lib/listing/thin/accuracy-expression-overlay-v1.mjs", import.meta.url)),
    replay_script_sha256: fileSha256(new URL("./replay-accuracy-schema73-overlay-v1.mjs", import.meta.url)),
    cards: limit,
    arms: ["thin_canonical_high", "thin_budgeted", "exhaustive_observation_high"]
  },
  mechanisms: ACCURACY_SCHEMA73_MECHANISMS,
  summary: combined,
  per_mechanism: perMechanism,
  old_direct_37: {
    total_occurrences: OLD_DIRECT_OCCURRENCES.length,
    status_counts: oldDirectStatus,
    newly_recovered_occurrences: oldDirectLedger.filter((row) => row.status === "schema73_new_recovery").length,
    ledger: oldDirectLedger
  },
  cards: cards.map(({ exhaustive_observations, stages, ...card }) => ({
    ...card,
    stage_titles: Object.fromEntries(Object.entries(stages).map(([name, stage]) => [name, stage.title])),
    stage_changes: Object.fromEntries(Object.entries(stages).map(([name, stage]) => [name, stage.changes]))
  }))
};

writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  schema_version: result.schema_version,
  out: outPath,
  summary: result.summary,
  per_mechanism: result.per_mechanism,
  old_direct_37: {
    status_counts: result.old_direct_37.status_counts,
    newly_recovered_occurrences: result.old_direct_37.newly_recovered_occurrences
  }
}, null, 2));
