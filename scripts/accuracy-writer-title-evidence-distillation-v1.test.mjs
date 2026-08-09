#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  distillWriterTitleEvidenceV1,
  writerTitleTokens
} from "../lib/listing/evaluation/writer-title-evidence-distillation-v1.mjs";
import { writeWriterTitleEvidenceDistillationV1 } from
  "./distill-writer-title-evidence-v1.mjs";

const fields = ({ product = "Topps Chrome", set = "", finish = "",
  subject = "Player", grade = "10" } = {}) => ({
  year: "2024", ip: "", language: "", manufacturer: "Topps", product, set,
  subjects: [subject], team: "", card_name: "", card_number: "",
  descriptive_rarity: "", serial: "", release_variant: "", print_finish: finish,
  special_stamp: "", grading_info: { company: "PSA", card_grade: grade,
    auto_grade: "", grade_type: "CARD_ONLY" }, description: "", components: [],
  lot_count: ""
});

assert.deepEqual(writerTitleTokens("Élite #/050 PSA 9.5"), ["elite", "/050", "psa", "9.5"]);

const cards = [{
  asset_id: "a",
  writer_title: "2024 Topps Chrome Sapphire Selections Player Gold Refractor PSA 10",
  candidate_title: "2024 Topps Chrome Player PSA 10",
  candidate_fields: fields({ set: "Sapphire Selections", finish: "Gold Refractor" }),
  source_backing: [
    { source: "canonical_model_fields", value: fields({ set: "Sapphire Selections",
      finish: "Gold Refractor" }) },
    { source: "exhaustive_model_observation",
      value: "Sapphire Selections Player Gold Refractor" }
  ]
}, {
  asset_id: "b",
  writer_title: "2023 Panini Prizm Luka Doncic Silver PSA 9",
  candidate_title: "2023 Panini Prizm Luka Doncic Silver PSA 9",
  candidate_fields: fields({ product: "Panini Prizm", finish: "Silver",
    subject: "Luka Doncic", grade: "9" }),
  source_backing: []
}, {
  asset_id: "c",
  writer_title: "2023 Panini Prizm Downtown Luka Doncic PSA 9",
  candidate_title: "2023 Panini Prizm Luka Doncic PSA 9",
  candidate_fields: fields({ product: "Panini Prizm", subject: "Luka Doncic", grade: "9" }),
  source_backing: []
}];

const report = distillWriterTitleEvidenceV1(cards, { minimumWriterTitles: 3 });
assert.equal(report.authority, "label_aware_development_only");
assert.equal(report.production_authorized, false);
assert.deepEqual(report.execution, { network_calls: 0, provider_calls: 0,
  runtime_mutations: 0 });
assert.equal(report.supervision.writer_titles, "WEAK_MARKETPLACE_TITLE_SUPERVISION");
assert.equal(report.supervision.title_omission_is_factual_error, false);
assert.equal(report.summary.cards, 3);
assert.equal(report.summary.cards_with_token_omissions, 2);
assert.deepEqual(report.cards[0].omission_phrases.map((row) => row.phrase),
  ["sapphire selections", "gold refractor"]);
assert.equal(report.cards[0].omission_phrases.every((row) =>
  row.source_backing.status === "EXACT_PHRASE_AVAILABLE"), true);
assert.equal(report.cards[2].omission_phrases[0].source_backing.status,
  "SOURCE_UNAVAILABLE");
assert.ok(report.cards[0].field_proxy.disagreements.some((row) => row.field === "product"));
assert.ok(report.cards[2].field_proxy.disagreements.some((row) => row.field === "card_name"));
assert.ok(report.candidate_banks.set.some((row) => row.value === "Sapphire Selections"
  && row.admission_authority === false));
assert.ok(report.candidate_banks.slab.some((row) => row.value === "PSA 10"));
assert.deepEqual(report.factual_metrics, {
  independent_typed_gold_cards: 0,
  typed_field_precision: null,
  typed_field_recall: null,
  factual_error_cards: null,
  critical_factual_error_cards: null,
  factual_regression_cards: null,
  required_missing_cards: null,
  wrong_role_cards: null
});
assert.throws(() => distillWriterTitleEvidenceV1(cards.slice(0, 2),
  { minimumWriterTitles: 3 }), /requires_3_titles/);
assert.throws(() => distillWriterTitleEvidenceV1([{ ...cards[0],
  source_backing: [{ source: "canonical_model_fields",
    value: { reviewed_title: "must not enter source backing" } }] }],
{ minimumWriterTitles: 1 }), /label_leak_in_source/);
assert.throws(() => distillWriterTitleEvidenceV1([{ ...cards[0],
  source_backing: [{ source: "writer_reference", value: "leak" }] }],
{ minimumWriterTitles: 1 }), /source_authority_invalid/);

const temp = await mkdtemp(join(tmpdir(), "writer-title-distillation-v1-"));
try {
  const dataset = { items: [] };
  const labels = [];
  const predictions = [];
  const observations = [];
  for (let index = 0; index < 200; index += 1) {
    const assetId = `asset_${index}`;
    const key = `label_${index}`;
    dataset.items.push({ asset_id: assetId, sealed_eval_label_ref: { key } });
    labels.push({ key, label_type: "REVIEWED_INTERNAL_TITLE",
      reviewed_title: `2024 Topps Chrome Player ${index} PSA 10`,
      policy: { reviewed_title_is_ground_truth: true, field_ground_truth: false,
        model_prompt_visible: false, self_retrieval_exclusion_required: true } });
    predictions.push({ arm: "canonical", asset_id: assetId,
      title: `2024 Topps Chrome Player ${index} PSA 10`, fields: fields({
        subject: `Player ${index}` }) });
    observations.push({ arm: "exhaustive", asset_id: assetId,
      title: `Topps Chrome Player ${index} PSA 10` });
  }
  const paths = Object.fromEntries(["dataset", "labels", "predictions", "observations", "out"]
    .map((name) => [name, join(temp, `${name}.json${name === "dataset" || name === "out" ? "" : "l"}`)]));
  await Promise.all([
    writeFile(paths.dataset, JSON.stringify(dataset)),
    writeFile(paths.labels, `${labels.map(JSON.stringify).join("\n")}\n`),
    writeFile(paths.predictions, `${predictions.map(JSON.stringify).join("\n")}\n`),
    writeFile(paths.observations, `${observations.map(JSON.stringify).join("\n")}\n`)
  ]);
  await assert.rejects(writeWriterTitleEvidenceDistillationV1({
    datasetPath: paths.dataset, labelsPath: paths.labels,
    predictionSpecs: [`${paths.predictions}::canonical`],
    sourceSpecs: [`${paths.observations}::exhaustive`], outPath: paths.out
  }), /requires_label_aware_development_only/);
  const full = await writeWriterTitleEvidenceDistillationV1({
    datasetPath: paths.dataset, labelsPath: paths.labels,
    predictionSpecs: [`${paths.predictions}::canonical`],
    sourceSpecs: [`${paths.observations}::exhaustive`], outPath: paths.out,
    labelAwareDevelopmentOnly: true
  });
  assert.equal(full.summary.cards, 200);
  assert.equal(full.summary.exact_normalized_title_agreement_cards, 200);
  assert.equal(JSON.parse(await readFile(paths.out, "utf8")).authority,
    "label_aware_development_only");
  assert.equal((await stat(paths.out)).mode & 0o777, 0o600);
} finally {
  await rm(temp, { recursive: true, force: true });
}

process.stdout.write("writer-title evidence distillation v1: ok\n");
