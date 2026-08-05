import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  FOLD_COUNT, titleShape, foldFor, examplesFor, fewShotBlock, leakCheck
} from "../lib/listing/evaluation/kfold-few-shot.mjs";

const corpusPath = join(homedir(), "lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl");
let corpus = [];
try {
  corpus = (await readFile(corpusPath, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
} catch {
  process.stdout.write("kfold few-shot: skipped (eval corpus not mounted)\n");
  process.exit(0);
}

assert.equal(corpus.length, 255, "the sealed corpus is 255 reviewed titles");

// Fold assignment is stable and derived from the key, not the position. A fold
// that moved between runs would make two evaluations incomparable in a way the
// paired design cannot detect.
{
  const first = corpus.map((r) => foldFor(r.key));
  const shuffled = [...corpus].reverse().map((r) => foldFor(r.key));
  assert.deepEqual(first, [...shuffled].reverse(), "fold assignment must not depend on order");
  const sizes = new Array(FOLD_COUNT).fill(0);
  for (const f of first) sizes[f] += 1;
  for (const size of sizes) {
    assert.ok(size > corpus.length / FOLD_COUNT / 2, `folds must be roughly balanced, got ${sizes.join(",")}`);
  }
}

// THE ASSERTION THIS FILE EXISTS FOR. No card may ever see its own reviewed
// title, or a near-duplicate of it, among its examples. Checked on all 255,
// not on a sample: leakage on one card is leakage.
{
  let totalExamples = 0;
  for (const row of corpus) {
    const examples = examplesFor({ key: row.key, corpus });
    totalExamples += examples.length;
    for (const e of examples) {
      assert.notEqual(e.key, row.key, "a card must never be its own example");
      assert.notEqual(foldFor(e.key), foldFor(row.key), "examples must come from other folds");
    }
    const problems = leakCheck({ key: row.key, reviewedTitle: row.reviewed_title, examples });
    assert.deepEqual(problems, [], `leak on ${row.key}: ${problems.join("; ")}`);
  }
  assert.ok(totalExamples > 255 * 3, "every card gets a usable block, not an empty one");
}

// Stratified: a block of five raw singles would teach the same bias the
// constructed example set had, which is why that attempt was abandoned.
{
  const shapes = new Set();
  for (const row of corpus.slice(0, 40)) {
    for (const e of examplesFor({ key: row.key, corpus })) shapes.add(titleShape(e.reviewed_title));
  }
  assert.ok(shapes.has("raw") && shapes.has("graded"), "blocks must span the common shapes");
  assert.ok(shapes.has("lot") || shapes.has("tcg"), "blocks must reach the rare shapes the corpus has");
}

// Deterministic: the same card gets the same block on a rerun, so a repeated
// evaluation is comparable to itself.
{
  const a = examplesFor({ key: corpus[3].key, corpus }).map((r) => r.key);
  const b = examplesFor({ key: corpus[3].key, corpus }).map((r) => r.key);
  assert.deepEqual(a, b, "example selection must be deterministic");
}

// Two cards in the same fold must not receive an identical block, or the
// evaluation measures one example set rather than the corpus.
{
  const fold0 = corpus.filter((r) => foldFor(r.key) === 0).slice(0, 2);
  if (fold0.length === 2) {
    const a = examplesFor({ key: fold0[0].key, corpus }).map((r) => r.key).join();
    const b = examplesFor({ key: fold0[1].key, corpus }).map((r) => r.key).join();
    assert.notEqual(a, b, "blocks must vary within a fold");
  }
}

// The block shows TITLES, never fields: the schema is already followed, what
// the model has never seen is a finished output.
{
  const block = fewShotBlock(examplesFor({ key: corpus[0].key, corpus }));
  assert.match(block, /NOT this card/, "the block must forbid copying its values");
  assert.doesNotMatch(block, /"year"|"manufacturer"|parallel_family/, "titles only, not field objects");
}

// The leak checker must be able to FAIL. A guard that cannot return a problem
// is the shape of instrument this repository has shipped believing.
{
  const problems = leakCheck({
    key: "k1",
    reviewedTitle: "2025 Topps Chrome Victor Wembanyama Gold Refractor 17/50 Spurs",
    examples: [{ key: "k2", reviewed_title: "2025-26 Topps Chrome Victor Wembanyama Gold Refractor 17/50" }]
  });
  assert.ok(problems.length, "a near-duplicate example must be caught");
  assert.match(problems[0], /near-duplicate/);
}

process.stdout.write(`kfold few-shot: ok (255 cards, zero leaks, ${FOLD_COUNT} folds)\n`);
