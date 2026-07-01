import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";
import {
  buildHeldOutCommercialItems,
  buildHeldOutCommercialItemsFromReviewedEvaluation,
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
      provider: "openai_legacy",
      model_id: "gpt-4.1-mini-2025-04-14",
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

const reviewedManifest = {
  schema_version: "commercial-reviewed-manifest-v1",
  items: [
    {
      source_feedback_id: "fb-001",
      asset_id: "reviewed-commercial-001",
      review_id: "reviewed-001",
      category: "sports_card",
      images: [
        { role: "front", object_path: "reviewed/001/front.jpg" },
        { role: "back", object_path: "reviewed/001/back.jpg" }
      ],
      ground_truth: resolvedFields({ serial_number: "29/199" }),
      critical_fields: ["year", "product", "players", "serial_number"],
      difficulty_tags: ["serial"]
    },
    {
      source_feedback_id: "fb-002",
      asset_id: "reviewed-commercial-002",
      review_id: "reviewed-002",
      category: "sports_card",
      images: [
        { role: "front", object_path: "reviewed/002/front.jpg" },
        { role: "back", object_path: "reviewed/002/back.jpg" }
      ],
      ground_truth: resolvedFields({
        parallel: "Blue Refractor",
        serial_number: "31/50",
        grade_company: "PSA",
        card_grade: "10"
      }),
      critical_fields: ["year", "product", "players", "parallel", "serial_number", "grade_company", "card_grade"],
      difficulty_tags: ["serial", "slab"]
    },
    {
      source_feedback_id: "fb-003",
      asset_id: "reviewed-commercial-003",
      review_id: "reviewed-003",
      category: "sports_card",
      images: [
        { role: "front", object_path: "reviewed/003/front.jpg" }
      ],
      ground_truth: resolvedFields({
        serial_number: "1/1"
      }),
      critical_fields: ["year", "product", "players", "serial_number"],
      difficulty_tags: ["serial", "front_only"]
    }
  ]
};

const providerReport = {
  schema_version: "provider-reviewed-commercial-accuracy-v1",
  results: [
    {
      source_feedback_id: "fb-001",
      asset_id: "reviewed-commercial-001",
      status: "evaluated",
      prediction: {
        model_id: "gpt-4.1-mini-2025-04-14",
        route: "AI_COMPLETE_REVIEW",
        title: "2025 Topps Chrome Cooper Flagg 029/199",
        fields: resolvedFields({ serial_number: "029/199" })
      },
      usage: {
        provider_calls: 1,
        latency_ms: 1200
      }
    },
    {
      source_feedback_id: "fb-002",
      asset_id: "reviewed-commercial-002",
      status: "evaluated",
      prediction: {
        model_id: "gpt-4.1-mini-2025-04-14",
        route: "AI_COMPLETE_REVIEW",
        title: "2025 Topps Chrome Cooper Flagg Red Refractor 37/50 PSA 9",
        fields: resolvedFields({
          parallel: "Red Refractor",
          serial_number: "37/50",
          grade_company: "PSA",
          card_grade: "9"
        })
      }
    }
  ]
};

const reviewedBuildResult = buildHeldOutCommercialItemsFromReviewedEvaluation({
  reviewedManifest,
  providerReport
});
assert.equal(reviewedBuildResult.items.length, 3);
assert.equal(reviewedBuildResult.rejected_rows.length, 0);
assert.equal(reviewedBuildResult.warnings.length, 1);
assert.match(reviewedBuildResult.warnings[0], /no matching provider evaluation result/);

const reviewedExact = reviewedBuildResult.items.find((item) => item.asset_id === "reviewed-commercial-001");
const reviewedCorrected = reviewedBuildResult.items.find((item) => item.asset_id === "reviewed-commercial-002");
const reviewedMissing = reviewedBuildResult.items.find((item) => item.asset_id === "reviewed-commercial-003");

assert.equal(reviewedExact.prediction.review_outcome, "ACCEPTED_UNCHANGED");
assert.equal(reviewedExact.prediction.resolved_fields.serial_number, "29/199");
assert.equal(reviewedExact.ground_truth_fields.serial_number, "29/199");
assert.equal(reviewedExact.ground_truth_route, "AI_COMPLETE_REVIEW");
assert.equal(reviewedCorrected.prediction.review_outcome, "CORRECTED_FIELDS");
assert.equal(reviewedCorrected.ground_truth_route, "WRITER_REVIEW_REQUIRED");
assert.equal(reviewedCorrected.prediction.human_authored_critical_resolution, true);
assert.deepEqual(reviewedCorrected.prediction.field_changes.map((change) => change.field), [
  "parallel",
  "serial_number",
  "card_grade"
]);
assert.equal(reviewedMissing.prediction.review_outcome, "TECHNICAL_FAILURE");
assert.equal(reviewedMissing.prediction.route, "NOT_EVALUATED");
assert.equal(reviewedMissing.prediction.technical_failure, true);
assert.equal(reviewedMissing.ground_truth_route, "FAILED_TECHNICAL");

const reviewedBaseDataset = {
  ...baseDataset,
  commercial_acceptance: {
    minimum_held_out_assets: 3,
    required_strata: ["serial", "front_back"],
    thresholds: baseDataset.commercial_acceptance.thresholds
  },
  splits: {
    development: [],
    calibration: [],
    held_out_commercial: []
  }
};

const reviewedMergeResult = mergeHeldOutCommercialItems(reviewedBaseDataset, reviewedBuildResult.items, { replace: true });
assert.equal(reviewedMergeResult.validation.ok, true);
assert.equal(reviewedMergeResult.dataset.splits.held_out_commercial.length, 3);
assert.equal(reviewedMergeResult.evaluation.commercial_acceptance_gate.passed, false);
assert.equal(reviewedMergeResult.evaluation.held_out_commercial_evidence.commercial_metrics.ai_overall_exact_resolution_rate, 1 / 3);
assert.equal(reviewedMergeResult.evaluation.held_out_commercial_evidence.commercial_metrics.ai_complete_result_precision, 0.5);

const reviewedPath = join(tempDir, "reviewed.json");
const providerReportPath = join(tempDir, "provider-report.json");
const reviewedOutPath = join(tempDir, "reviewed-out.json");
await writeFile(reviewedPath, `${JSON.stringify(reviewedManifest, null, 2)}\n`);
await writeFile(providerReportPath, `${JSON.stringify(providerReport, null, 2)}\n`);

const reviewedCli = spawnSync(process.execPath, [
  "scripts/build-held-out-commercial.mjs",
  "--reviewed",
  reviewedPath,
  "--provider-report",
  providerReportPath,
  "--dataset",
  datasetPath,
  "--out",
  reviewedOutPath,
  "--replace",
  "--allow-rejections"
], {
  encoding: "utf8"
});

assert.equal(reviewedCli.status, 0, reviewedCli.stderr || reviewedCli.stdout);
assert.match(reviewedCli.stdout, /mode: reviewed_manifest_provider_eval/);
assert.match(reviewedCli.stdout, /source_rows: 3/);
assert.match(reviewedCli.stdout, /imported_items: 3/);
assert.match(reviewedCli.stdout, /warnings: 1/);
assert.match(reviewedCli.stdout, /held_out_commercial_assets: 3/);

const reviewedOutputDataset = JSON.parse(await readFile(reviewedOutPath, "utf8"));
assert.equal(reviewedOutputDataset.splits.held_out_commercial.length, 3);
assert.equal(reviewedOutputDataset.splits.held_out_commercial[0].prediction.resolved_fields.serial_number, "29/199");

console.log("commercial held-out builder tests passed");
