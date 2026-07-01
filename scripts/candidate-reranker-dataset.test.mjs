import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportCandidateRerankerDataset } from "./export-candidate-reranker-dataset.mjs";

const requiredColumns = [
  "query_card_id",
  "candidate_id",
  "label_is_correct",
  "candidate_source_type",
  "source_trust",
  "candidate_rank",
  "selected_by_current_system",
  "match_score",
  "normalized_score",
  "front_similarity",
  "back_similarity",
  "front_back_agreement",
  "year_match",
  "product_match",
  "set_match",
  "subject_match",
  "subject_count_match",
  "collector_number_match",
  "checklist_code_match",
  "serial_denominator_match",
  "surface_color_match",
  "observable_component_match",
  "direct_conflict_count",
  "conflicting_fields",
  "supporting_field_count",
  "candidate_margin",
  "title_token_overlap",
  "current_system_recovery",
  "current_system_regression",
  "oracle_candidate_upper_bound_bucket"
];

const report = {
  schema_version: "cloud-listing-api-eval-v1",
  results: [
    {
      candidate_id: "query-1",
      corrected_title: "2025 Topps Chrome Test Player Gold /50",
      raw_corrected_title_comparison: {
        token_recall: 0.68
      },
      corrected_title_comparison: {
        token_recall: 0.94
      },
      candidate_proxy_decision: {
        selected_candidate_id: "identity-good",
        best_candidate: {
          source: "catalog",
          candidate_id: "identity-good",
          title: "2025 Topps Chrome Test Player Gold /50",
          token_recall: 1,
          exact: true,
          rank: 1,
          supporting_fields: ["year", "product", "subject", "serial_denominator"],
          conflicts: []
        }
      },
      catalog_candidates: [
        {
          id: "identity-good",
          rank: 1,
          title: "2025 Topps Chrome Test Player Gold /50",
          provider: "catalog",
          source_trust: "APPROVED_REFERENCE",
          normalized_score: 0.98,
          raw_score: 0.98,
          selected: true,
          supporting_fields: ["year", "product", "subject", "serial_denominator"],
          conflicting_fields: []
        },
        {
          id: "identity-bad-catalog",
          rank: 2,
          title: "2025 Topps Chrome Test Player Purple /99",
          provider: "catalog",
          source_trust: "APPROVED_REFERENCE",
          normalized_score: 0.74,
          raw_score: 0.74,
          selected: false,
          supporting_fields: ["year", "product", "subject"],
          conflicting_fields: ["serial_denominator", "surface_color"]
        }
      ],
      vector_candidates: [
        {
          id: "identity-bad-vector",
          rank: 3,
          title: "2024 Topps Chrome Other Player Gold /50",
          provider: "visual_vector",
          source_trust: "CANDIDATE",
          normalized_score: 0.7,
          raw_score: 0.91,
          front_similarity: 0.89,
          back_similarity: 0.82,
          selected: false,
          supporting_fields: ["surface_color", "serial_denominator"],
          conflicting_fields: ["year", "subject"],
          direct_evidence_conflicts: ["subject"],
          conflicts: [{ field: "year" }]
        }
      ]
    },
    {
      candidate_id: "query-2",
      corrected_title: "2025 Panini Prizm Another Player Silver /99",
      raw_corrected_title_comparison: {
        token_recall: 0.86
      },
      corrected_title_comparison: {
        token_recall: 0.74
      },
      candidate_proxy_decision: {
        selected_candidate_id: "identity-wrong",
        best_candidate: {
          source: "catalog",
          candidate_id: "identity-wrong",
          title: "2025 Panini Prizm Another Player Blue /199",
          token_recall: 0.75,
          exact: false,
          rank: 1,
          supporting_fields: ["year", "product", "subject"],
          conflicts: ["serial_denominator", "surface_color"]
        }
      },
      catalog_candidates: [
        {
          id: "identity-wrong",
          rank: 1,
          title: "2025 Panini Prizm Another Player Blue /199",
          provider: "catalog",
          source_trust: "APPROVED_REFERENCE",
          normalized_score: 0.86,
          raw_score: 0.86,
          selected: true,
          supporting_fields: ["year", "product", "subject"],
          conflicting_fields: ["serial_denominator", "surface_color"]
        },
        {
          id: "identity-far",
          rank: 2,
          title: "2024 Panini Select Different Player Silver",
          provider: "vector",
          source_trust: "CANDIDATE",
          normalized_score: 0.54,
          raw_score: 0.8,
          selected: false,
          supporting_fields: ["surface_color"],
          conflicting_fields: ["year", "product", "subject"]
        }
      ],
      vector_candidates: []
    }
  ]
};

