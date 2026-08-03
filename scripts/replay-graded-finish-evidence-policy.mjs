#!/usr/bin/env node

// Zero-call screen: on a graded card, only a parallel name copied literally
// into parallel_exact may enter the title. Case glare and slab-label colours
// can still be preserved as observations, but may not become commerce facts.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const inputPath = resolve(process.argv[2]
  || "artifacts/accuracy-field-observation-v2-105-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const outPath = resolve(process.argv[3]
  || "artifacts/graded-finish-evidence-policy-replay-105-2026-08-03.json");
const rows = readFileSync(inputPath, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse)
  .filter((row) => row.arm === "thin_canonical_high" && row.fields);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const f1 = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
};

const cards = rows.map((row) => {
  const before = composeFromCanonicalFields(row.fields).title;
  const applies = Boolean(row.fields.grade && !row.fields.parallel_exact
    && (row.fields.surface_color || row.fields.parallel_family));
  const fields = applies ? {
    ...row.fields,
    surface_color: "",
    parallel_family: "",
    print_finish: ""
  } : row.fields;
  const after = composeFromCanonicalFields(fields).title;
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    before_title: before,
    after_title: after,
    delta_f1: f1(row.reference, after) - f1(row.reference, before),
    applies,
    observed_finish: row.fields.print_finish || "",
    literal_parallel: row.fields.parallel_exact || ""
  };
});
const changed = cards.filter((card) => card.before_title !== card.after_title);
const result = {
  schema_version: "graded-finish-evidence-policy-replay-v1",
  authority: "evaluation_only",
  production_promoted: false,
  cards: cards.length,
  changed_cards: changed.length,
  delta_macro_f1: cards.reduce((sum, card) => sum + card.delta_f1, 0) / cards.length,
  wins: changed.filter((card) => card.delta_f1 > 1e-12).length,
  losses: changed.filter((card) => card.delta_f1 < -1e-12).length,
  ties: changed.filter((card) => Math.abs(card.delta_f1) <= 1e-12).length,
  cards_detail: cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...result, cards_detail: undefined }, null, 2)}\n`);
