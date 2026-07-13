import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectEbayEvaluationHistory, githubArtifacts } from "./collect-ebay-evaluation-history.mjs";

const root = await mkdtemp(join(tmpdir(), "lynca-eval-history-test-"));
try {
  const seed = join(root, "seed.jsonl");
  const artifactRoot = join(root, "artifact");
  const nested = join(artifactRoot, "nested");
  const output = join(root, "history.jsonl");
  await mkdir(nested, { recursive: true });
  await writeFile(seed, `${JSON.stringify({ item_id: "item-1", title: "must not copy" })}\n`);
  await writeFile(join(nested, "fresh-sealed-labels.jsonl"), [
    JSON.stringify({ item_id: "item-1", title: "duplicate" }),
    JSON.stringify({ item_id: "item-2", title: "must not copy" })
  ].join("\n") + "\n");
  await writeFile(join(nested, "unrelated.jsonl"), `${JSON.stringify({ item_id: "item-3" })}\n`);

  const result = await collectEbayEvaluationHistory({
    seedPaths: [seed],
    artifactRoots: [artifactRoot],
    outPath: output
  });
  assert.equal(result.unique_item_count, 2);
  assert.equal(result.source_file_count, 2);
  assert.deepEqual(result.rows.map((row) => row.item_id), ["item-1", "item-2"]);
  assert.equal(result.rows[0].source_count, 2);
  const persisted = (await readFile(output, "utf8")).trim().split(/\n/).map(JSON.parse);
  assert.deepEqual(persisted, result.rows);
  assert.equal(JSON.stringify(persisted).includes("must not copy"), false);

  const reviewedSeed = join(root, "reviewed-seed.jsonl");
  const reviewedOutput = join(root, "reviewed-history.jsonl");
  await writeFile(reviewedSeed, `${JSON.stringify({ source_feedback_id: "feedback-1", reviewed_title: "must not copy" })}\n`);
  const reviewed = await collectEbayEvaluationHistory({
    seedPaths: [reviewedSeed],
    outPath: reviewedOutput,
    idFields: ["source_feedback_id"],
    outputField: "source_feedback_id"
  });
  assert.equal(reviewed.unique_item_count, 1);
  assert.equal(reviewed.rows[0].source_feedback_id, "feedback-1");
  assert.equal(JSON.stringify(reviewed.rows).includes("must not copy"), false);

  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: index === 0 ? "fresh-ebay-smoke-report" : "unrelated",
    expired: false
  }));
  const requestedPages = [];
  const artifacts = await githubArtifacts({
    repository: "LYNCA-OS/lynca-listing-copilot",
    token: "test-token",
    fetchImpl: async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      return new Response(JSON.stringify({
        artifacts: page === 1
          ? firstPage
          : [{ id: 101, name: "unseen-ebay-soak-report", expired: false }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(artifacts.map((artifact) => artifact.id), [1, 101]);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("eBay evaluation history tests passed");