const tmp = await mkdtemp(join(tmpdir(), "candidate-reranker-dataset-"));

try {
  const inputPath = join(tmp, "report.json");
  const rowsPath = join(tmp, "rows.jsonl");
  const csvPath = join(tmp, "rows.csv");
  const metricsPath = join(tmp, "metrics.json");
  const hardNegativesPath = join(tmp, "hard-negatives.jsonl");
  const shadowPath = join(tmp, "shadow.json");
  const reportPath = join(tmp, "report.md");
  await writeFile(inputPath, `${JSON.stringify(report, null, 2)}\n`);

  const result = await exportCandidateRerankerDataset({
    inputPaths: [inputPath],
    rowsPath,
    csvPath,
    metricsPath,
    hardNegativesPath,
    shadowPath,
    reportPath
  });

  assert.equal(result.rows.length, 5);
  requiredColumns.forEach((column) => {
    assert.ok(Object.hasOwn(result.rows[0], column), `missing exported column: ${column}`);
  });
  assert.equal(result.metrics.query_count, 2);
  assert.equal(result.metrics.positive_candidate_count, 1);
  assert.equal(result.metrics.reranker_training_positive_count, 1);
  assert.equal(result.metrics.missing_correct_candidate_count, 1);
  assert.ok(result.metrics.hard_negative_count >= 2);
  assert.equal(result.metrics.candidate_source_breakdown.catalog.candidate_count, 4);
  assert.equal(result.metrics.candidate_source_breakdown.vector.candidate_count, 1);
  assert.deepEqual(result.metrics.candidate_recall_at_1, {
    count: 1,
    denominator: 2,
    rate: 0.5
  });
  assert.deepEqual(result.metrics.candidate_recall_at_5, {
    count: 1,
    denominator: 2,
    rate: 0.5
  });
  assert.deepEqual(result.metrics.oracle_upper_bound, {
    count: 1,
    denominator: 2,
    rate: 0.5
  });
  assert.deepEqual(result.metrics.current_selected_accuracy, {
    selected_correct_count: 1,
    selected_count: 2,
    rate: 0.5
  });

  const vectorHardNegative = result.rows.find((row) => row.candidate_id === "identity-bad-vector");
  assert.equal(vectorHardNegative.oracle_candidate_upper_bound_bucket, "TOP_1");
  assert.equal(vectorHardNegative.direct_conflict_count, 2);
  assert.deepEqual(vectorHardNegative.conflicting_fields.sort(), ["subject", "year"]);
  assert.equal(vectorHardNegative.front_back_agreement, true);
  assert.ok(result.hard_negatives.some((row) => row.error_type === "VECTOR_HIGH_SIMILARITY_DIRECT_CONFLICT"));
  assert.ok(result.hard_negatives.some((row) => row.error_type === "SAFE_ASSIST_IMPROVED_TITLE"));
  assert.equal(result.shadow_decisions.length, 2);
  assert.ok(result.shadow_decisions[0].shadow_selected_candidate_id);
  assert.match(result.markdown_report, /Decision Learning Foundation v1 Report/);

  assert.ok(existsSync(rowsPath));
  assert.ok(existsSync(metricsPath));
  assert.ok(existsSync(hardNegativesPath));
  assert.ok(existsSync(shadowPath));
  assert.ok(existsSync(reportPath));
  const csv = await readFile(csvPath, "utf8");
  assert.ok(csv.startsWith(requiredColumns.join(",")));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("candidate-reranker-dataset tests passed");
