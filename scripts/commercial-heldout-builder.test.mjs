import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";
import {
  buildHeldOutCommercialItems,
  mergeHeldOutCommercialItems
} from "../lib/listing/evaluation/commercial-heldout-builder.mjs";

function resolvedFields(overrides = {}) {
  return {
    year: "2025",
    brand: "Topps",
    product: "Chrome",
    players: ["Cooper Flagg"],
    serial_number: "31/50",
    final_title_required_fields: true,
    final_title_unsubstantiated_fields: false,
    ...overrides
  };
}

function commercialRow({
  assetId,
  analysisId,
  reviewId,
  generated,
  corrected,
  reviewOutcome = "ACCEPTED_UNCHANGED",
  route = "AI_COMPLETE_REVIEW",
  front = `fixtures/${assetId}/front.jpg`,
  back = `fixtures/${assetId}/back.jpg`,
  quality
}) {
  return {
    asset: {
      id: assetId,
      category: "sports_card",
      front_object_path: front,
      back_object_path: back
    },
    analysis: {
      id: analysisId,
      asset_id: assetId,
      route,
      provider: "agnes",
      model_id: "agnes-commercial-test",
      rendered_title: `${generated.year} ${generated.product} ${generated.players[0]} ${generated.serial_number}`,
      generated_resolved_fields: generated,
      usage: {
        provider_calls: 1,
        retrieval_rounds: 0
      }
    },
    review: {
      id: reviewId,
      analysis_run_id: analysisId,
      asset_id: assetId,
      review_outcome: reviewOutcome,
      corrected_resolved_fields: corrected,
      corrected_title: `${corrected.year} ${corrected.product} ${corrected.players[0]} ${corrected.serial_number}`,
      field_changes: generated.serial_number === corrected.serial_number ? [] : [
        {
          field: "serial_number",
          from: generated.serial_number,
          to: corrected.serial_number,
          change_type: "OPERATOR_CORRECTION"
        }
      ],
      commercial_quality: quality
    },
    approved_at: "2026-06-22T08:00:00.000Z"
  };
}

const sourceRows = [
  commercialRow({
    assetId: "commercial-accept-001",
    analysisId: "analysis-accept-001",
    reviewId: "review-accept-001",
    generated: resolvedFields(),
    corrected: resolvedFields(),
    quality: {
      final_title_required_fields: true,
      final_title_unsubstantiated_fields: false
    }
  }),
  commercialRow({
    assetId: "commercial-corrected-002",
    analysisId: "analysis-corrected-002",
    reviewId: "review-corrected-002",
    generated: resolvedFields({ serial_number: "37/50" }),
    corrected: resolvedFields({ serial_number: "31/50" }),
    reviewOutcome: "CORRECTED_FIELDS",
    quality: {
      final_title_required_fields: true,
      final_title_unsubstantiated_fields: false
    }
  }),
  commercialRow({
    assetId: "commercial-rejected-003",
    analysisId: "analysis-rejected-003",
    reviewId: "review-rejected-003",
    generated: resolvedFields(),
    corrected: resolvedFields(),
    front: "https://example.test/signed/front.jpg?token=secret",
    back: "",
    quality: {}
  })
];

const buildResult = buildHeldOutCommercialItems(sourceRows);
assert.equal(buildResult.items.length, 2);
assert.equal(buildResult.rejected_rows.length, 1);
assert.deepEqual(buildResult.rejected_rows[0].reasons, [
  "missing safe image object paths",
  "missing explicit final title quality flags"
]);

const acceptedItem = buildResult.items.find((item) => item.asset_id === "commercial-accept-001");
const correctedItem = buildResult.items.find((item) => item.asset_id === "commercial-corrected-002");

