#!/usr/bin/env node

// Zero-provider-cost, evaluation-only projection screen.
//
// The model output is already stored in the paired 150-card checkpoint. This
// script asks a narrower question than "merge free expression": which exact,
// source-shaped overlays can be admitted without replacing a canonical value?
// It never calls a provider and is never imported by the production path.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";
import { applyAccuracyMechanismV1 } from "../lib/listing/thin/accuracy-mechanism-bundle-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const clean = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const tokens = (value) => clean(value).toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const words = (value) => clean(value).split(/\s+/).filter(Boolean);
const same = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase();
const score = (reference, title) => {
  const wanted = new Set(tokens(reference));
  const got = new Set(tokens(title));
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
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
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

const finishFamily = /\b(?:refractor|prizm|prism|wave|mojo|shimmer|foil|holo|sparkle|speckle|vinyl|pulsar|raywave|parallel|cracked|ice)\b/i;
const KNOWN_MANUFACTURERS = new Set(["topps", "panini", "upper deck", "leaf"]);
const overlay = (fields, patch) => patch ? { ...fields, ...patch } : null;

function finishFamilyColorOnly(fields, freeFields) {
  const color = clean(fields.surface_color);
  const old = clean(fields.print_finish);
  const candidate = clean(freeFields.print_finish);
  if (!color || !same(old, color) || clean(fields.parallel_family)) return null;
  if (!candidate || same(candidate, old) || !candidate.toLowerCase().startsWith(`${color.toLowerCase()} `)) return null;
  if (!finishFamily.test(candidate)) return null;
  return { print_finish: candidate, parallel_exact: candidate };
}

function productEmpty(fields, freeFields) {
  return !clean(fields.product) && clean(freeFields.product) ? { product: freeFields.product } : null;
}

function productExtensionTwoPlus(fields, freeFields) {
  const old = words(fields.product);
  const candidate = words(freeFields.product);
  if (!old.length || candidate.length <= old.length) return null;
  const candidateText = candidate.join(" ").toLowerCase();
  if (!old.every((word) => candidateText.includes(word.toLowerCase()))) return null;
  return { product: freeFields.product };
}

function productKnownManufacturerExtension(fields, freeFields) {
  const manufacturer = words(fields.manufacturer);
  const old = words(fields.product);
  const candidate = words(freeFields.product);
  if (!manufacturer.length || !KNOWN_MANUFACTURERS.has(manufacturer.join(" ").toLowerCase())) return null;
  if (!old.length || candidate.length <= old.length) return null;
  if (candidate[0].toLowerCase() !== manufacturer[0].toLowerCase()) return null;
  const candidateText = candidate.join(" ").toLowerCase();
  if (!old.every((word) => candidateText.includes(word.toLowerCase()))) return null;
  return { product: freeFields.product };
}

function shortCardName(fields, freeFields) {
  const candidate = clean(freeFields.card_name);
  return !clean(fields.card_name) && candidate && words(candidate).length <= 2
    ? { card_name: candidate } : null;
}

function componentRc(fields, freeFields) {
  const hasCanonical = (fields.components || []).some((value) => same(value, "RC"));
  const hasCandidate = (freeFields.components || []).some((value) => same(value, "RC"));
  return !hasCanonical && hasCandidate
    ? { components: [...(fields.components || []), "RC"], attributes: [...(fields.attributes || []), "RC"] }
    : null;
}

function rarity(fields, freeFields, value) {
  return !clean(fields.descriptive_rarity) && same(freeFields.descriptive_rarity, value)
    ? { descriptive_rarity: value } : null;
}

function explicitFreeMarker(title, marker) {
  return new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "i").test(title);
}

function trainerGallery(fields, freeTitle) {
  return fields.grammar === "tcg" && !clean(fields.card_name) && explicitFreeMarker(freeTitle, "Trainer Gallery")
    ? { card_name: "Trainer Gallery" } : null;
}

