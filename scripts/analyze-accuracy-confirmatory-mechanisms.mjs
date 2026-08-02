#!/usr/bin/env node

// Offline, evaluation-only decomposition of a fresh paired canonical/free run.
// It never calls a provider and never mutates canonical fields in production.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { projectFreeTitleThroughCsm, mergeFreeEvidenceIntoCanonical } from "./measure-free-title-csm-projection.mjs";
import {
  replaySerialObservationV1,
  replaySerialObservationSingleDigitV1
} from "../lib/listing/thin/candidate-identity-replay-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const cleanTokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = cleanTokens(reference); const got = cleanTokens(title);
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
  const wanted = cleanTokens(reference); const beforeTokens = cleanTokens(before); const afterTokens = cleanTokens(after);
  return [...wanted].filter((token) => beforeTokens.has(token) && !afterTokens.has(token));
};

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const canonicalArm = arg("--canonical-arm", "thin_canonical_high");
const freeArm = arg("--free-arm", "thin_budgeted");
const limit = Number(arg("--limit", "150"));
const out = arg("--out", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/mechanism-decomposition.json");
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const input = rows(inputPath);
const canonical = input.filter((row) => row.arm === canonicalArm && row.fields).slice(0, limit);
const freeByAsset = new Map(input.filter((row) => row.arm === freeArm).map((row) => [row.asset_id, row]));
const observationByAsset = new Map(rows(exhaustivePath).map((row) => [row.asset_id, row.observations || []]));
if (canonical.length !== limit || canonical.some((row) => !freeByAsset.has(row.asset_id) || !observationByAsset.has(row.asset_id))) {
  throw new Error("paired_cohort_mismatch_or_too_small");
}

const cards = canonical.map((row) => {
  const observation = observationByAsset.get(row.asset_id);
  const baseline = composeFromCanonicalFields(row.fields);
  const free = projectFreeTitleThroughCsm(freeByAsset.get(row.asset_id).title);
  const productFields = mergeFreeEvidenceIntoCanonical(row.fields, free.fields, { only: ["product"] });
  const product = composeFromCanonicalFields(productFields);
  const serial = replaySerialObservationV1(row.fields, observation);
  const serialTitle = composeFromCanonicalFields(serial.fields);
  const serialSingle = replaySerialObservationSingleDigitV1(row.fields, observation);
  const serialSingleTitle = composeFromCanonicalFields(serialSingle.fields);
  const bothFields = replaySerialObservationV1(productFields, observation).fields;
  const both = composeFromCanonicalFields(bothFields);
  const make = (title) => score(row.reference, title);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    baseline_score: make(baseline.title),
    product_title: product.title,
    product_score: make(product.title),
    serial_title: serialTitle.title,
    serial_score: make(serialTitle.title),
    serial_single_digit_title: serialSingleTitle.title,
    serial_single_digit_score: make(serialSingleTitle.title),
    both_title: both.title,
    both_score: make(both.title),
    product_changes: product.title === baseline.title ? [] : [productFields.product],
    serial_changes: serial.changes,
    serial_single_digit_changes: serialSingle.changes,
    product_reference_losses: referenceLosses(row.reference, baseline.title, product.title),
    serial_reference_losses: referenceLosses(row.reference, baseline.title, serialTitle.title),
    serial_single_digit_reference_losses: referenceLosses(row.reference, baseline.title, serialSingleTitle.title),
    both_reference_losses: referenceLosses(row.reference, baseline.title, both.title),
    over_80: {
      product: product.title.length > 80,
      serial: serialTitle.title.length > 80,
      serial_single_digit: serialSingleTitle.title.length > 80,
      both: both.title.length > 80
    }
  };
});

const mechanisms = {
  product: "product_score",
  serial: "serial_score",
  serial_single_digit: "serial_single_digit_score",
  both: "both_score"
};
const summary = Object.fromEntries(Object.entries(mechanisms).map(([name, scoreKey]) => {
  const deltas = cards.map((card) => card[scoreKey].f1 - card.baseline_score.f1);
  const lossKey = `${name}_reference_losses`;
  return [name, {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card[scoreKey].f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: cards.filter((card) => card[scoreKey.replace("_score", "_title")] !== card.baseline_title).length,
    reference_loss_cards: cards.filter((card) => card[lossKey].length).length,
    over_80: cards.filter((card) => card.over_80[name]).length,
    status: deltas.some((value) => value < -1e-12) || cards.some((card) => card[lossKey].length)
      ? "STOP" : "candidate"
  }];
}));

const result = {
  schema_version: "accuracy-confirmatory-mechanism-decomposition-v1",
  source: { inputPath, exhaustivePath, canonicalArm, freeArm, limit },
  summary,
  cards
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out, summary }, null, 2));
