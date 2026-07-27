import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSealedLabels } from "./v4-ebay-smoke.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "v4-sealed-labels-"));
try {
  await assert.rejects(
    readSealedLabels(path.join(root, "missing.jsonl"), { required: true }),
    /sealed_labels_unreadable/
  );

  const emptyPath = path.join(root, "empty.jsonl");
  await writeFile(emptyPath, "\n");
  await assert.rejects(readSealedLabels(emptyPath, { required: true }), /sealed_labels_empty/);

  const validPath = path.join(root, "valid.jsonl");
  await writeFile(validPath, `${JSON.stringify({
    key: "reviewed_case_1",
    reviewed_title: "2025 Topps Chrome Test Player"
  })}\n`);
  const labels = await readSealedLabels(validPath, { required: true });
  assert.equal(labels.get("reviewed_case_1")?.reviewed_title, "2025 Topps Chrome Test Player");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("v4 sealed label preflight tests passed");
