#!/usr/bin/env node

// Paired, targeted confirmation of the single-digit leading-zero serial rule.
// The cohort is selected from canonical output before reading sealed labels;
// exhaustive observations are used only for these 23 cards.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { replaySerialObservationSingleDigitV1 } from "../lib/listing/thin/candidate-identity-replay-v1.mjs";

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

const canonicalPath = arg("--canonical", "artifacts/accuracy-mechanism-confirmatory-2026-08-02/fresh-budgeted-canonical/thin-path-gpt-5.6-luna.jsonl");
const observationsPath = arg("--observations", "artifacts/accuracy-mechanism-confirmatory-2026-08-02/serial-exhaustive/thin-path-gpt-5.6-luna.jsonl");
const cohortPath = arg("--cohort", "artifacts/accuracy-mechanism-confirmatory-2026-08-02/serial-confirmatory.asset-ids.json");
const out = arg("--out", "artifacts/accuracy-mechanism-confirmatory-2026-08-02/serial-confirmation.json");

const canonicalRows = rows(canonicalPath);
const observationsByAsset = new Map(rows(observationsPath).map((row) => [row.asset_id, row.observations || []]));
const cohort = JSON.parse(readFileSync(cohortPath, "utf8"));
const cards = cohort.map((assetId) => {
  const row = canonicalRows.find((candidate) => candidate.asset_id === assetId && candidate.arm === "thin_canonical_high");
  if (!row) throw new Error(`canonical_row_missing:${assetId}`);
  const before = composeFromCanonicalFields(row.fields);
  const replay = replaySerialObservationSingleDigitV1(row.fields, observationsByAsset.get(assetId) || []);
  const after = composeFromCanonicalFields(replay.fields);
  return {
    asset_id: assetId,
    reference: row.reference,
    before: before.title,
    after: after.title,
    delta_f1: score(row.reference, after.title).f1 - score(row.reference, before.title).f1,
    changed: replay.changes.length > 0,
    changes: replay.changes,
    over_80: after.title.length > 80
  };
});
const deltas = cards.map((card) => card.delta_f1);
const result = {
  schema_version: "serial-accuracy-confirmation-v1",
  authority: "evaluation_only",
  source: { canonicalPath, observationsPath, cohortPath, cards: cards.length },
  baseline_macro_f1: mean(cards.map((card) => score(card.reference, card.before).f1)),
  candidate_macro_f1: mean(cards.map((card) => score(card.reference, card.after).f1)),
  delta_macro_f1: mean(deltas),
  ...sign(deltas),
  changed_cards: cards.filter((card) => card.changed).length,
  over_80_cards: cards.filter((card) => card.over_80).length,
  status: deltas.some((value) => value < -1e-12) || cards.some((card) => card.over_80)
    ? "STOP" : deltas.some((value) => value > 1e-12) ? "CONFIRMATION_CANDIDATE" : "NO_CHANGE",
  cards
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
