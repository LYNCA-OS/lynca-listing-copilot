#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const want = tokens(reference); const got = tokens(title);
  const hits = [...want].filter((token) => got.has(token)).length;
  const recall = want.size ? hits / want.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const sign = (deltas) => ({
  wins: deltas.filter((value) => value > 1e-12).length,
  losses: deltas.filter((value) => value < -1e-12).length,
  ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
});

const path = arg("--rows", "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
const arm = arg("--arm", "thin_canonical");
const limit = Number(arg("--limit", "150"));
const out = arg("--out", `artifacts/canonical-v3/composer-feature-ablation-${limit}.json`);
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const selected = rows(path).filter((row) => row.arm === arm && row.fields).slice(0, limit);
if (selected.length !== limit) throw new Error(`ablation_cohort_too_small:${selected.length}/${limit}`);

const features = Object.freeze({
  component_dedupe: "component_dedupe",
  product_hierarchy: "product_hierarchy",
  typed_identity: "typed_identity",
  slash_spacing: "slash_spacing"
});
const results = {};
for (const [name, key] of Object.entries(features)) {
  const cardResults = selected.map((row) => {
    const on = composeFromCanonicalFields(row.fields);
    const off = composeFromCanonicalFields(row.fields, { features: { [key]: false } });
    const onScore = score(row.reference, on.title);
    const offScore = score(row.reference, off.title);
    return {
      asset_id: row.asset_id,
      reference: row.reference,
      on_title: on.title,
      off_title: off.title,
      delta_f1: onScore.f1 - offScore.f1,
      on_score: onScore,
      off_score: offScore,
      changed: on.title !== off.title,
      over_80_on: on.title.length > 80,
      over_80_off: off.title.length > 80
    };
  });
  const deltas = cardResults.map((row) => row.delta_f1);
  results[name] = {
    feature: key,
    cards: cardResults.length,
    changed_cards: cardResults.filter((row) => row.changed).length,
    on_macro_f1: mean(cardResults.map((row) => row.on_score.f1)),
    off_macro_f1: mean(cardResults.map((row) => row.off_score.f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    over_80_on: cardResults.filter((row) => row.over_80_on).length,
    over_80_off: cardResults.filter((row) => row.over_80_off).length,
    cards_detail: cardResults.filter((row) => row.changed)
  };
}

const result = {
  schema_version: "canonical-composer-feature-ablation-v1",
  source: { path, arm, limit },
  results
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out, results: Object.fromEntries(
  Object.entries(results).map(([name, value]) => [name, {
    cards: value.cards,
    changed_cards: value.changed_cards,
    delta_macro_f1: value.delta_macro_f1,
    wins: value.wins,
    losses: value.losses,
    ties: value.ties,
    over_80_on: value.over_80_on
  }])
) }, null, 2));
