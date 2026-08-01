#!/usr/bin/env node

// Fresh-response confirmation for the five low-cost mechanisms that do not
// need an exhaustive observation arm. Serial replay is deliberately excluded
// until a targeted exact-observation cohort is complete.

import { readFileSync, writeFileSync } from "node:fs";
import { applyAccuracyMechanismV2 } from "../lib/listing/thin/accuracy-mechanism-bundle-v2.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const clean = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const tokens = (value) => clean(value).toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const score = (reference, title) => {
  const wanted = new Set(tokens(reference));
  const got = new Set(tokens(title));
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
  const wanted = new Set(tokens(reference));
  const beforeTokens = new Set(tokens(before));
  const afterTokens = new Set(tokens(after));
  return [...wanted].filter((token) => beforeTokens.has(token) && !afterTokens.has(token));
};

const inputPath = arg("--input", "artifacts/accuracy-mechanism-confirmatory-2026-08-02/fresh-budgeted-canonical/thin-path-gpt-5.6-luna.jsonl");
const out = arg("--out", "artifacts/accuracy-mechanism-confirmatory-2026-08-02/fresh-nonserial-confirmation.json");
const assetIdsPath = arg("--asset-ids-file", null);
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const input = rows(inputPath);
const selectedAssetIds = assetIdsPath
  ? JSON.parse(readFileSync(assetIdsPath, "utf8"))
  : null;
if (selectedAssetIds !== null && (!Array.isArray(selectedAssetIds)
    || selectedAssetIds.length !== limit
    || new Set(selectedAssetIds).size !== selectedAssetIds.length
    || selectedAssetIds.some((assetId) => typeof assetId !== "string" || !assetId.trim()))) {
  throw new Error("asset_ids_file_invalid");
}
const canonicalRows = input.filter((row) => row.arm === "thin_canonical_high" && row.fields);
const canonicalByAsset = new Map(canonicalRows.map((row) => [row.asset_id, row]));
const canonical = selectedAssetIds
  ? selectedAssetIds.map((assetId) => canonicalByAsset.get(assetId)).filter(Boolean)
  : canonicalRows.slice(0, limit);
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
if (canonical.length !== limit || canonical.some((row) => !freeByAsset.has(row.asset_id))) {
  throw new Error("paired_fresh_cohort_mismatch_or_too_small");
}

const mechanisms = [
  "finish_family_color_only",
  "rarity_sar_only",
  "printed_trainer_gallery",
  "printed_first_bowman",
  "product_known_manufacturer_extension",
  "bundle_without_serial"
];
const cards = canonical.map((row) => {
  const free = freeByAsset.get(row.asset_id);
  const freeFields = projectFreeTitleThroughCsm(free.title).fields;
  const baseline = composeFromCanonicalFields(row.fields);
  return { row, free, freeFields, baseline };
});

const applyCandidate = (name, card) => {
  if (name !== "bundle_without_serial") {
    return applyAccuracyMechanismV2(name, card.row.fields, {
      freeFields: card.freeFields,
      freeTitle: card.free.title,
      observations: []
    });
  }
  let fields = structuredClone(card.row.fields);
  for (const mechanism of mechanisms.slice(0, -1)) {
    fields = applyAccuracyMechanismV2(mechanism, fields, {
      freeFields: card.freeFields,
      freeTitle: card.free.title,
      observations: []
    }).fields;
  }
  return { fields, changed: JSON.stringify(fields) !== JSON.stringify(card.row.fields), bundle: "accuracy-mechanism-bundle-v2" };
};

const result = {};
for (const name of mechanisms) {
  const details = [];
  const deltas = [];
  for (const card of cards) {
    const candidate = applyCandidate(name, card);
    const output = composeFromCanonicalFields(candidate.fields);
    const delta = score(card.row.reference, output.title).f1 - score(card.row.reference, card.baseline.title).f1;
    deltas.push(delta);
    if (output.title !== card.baseline.title) {
      details.push({
        asset_id: card.row.asset_id,
        reference: card.row.reference,
        free_title: card.free.title,
        before: card.baseline.title,
        after: output.title,
        delta_f1: delta,
        reference_losses: referenceLosses(card.row.reference, card.baseline.title, output.title),
        over_80: output.title.length > 80
      });
    }
  }
  const safetyStop = deltas.some((value) => value < -1e-12)
    || details.some((detail) => detail.reference_losses.length || detail.over_80);
  result[name] = {
    baseline_macro_f1: mean(cards.map((card) => score(card.row.reference, card.baseline.title).f1)),
    candidate_macro_f1: mean(cards.map((card) => {
      const candidate = applyCandidate(name, card);
      return score(card.row.reference, composeFromCanonicalFields(candidate.fields).title).f1;
    })),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: details.length,
    reference_loss_cards: details.filter((detail) => detail.reference_losses.length).length,
    over_80_cards: details.filter((detail) => detail.over_80).length,
    status: safetyStop ? "STOP" : deltas.some((value) => value > 1e-12) ? "CONFIRMATION_CANDIDATE" : "NO_CHANGE",
    details
  };
}

const payload = {
  schema_version: "accuracy-mechanism-confirmatory-nonserial-v2",
  authority: "evaluation_only",
  claim_boundary: assetIdsPath
    ? "fresh_response_outside_development_subset_not_full_150_independent_confirmation"
    : "fresh_response_mixed_confirmation_not_independent_card_cohort",
  source: {
    inputPath,
    assetIdsPath,
    limit,
    arms: ["thin_budgeted", "thin_canonical_high"],
    serial_arm: "not_run"
  },
  result
};
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: payload.schema_version, out, result }, null, 2));
