import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGapRow, main } from "./catalog-promote-gap-queue.mjs";

const acceptedForReview = evaluateGapRow({
  code: "CRA-YY",
  runs: 2,
  players: JSON.stringify(["Yoshinobu Yamamoto"]),
  year: "2024",
  product: "Bowman Chrome"
}, "2024 Bowman Chrome Yoshinobu Yamamoto");
assert.equal(acceptedForReview.review_candidate, true);
assert.equal(acceptedForReview.year, "2024");

const taskDirectory = await mkdtemp(join(tmpdir(), "catalog-gap-review-packet-"));
try {
  const gapPath = join(taskDirectory, "gap.json");
  const labelsPath = join(taskDirectory, "labels.jsonl");
  const outPath = join(taskDirectory, "review-packet.json");
  await writeFile(gapPath, JSON.stringify([
    {
      asset_id: "ebay_image_only_case-1",
      code: "CRA-YY",
      collector_number: "CRA-YY",
      runs: 2,
      players: JSON.stringify(["Yoshinobu Yamamoto"]),
      year: "2024",
      manufacturer: "Topps",
      product: "Bowman Chrome"
    },
    {
      asset_id: "ebay_image_only_case-2",
      code: "136",
      runs: 1,
      players: JSON.stringify(["Cooper Flagg"]),
      year: "2025",
      product: "Topps Chrome Basketball"
    }
  ]), "utf8");
  await writeFile(labelsPath, [
    JSON.stringify({ case_id: "case-1", title: "2024 Bowman Chrome Yoshinobu Yamamoto" }),
    JSON.stringify({ case_id: "case-2", title: "2025 Topps Chrome Basketball Cooper Flagg" })
  ].join("\n"), "utf8");

  const result = await main([
    "node",
    "catalog-promote-gap-queue.mjs",
    "--gap", gapPath,
    "--labels", labelsPath,
    "--out", outPath
  ]);
  const output = await readFile(outPath, "utf8");
  const packet = JSON.parse(output);

  assert.equal(result.reviewCandidates.length, 1);
  assert.equal(packet.schema_version, "catalog-gap-review-packet-v1");
  assert.equal(packet.source_type, "MARKETPLACE_REFERENCE");
  assert.equal(packet.catalog_write_allowed, false);
  assert.equal(packet.independent_ground_truth, false);
  assert.equal(packet.candidates[0].candidate_status, "REVIEW_REQUIRED");
  assert.equal(packet.candidates[0].provenance.reviewed_internal, false);
  assert.equal(packet.rejected[0].reason, "insufficient_run_consensus");
  assert.equal(/\binsert\s+into\b/i.test(output), false);
  assert.equal(/catalog_(products|sets|cards|parallels)/i.test(output), false);
} finally {
  await rm(taskDirectory, { recursive: true, force: true });
}

console.log("catalog gap review packet tests passed");
