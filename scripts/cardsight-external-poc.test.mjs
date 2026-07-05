import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCardsightExternalPocReport } from "./evaluate-cardsight-external-poc.mjs";

const tmpDir = await mkdtemp(join(tmpdir(), "cardsight-external-poc-"));

try {
  const datasetPath = join(tmpDir, "dataset.json");
  const cloudReportPath = join(tmpDir, "cloud-report.json");
  const sealedPath = join(tmpDir, "sealed.jsonl");
  const outPath = join(tmpDir, "report.json");
  const markdownPath = join(tmpDir, "report.md");
  const imagePath = join(tmpDir, "front.jpg");

  await mkdir(tmpDir, { recursive: true });
  await writeFile(imagePath, "fake-image");
  await writeFile(datasetPath, `${JSON.stringify({
    items: [{
      asset_id: "case-1",
      images: [{ local_path: imagePath }],
      sealed_eval_label_ref: { key: "case-1" }
    }, {
      asset_id: "case-2",
      images: [{ local_path: imagePath }],
      sealed_eval_label_ref: { key: "case-2" }
    }, {
      asset_id: "case-3",
      images: [{ local_path: imagePath }],
      sealed_eval_label_ref: { key: "case-3" }
    }]
  }, null, 2)}\n`);
  await writeFile(cloudReportPath, `${JSON.stringify({
    results: [{
      candidate_id: "case-1",
      final_evaluated_title: "2023 Topps Chrome Wrong Player",
      resolved_fields: {
        year: "2023",
        manufacturer: "Topps",
        product: "Topps Chrome",
        players: ["Correct Player"],
        collector_number: "12"
      }
    }, {
      candidate_id: "case-2",
      final_evaluated_title: "2020 Panini Prizm Existing Player Silver",
      resolved_fields: {
        year: "2020",
        manufacturer: "Panini",
        product: "Prizm",
        players: ["Existing Player"]
      }
    }, {
      candidate_id: "case-3",
      final_evaluated_title: "No Match Player",
      resolved_fields: {
        players: ["No Match Player"]
      }
    }]
  }, null, 2)}\n`);
  await writeFile(sealedPath, [
    JSON.stringify({ case_id: "case-1", title: "2023 Topps Chrome Correct Player Gold #12" }),
    JSON.stringify({ case_id: "case-2", title: "2020 Panini Prizm Existing Player Silver" }),
    JSON.stringify({ case_id: "case-3", title: "Secret Seller Title Must Not Enter Request" })
  ].join("\n") + "\n");

  const searchQueries = [];
  const identifyInputs = [];
  const adapter = {
    async searchCatalog({ observedFields, segment, take }) {
      searchQueries.push({ observedFields, segment, take });
      const player = observedFields.players?.[0] || "";
      if (player === "Correct Player") {
        return {
          candidates: [{
            provider_id: "cardsight",
            source_trust: "LICENSED_EXTERNAL_DIRECTORY",
            used_as_truth: false,
            match_level: "exact_card",
            confidence: "High",
            rank: 1,
            external_card_id: "cs_case_1",
            title: "2023 Topps Chrome Correct Player Gold #12",
            fields: { year: "2023", product: "Topps Chrome", players: ["Correct Player"], collector_number: "12" },
            allowed_usage: ["candidate_generation"],
            forbidden_usage: ["direct_title_rendering"]
          }]
        };
      }
      if (player === "Existing Player") {
        return {
          candidates: [{
            provider_id: "cardsight",
            source_trust: "LICENSED_EXTERNAL_DIRECTORY",
            used_as_truth: false,
            match_level: "set_level",
            confidence: "Medium",
            rank: 1,
            external_set_id: "cs_set_2",
            title: "2020 Panini Prizm Existing Player Silver",
            fields: { year: "2020", product: "Prizm", players: ["Existing Player"] },
            allowed_usage: ["candidate_generation"],
            forbidden_usage: ["direct_title_rendering"]
          }]
        };
      }
      return { candidates: [] };
    },
    async identifyImage({ image, segment }) {
      identifyInputs.push({ image, segment });
      return { candidates: [] };
    }
  };

  const report = await buildCardsightExternalPocReport({
    datasetPath,
    cloudReportPath,
    sealedLabelsPath: sealedPath,
    outPath,
    markdownOutPath: markdownPath,
    mode: "catalog",
    segment: "basketball",
    take: 5,
    adapter,
    now: new Date("2026-07-01T00:00:00.000Z")
  });

  assert.equal(identifyInputs.length, 0);
  assert.equal(searchQueries.length, 3);
  assert.equal(searchQueries[0].segment, "basketball");
  assert.equal(searchQueries[0].take, 5);
  assert.doesNotMatch(JSON.stringify(searchQueries), /Secret Seller Title/);
  assert.equal(report.policy.external_candidates_used_as_truth, false);
  assert.equal(report.policy.seller_title_sent_to_cardsight, false);
  assert.equal(report.metrics.attempted_count, 3);
  assert.equal(report.metrics.cardsight_exact_match_count, 1);
  assert.equal(report.metrics.cardsight_set_level_match_count, 1);
  assert.equal(report.metrics.cardsight_recovery_count, 1);
  assert.equal(report.metrics.cardsight_regression_count, 0);
  assert.equal(report.metrics.external_candidate_recall_at_1, 0.666667);
  assert.equal(report.rows[0].cardsight_candidates[0].used_as_truth, false);
  assert.equal(report.rows[0].sealed_label_sent_to_cardsight, false);
  assert.match(await readFile(outPath, "utf8"), /cardsight-external-poc-v1/);
  assert.match(await readFile(markdownPath, "utf8"), /CardSight External POC Report/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("CardSight external POC tests passed");
