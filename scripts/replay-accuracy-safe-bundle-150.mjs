#!/usr/bin/env node

// Zero-provider-cost replay of the seven narrow mechanisms in bundle v3.
// The source rows are already-paid canonical/free/exhaustive observations.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  ACCURACY_MECHANISM_NAMES_V3,
  applyAccuracyMechanismV3,
  applyAccuracyMechanismBundleV3
} from "../lib/listing/thin/accuracy-mechanism-bundle-v3.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const sign = (deltas) => ({
  wins: deltas.filter((value) => value > 1e-12).length,
  losses: deltas.filter((value) => value < -1e-12).length,
  ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
});
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};
const changedFields = (before = {}, after = {}) => {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].sort().filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
};

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-150-2026-08-02.json");
const assetIdsPath = arg("--asset-ids-file", "");
const allowMissingObservations = process.argv.includes("--allow-missing-observations");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const input = rows(inputPath);
const canonicalRows = input.filter((row) => row.arm === "thin_canonical_high" && row.fields);
const selectedAssetIds = assetIdsPath
  ? JSON.parse(readFileSync(assetIdsPath, "utf8"))
  : canonicalRows.slice(0, limit).map((row) => row.asset_id);
if (!Array.isArray(selectedAssetIds) || new Set(selectedAssetIds).size !== selectedAssetIds.length) {
  throw new Error("asset_ids_file_must_be_unique_json_array");
}
const canonicalByAsset = new Map(canonicalRows.map((row) => [row.asset_id, row]));
const canonical = selectedAssetIds.map((assetId) => canonicalByAsset.get(assetId)).filter(Boolean).slice(0, limit);
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const observationsByAsset = new Map(rows(exhaustivePath)
  .filter((row) => row.arm === "exhaustive_observation_high")
  .map((row) => [row.asset_id, row.observations || []]));
const missingObservationAssets = canonical
  .map((row) => row.asset_id)
  .filter((assetId) => !observationsByAsset.has(assetId));
if (selectedAssetIds.length < limit || canonical.length !== limit
    || canonical.some((row) => !freeByAsset.has(row.asset_id))
    || (missingObservationAssets.length && !allowMissingObservations)) {
  throw new Error("paired_cohort_mismatch_or_too_small");
}

const cards = canonical.map((row) => {
  const free = freeByAsset.get(row.asset_id);
  const observations = observationsByAsset.get(row.asset_id) || [];
  const freeFields = projectFreeTitleThroughCsm(free.title).fields;
  const baseline = composeFromCanonicalFields(row.fields);
  const candidate = applyAccuracyMechanismBundleV3(row.fields, {
    freeFields,
    freeTitle: free.title,
    observations
  });
  const output = composeFromCanonicalFields(candidate.fields);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    candidate_title: output.title,
    baseline_score: score(row.reference, baseline.title),
    candidate_score: score(row.reference, output.title),
    delta_f1: score(row.reference, output.title).f1 - score(row.reference, baseline.title).f1,
    changes: candidate.changes,
    change_details: candidate.change_details,
    reference_losses: referenceLosses(row.reference, baseline.title, output.title),
    over_80: output.title.length > 80
  };
});

const baseline = mean(cards.map((card) => card.baseline_score.f1));
const candidate = mean(cards.map((card) => card.candidate_score.f1));
const deltas = cards.map((card) => card.delta_f1);
const fieldActionBreakdown = cards.reduce((counts, card) => {
  for (const change of card.change_details || []) {
    for (const field of change.fields || []) counts[field.field] = (counts[field.field] || 0) + 1;
  }
  return counts;
}, {});
const summary = {
  cards: cards.length,
  baseline_macro_f1: baseline,
  candidate_macro_f1: candidate,
  delta_macro_f1: candidate - baseline,
  ...sign(deltas),
  changed_cards: cards.filter((card) => card.changes.length).length,
  reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
  over_80: cards.filter((card) => card.over_80).length,
  field_actions: cards.reduce((sum, card) => sum + (card.change_details || []).reduce((inner, change) => inner + change.fields.length, 0), 0),
  field_actions_by_field: Object.fromEntries(Object.entries(fieldActionBreakdown).sort(([a], [b]) => a.localeCompare(b))),
  status: deltas.some((value) => value < -1e-12)
    || cards.some((card) => card.reference_losses.length || card.over_80)
    ? "STOP"
    : missingObservationAssets.length
      ? "PARTIAL_REPLAY"
      : deltas.some((value) => value > 1e-12) ? "REPLAY_CANDIDATE" : "NO_CHANGE"
};

const perMechanism = {};
for (const name of ACCURACY_MECHANISM_NAMES_V3) {
  const rowsForMechanism = canonical.map((row) => {
    const free = freeByAsset.get(row.asset_id);
    const observations = observationsByAsset.get(row.asset_id);
    const before = composeFromCanonicalFields(row.fields);
    const result = applyAccuracyMechanismV3(name, row.fields, {
      freeFields: projectFreeTitleThroughCsm(free.title).fields,
      freeTitle: free.title,
      observations
    });
    const after = composeFromCanonicalFields(result.fields);
    const beforeScore = score(row.reference, before.title);
    const afterScore = score(row.reference, after.title);
    return {
      delta_f1: afterScore.f1 - beforeScore.f1,
      changed: after.title !== before.title,
      field_actions: changedFields(row.fields, result.fields),
      reference_loss: referenceLosses(row.reference, before.title, after.title).length > 0,
      over_80: after.title.length > 80
    };
  });
  const mechanismDeltas = rowsForMechanism.map((row) => row.delta_f1);
  perMechanism[name] = {
    ...sign(mechanismDeltas),
    delta_macro_f1: mean(mechanismDeltas),
    changed_cards: rowsForMechanism.filter((row) => row.changed).length,
    field_actions: rowsForMechanism.reduce((sum, row) => sum + row.field_actions.length, 0),
    field_actions_by_field: Object.fromEntries(Object.entries(rowsForMechanism.reduce((counts, row) => {
      for (const field of row.field_actions) counts[field] = (counts[field] || 0) + 1;
      return counts;
    }, {})).sort(([a], [b]) => a.localeCompare(b))),
    reference_loss_cards: rowsForMechanism.filter((row) => row.reference_loss).length,
    over_80: rowsForMechanism.filter((row) => row.over_80).length
  };
}

const result = {
  schema_version: "accuracy-safe-bundle-replay-v1",
  evaluation_only: true,
  production_promoted: false,
  mechanisms: ACCURACY_MECHANISM_NAMES_V3,
  source: { inputPath, exhaustivePath, assetIdsPath: assetIdsPath || null, limit, canonical_arm: "thin_canonical_high", free_arm: "thin_budgeted", exhaustive_arm: "exhaustive_observation_high" },
  observation_coverage: {
    available_cards: limit - missingObservationAssets.length,
    missing_cards: missingObservationAssets.length,
    missing_allowed: allowMissingObservations
  },
  summary,
  per_mechanism: perMechanism,
  cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary, per_mechanism: perMechanism }, null, 2));
