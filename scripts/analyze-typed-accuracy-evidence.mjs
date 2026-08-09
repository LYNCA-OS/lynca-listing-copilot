#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildTypedAccuracyEvidenceReport,
  typedAccuracyInputFromResidualV3Analysis
} from "../lib/listing/evaluation/typed-accuracy-evidence-ruler.mjs";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback;
};

export async function analyzeTypedAccuracyEvidence({ inputPath, outPath = "" }) {
  const absoluteInput = resolve(inputPath);
  const input = JSON.parse(await readFile(absoluteInput, "utf8"));
  const normalized = input.schema_version === "model-residual-candidate-v3-35x3-analysis-v1"
    ? typedAccuracyInputFromResidualV3Analysis(input, absoluteInput)
    : input;
  const report = buildTypedAccuracyEvidenceReport(normalized);
  if (outPath) {
    const absoluteOut = resolve(outPath);
    await mkdir(dirname(absoluteOut), { recursive: true });
    await writeFile(absoluteOut, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const inputPath = arg("--input",
    "artifacts/model-residual-v3-paid105-2026-08-08/analysis.json");
  const outPath = arg("--out");
  const report = await analyzeTypedAccuracyEvidence({ inputPath, outPath });
  process.stdout.write(`${JSON.stringify({
    schema_version: report.schema_version,
    decision: report.decision,
    production_promotion_allowed: report.production_promotion_allowed,
    paired_cards: report.cohort.paired_cards,
    independent_gold_availability: report.independent_gold_metrics.availability,
    independent_gold_cards: report.independent_gold_metrics.eligible_gold_cards,
    reference_loss_cards: report.diagnostic_proxies.reference_loss_cards.value,
    unbacked_new_token_cards: report.diagnostic_proxies.unbacked_new_token_cards.value,
    numeric_mutation_cards: report.diagnostic_proxies.numeric_mutation_cards.value,
    titles_over_80: report.diagnostic_proxies.titles_over_80.value,
    field_fidelity_cards: report.diagnostic_proxies.exact_field_fidelity_cards.value,
    f1_delta: report.legacy_f1_trend.delta_macro_f1,
    absolute_accuracy_over_90_claim: report.absolute_accuracy_over_90_claim,
    out: outPath ? resolve(outPath) : null
  }, null, 2)}\n`);
}
