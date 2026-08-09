#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { distillWriterTitleEvidenceV1 } from
  "../lib/listing/evaluation/writer-title-evidence-distillation-v1.mjs";
import {
  WRITER_TITLE_PRODUCT_PHRASE_PARETO_V1,
  computePhraseBankExecutableBoundsV1,
  computeWriterTitlePhraseParetoV1,
  evaluateKfoldProductPhraseExtensionV1
} from "../lib/listing/evaluation/writer-title-product-phrase-pareto-v1.mjs";
import { loadWriterTitleEvidenceRowsV1 } from
  "./distill-writer-title-evidence-v1.mjs";

const clean = (value) => String(value ?? "").trim();

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function options(argv, name) {
  return argv.flatMap((value, index) => value === name ? [argv[index + 1]] : [])
    .filter(Boolean);
}

function outputPathAllowed(path) {
  const normalized = resolve(path);
  return normalized.startsWith(`${resolve(tmpdir())}/`) || normalized.includes("/artifacts/");
}

export async function writeWriterTitleProductPhraseParetoV1({ datasetPath, labelsPath,
  predictionSpecs, sourceSpecs, outPath, labelAwareDevelopmentOnly = false }) {
  invariant(labelAwareDevelopmentOnly === true,
    "product_phrase_pareto_requires_label_aware_development_only");
  invariant(clean(outPath) && outputPathAllowed(outPath),
    "product_phrase_pareto_output_scope_invalid");
  const loaded = await loadWriterTitleEvidenceRowsV1({ datasetPath, labelsPath,
    predictionSpecs, sourceSpecs, labelAwareDevelopmentOnly });
  const distillation = distillWriterTitleEvidenceV1(loaded.rows);
  const pareto = computeWriterTitlePhraseParetoV1(distillation);
  invariant(pareto.selected_next_step === "product",
    `product_phrase_pareto_selected_unimplemented_arm:${pareto.selected_next_step || "none"}`);
  const productScreen = evaluateKfoldProductPhraseExtensionV1(loaded.rows);
  const executionBounds = computePhraseBankExecutableBoundsV1(loaded.rows, distillation,
    productScreen);
  const report = {
    schema_version: WRITER_TITLE_PRODUCT_PHRASE_PARETO_V1,
    authority: "label_aware_development_only",
    production_authorized: false,
    execution: { network_calls: 0, provider_calls: 0, runtime_mutations: 0 },
    supervision: {
      writer_titles: "WEAK_MARKETPLACE_TITLE_SUPERVISION",
      typed_gold: false,
      model_output_phrase_availability_is_factual_truth: false,
      proxy_loss_is_factual_regression: false
    },
    data_policy: {
      training_eligible: false,
      threshold_tuning_eligible: false,
      runtime_candidate_eligible: false,
      catalog_promotion_eligible: false,
      model_prompt_eligible: false,
      commit_label_derived_rows: false
    },
    pareto,
    product_screen: productScreen,
    execution_bounds: executionBounds,
    factual_metrics: {
      independent_typed_gold_cards: 0,
      typed_field_precision: null,
      typed_field_recall: null,
      factual_error_cards: null,
      critical_factual_error_cards: null,
      factual_regression_cards: null
    },
    input_receipts: loaded.input_receipts
  };
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
  return report;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  writeWriterTitleProductPhraseParetoV1({
    datasetPath: option(argv, "--dataset"),
    labelsPath: option(argv, "--sealed-labels"),
    predictionSpecs: options(argv, "--prediction"),
    sourceSpecs: options(argv, "--source-observation"),
    outPath: option(argv, "--out"),
    labelAwareDevelopmentOnly: argv.includes("--label-aware-development-only")
  }).then((report) => {
    process.stdout.write(`${JSON.stringify({
      schema_version: report.schema_version,
      selected_next_step: report.pareto.selected_next_step,
      pareto_frontier: report.pareto.pareto_frontier,
      recommendation: report.execution_bounds.recommendation,
      executable_bounds: report.execution_bounds.bounds,
      summary: report.product_screen.summary,
      factual_metrics: report.factual_metrics,
      output: resolve(option(argv, "--out"))
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
