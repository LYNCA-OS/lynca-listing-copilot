#!/usr/bin/env node

// Zero-provider-cost cross-run replay for the gated free-expression overlays.
// This deliberately excludes serial observations: the older paired checkpoint
// has no exhaustive arm. It is a stability screen, not an independent-card
// confirmation and never touches the production route.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyMechanismV1 } from "../lib/listing/thin/accuracy-mechanism-bundle-v1.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const loadRows = (path) => readFileSync(path, "utf8")
  .split(/\r?\n/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[^a-z0-9/']+/).filter(Boolean));
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

const inputPath = arg("--input", "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
const canonicalArm = arg("--canonical-arm", "thin_canonical");
const freeArm = arg("--free-arm", "thin_budgeted");
const outPath = arg("--out", "artifacts/canonical-v3/gated-projections-cross-run.json");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const rows = loadRows(inputPath);
const canonicalByAsset = new Map(rows
  .filter((row) => row.arm === canonicalArm && row.fields)
  .map((row) => [row.asset_id, row]));
const freeByAsset = new Map(rows
  .filter((row) => row.arm === freeArm)
  .map((row) => [row.asset_id, row]));
const canonical = [...canonicalByAsset.values()].slice(0, limit);
if (canonical.length !== limit || canonical.some((row) => !freeByAsset.has(row.asset_id))) {
  throw new Error("paired_cohort_mismatch_or_too_small");
}

const mechanismNames = [
  "finish_family_color_only",
  "rarity_sar_only",
  "printed_trainer_gallery",
  "printed_first_bowman",
  "product_known_manufacturer_extension"
];
const apply = (name, fields, freeFields, freeTitle) => applyAccuracyMechanismV1(name, fields, {
  freeFields, freeTitle
}).fields;
const cards = canonical.map((row) => {
  const free = freeByAsset.get(row.asset_id);
  const freeFields = projectFreeTitleThroughCsm(free.title).fields;
  const baseline = composeFromCanonicalFields(row.fields);
  const rowsByMechanism = {};
  for (const name of mechanismNames) {
    const fields = apply(name, row.fields, freeFields, free.title);
    const output = composeFromCanonicalFields(fields);
    rowsByMechanism[name] = {
      title: output.title,
      score: score(row.reference, output.title),
      changed: output.title !== baseline.title,
      reference_losses: referenceLosses(row.reference, baseline.title, output.title),
      over_80: output.title.length > 80
    };
  }
  let bundleFields = row.fields;
  for (const name of mechanismNames) bundleFields = apply(name, bundleFields, freeFields, free.title);
  const bundle = composeFromCanonicalFields(bundleFields);
  rowsByMechanism.bundle = {
    title: bundle.title,
    score: score(row.reference, bundle.title),
    changed: bundle.title !== baseline.title,
    reference_losses: referenceLosses(row.reference, baseline.title, bundle.title),
    over_80: bundle.title.length > 80
  };
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    baseline_score: score(row.reference, baseline.title),
    mechanisms: rowsByMechanism
  };
});

const names = [...mechanismNames, "bundle"];
const summary = Object.fromEntries(names.map((name) => {
  const deltas = cards.map((card) => card.mechanisms[name].score.f1 - card.baseline_score.f1);
  const changed = cards.filter((card) => card.mechanisms[name].changed);
  return [name, {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card.mechanisms[name].score.f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: changed.length,
    reference_loss_cards: changed.filter((card) => card.mechanisms[name].reference_losses.length).length,
    over_80_cards: changed.filter((card) => card.mechanisms[name].over_80).length,
    status: deltas.some((value) => value < -1e-12)
      || changed.some((card) => card.mechanisms[name].reference_losses.length || card.mechanisms[name].over_80)
      ? "STOP" : deltas.some((value) => value > 1e-12) ? "REPLAY_CANDIDATE" : "NO_CHANGE"
  }];
}));

const result = {
  schema_version: "gated-projections-cross-run-replay-v1",
  authority: "evaluation_only",
  production_promoted: false,
  claim_boundary: "same_card_cross_run_stability_screen_not_independent_150_confirmation",
  source: { inputPath, canonicalArm, freeArm, limit, serial_observations: "not_run" },
  mechanisms: mechanismNames,
  summary,
  cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary }, null, 2));