function firstBowman(fields, freeTitle) {
  return /bowman/i.test(`${fields.product || ""} ${fields.set || ""}`)
    && !clean(fields.descriptive_rarity)
    && explicitFreeMarker(freeTitle, "1st Bowman")
    ? { descriptive_rarity: "1st Bowman" } : null;
}

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const out = arg("--out", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/gated-projection-screen.json");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const input = rows(inputPath);
const canonical = input.filter((row) => row.arm === "thin_canonical_high" && row.fields).slice(0, limit);
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const observationsByAsset = new Map(rows(exhaustivePath).map((row) => [row.asset_id, row.observations || []]));
if (canonical.length !== limit || canonical.some((row) => !freeByAsset.has(row.asset_id) || !observationsByAsset.has(row.asset_id))) {
  throw new Error("paired_cohort_mismatch_or_too_small");
}

const definitions = {
  finish_family_color_only: (fields, freeFields, observation, freeTitle) => applyAccuracyMechanismV1("finish_family_color_only", fields, { freeFields, observations: observation, freeTitle }).fields,
  serial_single_digit: (fields, freeFields, observation, freeTitle) => applyAccuracyMechanismV1("serial_single_digit", fields, { freeFields, observations: observation, freeTitle }).fields,
  rarity_sar_only: (fields, freeFields, observation, freeTitle) => applyAccuracyMechanismV1("rarity_sar_only", fields, { freeFields, observations: observation, freeTitle }).fields,
  printed_trainer_gallery: (fields, freeFields, observation, freeTitle) => applyAccuracyMechanismV1("printed_trainer_gallery", fields, { freeFields, observations: observation, freeTitle }).fields,
  printed_first_bowman: (fields, freeFields, observation, freeTitle) => applyAccuracyMechanismV1("printed_first_bowman", fields, { freeFields, observations: observation, freeTitle }).fields,
  finish_plus_serial: (fields, freeFields, observation) => {
    const withFinish = applyAccuracyMechanismV1("finish_family_color_only", fields, { freeFields }).fields;
    return applyAccuracyMechanismV1("serial_single_digit", withFinish, { observations: observation }).fields;
  },
  finish_plus_sar: (fields, freeFields) => {
    const withFinish = applyAccuracyMechanismV1("finish_family_color_only", fields, { freeFields }).fields;
    return applyAccuracyMechanismV1("rarity_sar_only", withFinish, { freeFields }).fields;
  },
  finish_plus_serial_plus_sar: (fields, freeFields, observation) => {
    const withFinish = applyAccuracyMechanismV1("finish_family_color_only", fields, { freeFields }).fields;
    const withRarity = applyAccuracyMechanismV1("rarity_sar_only", withFinish, { freeFields }).fields;
    return applyAccuracyMechanismV1("serial_single_digit", withRarity, { observations: observation }).fields;
  },
  finish_plus_serial_plus_sar_plus_printed_marks: (fields, freeFields, observation, freeTitle) => {
    let withOverlay = applyAccuracyMechanismV1("finish_family_color_only", fields, { freeFields }).fields;
    withOverlay = applyAccuracyMechanismV1("rarity_sar_only", withOverlay, { freeFields }).fields;
    withOverlay = applyAccuracyMechanismV1("printed_trainer_gallery", withOverlay, { freeTitle }).fields;
    withOverlay = applyAccuracyMechanismV1("printed_first_bowman", withOverlay, { freeTitle }).fields;
    withOverlay = applyAccuracyMechanismV1("product_known_manufacturer_extension", withOverlay, { freeFields }).fields;
    return applyAccuracyMechanismV1("serial_single_digit", withOverlay, { observations: observation }).fields;
  },
  product_empty_only: (fields, freeFields) => overlay(fields, productEmpty(fields, freeFields)),
  product_extension_two_plus: (fields, freeFields) => overlay(fields, productExtensionTwoPlus(fields, freeFields)),
  product_known_manufacturer_extension: (fields, freeFields) => applyAccuracyMechanismV1("product_known_manufacturer_extension", fields, { freeFields }).fields,
  card_name_short: (fields, freeFields) => overlay(fields, shortCardName(fields, freeFields)),
  component_rc: (fields, freeFields) => overlay(fields, componentRc(fields, freeFields)),
  rarity_ssp: (fields, freeFields) => overlay(fields, rarity(fields, freeFields, "SSP")),
  rarity_sp: (fields, freeFields) => overlay(fields, rarity(fields, freeFields, "SP"))
};

const cards = canonical.map((row) => {
  const free = freeByAsset.get(row.asset_id);
  const freeFields = projectFreeTitleThroughCsm(free.title).fields;
  const observations = observationsByAsset.get(row.asset_id);
  const baseline = composeFromCanonicalFields(row.fields);
  return { row, free, freeFields, observations, baseline };
});

const result = {};
for (const [name, apply] of Object.entries(definitions)) {
  const details = [];
  const deltas = [];
  for (const card of cards) {
    const candidate = apply(card.row.fields, card.freeFields, card.observations, card.free.title);
    const candidateFields = candidate && candidate.fields ? candidate.fields : candidate;
    const output = candidateFields ? composeFromCanonicalFields(candidateFields) : card.baseline;
    const delta = score(card.row.reference, output.title).f1 - score(card.row.reference, card.baseline.title).f1;
    deltas.push(delta);
    if (candidateFields && output.title !== card.baseline.title) {
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
    candidate_macro_f1: mean(cards.map((card, index) => score(card.row.reference,
      (() => {
        const applied = apply(card.row.fields, card.freeFields, card.observations, card.free.title);
        const fields = applied && applied.fields ? applied.fields : applied;
        return (fields ? composeFromCanonicalFields(fields) : card.baseline).title;
      })()).f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: details.length,
    reference_loss_cards: details.filter((detail) => detail.reference_losses.length).length,
    over_80_cards: details.filter((detail) => detail.over_80).length,
    status: safetyStop ? "STOP" : deltas.some((value) => value > 1e-12) ? "REPLAY_CANDIDATE" : "NO_CHANGE",
    details
  };
}

const payload = {
  schema_version: "accuracy-gated-projection-screen-v1",
  evaluation_only: true,
  source: { inputPath, exhaustivePath, limit },
  result
};
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: payload.schema_version, out, result }, null, 2));
