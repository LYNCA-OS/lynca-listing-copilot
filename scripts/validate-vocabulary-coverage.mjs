#!/usr/bin/env node
// Does the vocabulary actually cover the wording reviewed titles use?
//
// A vocabulary is only a positive asset if it attests the wording we are
// missing. Coverage is measured against the reviewed corpus (the SEM standard),
// not against the catalog it was derived from, which would be circular.

import { readFileSync } from "node:fs";
import { extractFinishTerms } from "../lib/listing/catalog/field-vocabulary.mjs";

const vocabPath = process.argv[2] || "data/catalog/vocabulary/field-vocabulary.json";
const labelsPath = process.argv[3] || "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl";

const vocab = JSON.parse(readFileSync(vocabPath, "utf8"));
const terms = new Map();
for (const [field, list] of Object.entries(vocab.fields || {})) {
  for (const entry of list) terms.set(`${field}::${entry.term}`, entry);
}

const titles = readFileSync(labelsPath, "utf8")
  .split(/\r?\n/).filter(Boolean)
  .map((line) => JSON.parse(line).reviewed_title || "")
  .filter(Boolean);

let withFinish = 0;
let covered = 0;
const misses = new Map();
for (const title of titles) {
  const found = extractFinishTerms(title);
  if (!found.length) continue;
  withFinish += 1;
  const hit = found.filter((term) => terms.has(`print_finish::${term}`));
  if (hit.length === found.length) covered += 1;
  for (const term of found) {
    if (!terms.has(`print_finish::${term}`)) misses.set(term, (misses.get(term) || 0) + 1);
  }
}

const rate = withFinish ? covered / withFinish : 0;
console.log(`reviewed titles: ${titles.length}`);
console.log(`  with finish wording : ${withFinish}`);
console.log(`  fully covered       : ${covered} (${(rate * 100).toFixed(1)}%)`);
console.log(`  vocabulary terms    : ${terms.size}`);
if (misses.size) {
  console.log("\nuncovered wording (top):");
  [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([term, count]) => console.log(`  ${term.padEnd(30)} x${count}`));
}

// The asset has to earn its place: if it cannot attest most of the wording the
// reviewed corpus actually uses, it is not yet a positive asset.
const threshold = Number(process.env.VOCAB_COVERAGE_MIN || "0.7");
if (rate < threshold) {
  console.log(`\nFAIL: coverage ${(rate * 100).toFixed(1)}% is below the ${(threshold * 100).toFixed(0)}% bar.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS: coverage ${(rate * 100).toFixed(1)}% meets the ${(threshold * 100).toFixed(0)}% bar.`);
}