assert.equal(acceptedItem.ground_truth_route, "AI_COMPLETE_REVIEW");
assert.equal(acceptedItem.prediction.review_status, "APPROVED");
assert.equal(correctedItem.ground_truth_route, "WRITER_REVIEW_REQUIRED");
assert.equal(correctedItem.prediction.route, "AI_COMPLETE_REVIEW");
assert.equal(correctedItem.prediction.review_status, "APPROVED");
assert.equal(correctedItem.ground_truth_fields.serial_number, "31/50");
assert.equal(correctedItem.prediction.resolved_fields.serial_number, "37/50");
assert.equal(correctedItem.prediction.corrected_resolved_fields.serial_number, "31/50");
assert.ok(correctedItem.difficulty_tags.includes("serial"));
assert.ok(correctedItem.difficulty_tags.includes("front_back"));

const baseDataset = {
  schema_version: "golden-dataset-v1",
  commercial_acceptance: {
    minimum_held_out_assets: 2,
    required_strata: ["serial", "front_back"],
    thresholds: {
      ai_overall_exact_resolution_rate: { operator: ">=", value: 0.75 },
      human_authored_critical_resolution_rate: { operator: "<=", value: 0.05 },
      accepted_critical_error_rate: { operator: "<=", value: 0 },
      ai_complete_result_precision: { operator: ">=", value: 0.75 }
    }
  },
  splits: {
    development: [],
    calibration: [],
    held_out_commercial: []
  }
};

const mergeResult = mergeHeldOutCommercialItems(baseDataset, buildResult.items, { replace: true });
assert.equal(mergeResult.validation.ok, true);
assert.equal(mergeResult.rejected_items.length, 0);
assert.equal(mergeResult.dataset.splits.held_out_commercial.length, 2);
assert.equal(mergeResult.evaluation.commercial_acceptance_gate.passed, false);
assert.equal(mergeResult.evaluation.held_out_commercial_evidence.commercial_metrics.ai_overall_exact_resolution_rate, 0.5);
assert.equal(mergeResult.evaluation.held_out_commercial_evidence.commercial_metrics.ai_complete_result_precision, 0.5);
assert.ok(mergeResult.evaluation.commercial_acceptance_gate.reasons.some((reason) => {
  return reason.includes("ai_overall_exact_resolution_rate=0.5");
}));

const duplicateResult = mergeHeldOutCommercialItems(mergeResult.dataset, buildResult.items);
assert.equal(duplicateResult.rejected_items.length, 2);

const evaluation = evaluateGoldenDataset(mergeResult.dataset);
assert.equal(evaluation.dataset.commercial_claim_allowed, false);

const tempDir = await mkdtemp(join(tmpdir(), "lynca-commercial-heldout-"));
const sourcePath = join(tempDir, "source.json");
const datasetPath = join(tempDir, "dataset.json");
const outPath = join(tempDir, "out.json");

await writeFile(sourcePath, `${JSON.stringify({ rows: sourceRows }, null, 2)}\n`);
await writeFile(datasetPath, `${JSON.stringify(baseDataset, null, 2)}\n`);

const cli = spawnSync(process.execPath, [
  "scripts/build-held-out-commercial.mjs",
  "--source",
  sourcePath,
  "--dataset",
  datasetPath,
  "--out",
  outPath,
  "--replace",
  "--allow-rejections"
], {
  encoding: "utf8"
});

assert.equal(cli.status, 0, cli.stderr || cli.stdout);
assert.match(cli.stdout, /imported_items: 2/);
assert.match(cli.stdout, /rejected_rows: 1/);
assert.match(cli.stdout, /held_out_commercial_assets: 2/);
assert.match(cli.stdout, /commercial_acceptance_gate: eligible:false passed:false minimum_held_out_assets:2/);

const outputDataset = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(outputDataset.splits.held_out_commercial.length, 2);
assert.equal(outputDataset.splits.held_out_commercial[1].prediction.resolved_fields.serial_number, "37/50");

const strictCli = spawnSync(process.execPath, [
  "scripts/build-held-out-commercial.mjs",
  "--source",
  sourcePath,
  "--dataset",
  datasetPath,
  "--out",
  join(tempDir, "strict-out.json"),
  "--replace"
], {
  encoding: "utf8"
});

assert.equal(strictCli.status, 1);
assert.match(strictCli.stderr, /Rejected rows\/items found/);

console.log("commercial held-out builder tests passed");
