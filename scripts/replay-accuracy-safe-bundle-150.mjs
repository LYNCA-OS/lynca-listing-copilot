#!/usr/bin/env node

// Zero-provider-cost replay of the six narrow mechanisms in bundle v3.
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

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-150-2026-08-02.json");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const input = rows(inputPath);
const canonical = input.filter((row) => row.arm === "thin_canonical_high" && row.fields).slice(0, limit);
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const observationsByAsset = new Map(rows(exhaustivePath)
  .filter((row) => row.arm === "exhaustive_observation_high")
  .map((row) => [row.asset_id, row.observations || []]));
if (canonical.length !== limit || canonical.some((row) => !freeByAsset.has(row.asset_id) || !observationsByAsset.has(row.asset_id))) {
  throw new Error("paired_cohort_mismatch_or_too_small");
}

const cards = canonical.map((row) => {
  const free = freeByAsset.get(row.asset_id);
  const observations = observationsByAsset.get(row.asset_id);
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
    reference_losses: referenceLosses(row.reference, baseline.title, output.title),
    over_80: output.title.length > 80
  };
});

const baseline = mean(cards.map((card) => card.baseline_score.f1));
const candidate = mean(cards.map((card) => card.candidate_score.f1));
const deltas = cards.map((card) => card.delta_f1);
const summary = {
  cards: cards.length,
  baseline_macro_f1: baseline,
  candidate_macro_f1: candidate,
  delta_macro_f1: candidate - baseline,
  ...sign(deltas),
  changed_cards: cards.filter((card) => card.changes.length).length,
  reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
  over_80: cards.filter((card) => card.over_80).length,
  status: deltas.some((value) => value < -1e-12)
    || cards.some((card) => card.reference_losses.length || card.over_80)
    ? "STOP"
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
      reference_loss: referenceLosses(row.reference, before.title, after.title).length > 0,
      over_80: after.title.length > 80
    };
  });
  const mechanismDeltas = rowsForMechanism.map((row) => row.delta_f1);
  perMechanism[name] = {
    ...sign(mechanismDeltas),
    delta_macro_f1: mean(mechanismDeltas),
    changed_cards: rowsForMechanism.filter((row) => row.changed).length,
    reference_loss_cards: rowsForMechanism.filter((row) => row.reference_loss).length,
    over_80: rowsForMechanism.filter((row) => row.over_80).length
  };
}

const result = {
  schema_version: "accuracy-safe-bundle-replay-v1",
  evaluation_only: true,
  production_promoted: false,
  mechanisms: ACCURACY_MECHANISM_NAMES_V3,
  source: { inputPath, exhaustivePath, limit, canonical_arm: "thin_canonical_high", free_arm: "thin_budgeted", exhaustive_arm: "exhaustive_observation_high" },
  summary,
  per_mechanism: perMechanism,
  cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary, per_mechanism: perMechanism }, null, 2));
