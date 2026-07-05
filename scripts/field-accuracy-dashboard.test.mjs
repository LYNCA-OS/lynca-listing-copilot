import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportFieldAccuracyDashboard } from "./export-field-accuracy-dashboard.mjs";

const report = {
  results: [
    {
      candidate_id: "card-1",
      provider: "openai",
      catalog_prompt_assist_used: true,
      vector_lazy_skip: false,
      retrieval_title_assist_used: true,
      known_catalog_candidate_available: true,
      corrected_title_reference: "2025 Topps Chrome Test Player Gold /50 PSA 10",
      final_evaluated_title: "2025 Topps Chrome Test Player Gold /50 PSA 10",
      rendered_fields: {
        modules: {
          year: { status: "CONFIRMED" },
          product_identity: { status: "CONFIRMED" },
          subject: { status: "CONFIRMED" },
          release_variant: { status: "CONFIRMED" },
          numerical_rarity: { status: "CONFIRMED" },
          grading: { status: "CONFIRMED" }
        }
      }
    },
    {
      candidate_id: "card-2",
      provider: "openai",
      catalog_prompt_assist_used: false,
      vector_lazy_skip: true,
      retrieval_title_assist_used: false,
      known_catalog_candidate_available: false,
      corrected_title_reference: "2025 Panini Prizm Another Player Silver /99 PSA 9",
      final_evaluated_title: "2024 Panini Prizm Wrong Player Blue /199 PSA 9",
      rendered_fields: {
        modules: {
          year: { status: "CONFIRMED" },
          product_identity: { status: "REVIEW" },
          subject: { status: "CONFIRMED" },
          release_variant: { status: "REVIEW" },
          numerical_rarity: { status: "REVIEW" },
          grading: { status: "CONFIRMED" }
        }
      }
    }
  ]
};

const tmp = await mkdtemp(join(tmpdir(), "field-accuracy-dashboard-"));

try {
  const inputPath = join(tmp, "report.json");
  const outPath = join(tmp, "dashboard.json");
  const markdownPath = join(tmp, "dashboard.md");
  await writeFile(inputPath, `${JSON.stringify(report, null, 2)}\n`);

  const dashboard = await exportFieldAccuracyDashboard({
    inputPaths: [inputPath],
    outPath,
    markdownPath
  });

  assert.equal(dashboard.input_report_count, 1);
  assert.ok(dashboard.evaluated_field_row_count >= 10);
  assert.equal(dashboard.fields.year.evaluated_count, 2);
  assert.equal(dashboard.fields.year.correct_count, 1);
  assert.equal(dashboard.fields.year.false_accept_count, 1);
  assert.equal(dashboard.fields.variant_or_parallel.review_count, 1);
  assert.ok(dashboard.fields.variant_or_parallel.error_examples.length >= 1);
  assert.ok(Object.keys(dashboard.groups).some((key) => key.includes("catalog_assist=true")));
  assert.ok(Object.keys(dashboard.groups).some((key) => key.includes("cold_start=true")));
  assert.ok(existsSync(outPath));
  assert.ok(existsSync(markdownPath));
  const markdown = await readFile(markdownPath, "utf8");
  assert.match(markdown, /Field Accuracy Dashboard/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("field-accuracy-dashboard tests passed");
