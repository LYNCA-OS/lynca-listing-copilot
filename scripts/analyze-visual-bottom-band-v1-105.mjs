#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const INPUT = resolve("artifacts/accuracy-visual-bottom-band-v1-105-2026-08-02/provider/thin-path-gpt-5.6-luna.jsonl");
const OUTPUT = resolve("artifacts/accuracy-visual-bottom-band-v1-105-2026-08-02/analysis.json");
const CONTROL = "thin_canonical_high";
const TREATMENT = "thin_canonical_visual_bottom_band_v1_high";
const FIELDS = [
  "year", "manufacturer", "product", "set", "subjects", "team", "card_name", "release_variant",
  "surface_color", "parallel_family", "parallel_exact", "print_finish", "descriptive_rarity",
  "card_number", "serial", "attributes", "grade", "grammar", "lot_count", "components"
];

const tokenise = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9/]+/g, " ").split(/\s+/).filter(Boolean));

const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten) : [value];
const fieldTokens = (value) => new Set(flatten(value).flatMap((part) => [...tokenise(part)]));
const referenceTokens = (value) => tokenise(value);

function fieldHitCount(value, reference) {
  const wanted = referenceTokens(reference);
  return [...fieldTokens(value)].filter((token) => wanted.has(token)).length;
}

function mean(rows, key) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(rows, key) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : null;
}

function pct(value) { return Number((value * 100).toFixed(2)); }

function main() {
  const rows = readFileSync(INPUT, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const controls = new Map(rows.filter((row) => row.arm === CONTROL).map((row) => [row.asset_id, row]));
  const treatments = new Map(rows.filter((row) => row.arm === TREATMENT).map((row) => [row.asset_id, row]));
  if (controls.size !== 105 || treatments.size !== 105) throw new Error(`paired_rows_required:${controls.size}/${treatments.size}`);
  const paired = [...controls.keys()].map((assetId) => {
    const control = controls.get(assetId);
    const treatment = treatments.get(assetId);
    if (!treatment) throw new Error(`missing_treatment:${assetId}`);
    const changedFields = FIELDS.filter((field) => JSON.stringify(control.fields?.[field] ?? null) !== JSON.stringify(treatment.fields?.[field] ?? null));
    return {
      asset_id: assetId,
      reference: control.reference,
      control_title: control.title,
      treatment_title: treatment.title,
      control_f1: control.f1,
      treatment_f1: treatment.f1,
      delta_f1: treatment.f1 - control.f1,
      control_length: control.length,
      treatment_length: treatment.length,
      changed_fields: changedFields,
      control_fields: control.fields,
      treatment_fields: treatment.fields
    };
  });

  const fieldSummary = Object.fromEntries(FIELDS.map((field) => {
    let treatmentBetter = 0;
    let controlBetter = 0;
    let ties = 0;
    let changed = 0;
    let hitDelta = 0;
    for (const row of paired) {
      const before = fieldHitCount(row.control_fields?.[field], row.reference);
      const after = fieldHitCount(row.treatment_fields?.[field], row.reference);
      hitDelta += after - before;
      if (JSON.stringify(row.control_fields?.[field] ?? null) !== JSON.stringify(row.treatment_fields?.[field] ?? null)) changed += 1;
      if (after > before) treatmentBetter += 1;
      else if (after < before) controlBetter += 1;
      else ties += 1;
    }
    return [field, { changed, treatment_better: treatmentBetter, control_better: controlBetter, ties, net_hit_delta: hitDelta }];
  }));

  const deltaRows = paired.map(({ delta_f1 }) => delta_f1);
  const wins = deltaRows.filter((delta) => delta > 1e-9).length;
  const losses = deltaRows.filter((delta) => delta < -1e-9).length;
  const output = {
    schema_version: "visual-bottom-two-band-analysis-v1",
    input: INPUT,
    control: CONTROL,
    treatment: TREATMENT,
    n: paired.length,
    paired: {
      wins,
      losses,
      ties: paired.length - wins - losses,
      mean_f1_delta: deltaRows.reduce((sum, delta) => sum + delta, 0) / paired.length,
      control_f1: mean([...controls.values()], "f1"),
      treatment_f1: mean([...treatments.values()], "f1"),
      control_recall: mean([...controls.values()], "recall"),
      treatment_recall: mean([...treatments.values()], "recall"),
      control_precision: mean([...controls.values()], "precision"),
      treatment_precision: mean([...treatments.values()], "precision")
    },
    cost_and_latency: {
      control_median_latency_ms: median([...controls.values()], "latency_ms"),
      treatment_median_latency_ms: median([...treatments.values()], "latency_ms"),
      control_mean_input_tokens: mean([...controls.values()], "input_tokens"),
      treatment_mean_input_tokens: mean([...treatments.values()], "input_tokens"),
      control_mean_output_tokens: mean([...controls.values()], "output_tokens"),
      treatment_mean_output_tokens: mean([...treatments.values()], "output_tokens"),
      control_over_80: [...controls.values()].filter((row) => row.length > 80).length,
      treatment_over_80: [...treatments.values()].filter((row) => row.length > 80).length,
      treatment_image_count: [...treatments.values()].map((row) => row.image_count).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null
    },
    field_summary: fieldSummary,
    changed_field_frequency: Object.fromEntries(FIELDS.map((field) => [field, paired.filter((row) => row.changed_fields.includes(field)).length])),
    top_wins: paired.filter((row) => row.delta_f1 > 0).sort((a, b) => b.delta_f1 - a.delta_f1).slice(0, 15),
    top_losses: paired.filter((row) => row.delta_f1 < 0).sort((a, b) => a.delta_f1 - b.delta_f1).slice(0, 15),
    decision: "CAPTURE_VISUAL_GAIN_BUT_NOT_PRODUCTION_READY"
  };
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(JSON.stringify({
    n: output.n,
    control_f1: output.paired.control_f1,
    treatment_f1: output.paired.treatment_f1,
    delta_f1: output.paired.mean_f1_delta,
    wins,
    losses,
    ties: output.paired.ties,
    control_median_latency_ms: output.cost_and_latency.control_median_latency_ms,
    treatment_median_latency_ms: output.cost_and_latency.treatment_median_latency_ms,
    output_path: OUTPUT
  }, null, 2) + "\n");
}

main();
