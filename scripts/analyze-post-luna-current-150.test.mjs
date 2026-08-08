#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  analyzePostLunaCurrent150,
  buildReplaySourceContract,
  loadCorpusManifest,
  numericClaims,
  providerEvidenceText,
  reportMarkdown
} from "./analyze-post-luna-current-150.mjs";

const readJsonl = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const canonicalRows = readJsonl("artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustiveRows = readJsonl("artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
assert.deepEqual(
  [...numericClaims("49ers 76ers DF-3 #HP-10 2023-24 2/8 BGS 9.5 Lot*4 1st")],
  ["df-3", "hp-10", "2023-24", "2/8", "9.5", "4"]
);
assert.equal(
  providerEvidenceText({
    team: "Lakers",
    grammar: "standard",
    low_confidence: ["print_finish"],
    unreadable: ["card_number"],
    future_metadata: "foo"
  }).trim(),
  "Lakers",
  "metadata and unknown keys must not masquerade as provider evidence"
);
const loadedManifest = loadCorpusManifest();
assert.equal(loadedManifest.manifest.portability.clean_checkout_replayable, false);
assert.equal(loadedManifest.manifest.portability.raw_corpora_git_tracked, false);
assert.equal(loadedManifest.manifest.portability.production_copy_allowed, false);
for (const corpus of Object.values(loadedManifest.manifest.corpora)) {
  execFileSync("git", ["check-ignore", "--quiet", corpus.path]);
  assert.throws(
    () => execFileSync("git", ["ls-files", "--error-unmatch", corpus.path], { stdio: "pipe" }),
    "the manifest must not claim portability for a git-tracked raw corpus"
  );
}
assert.throws(
  () => loadCorpusManifest("docs/evaluation/does-not-exist-post-luna-manifest.json"),
  /post_luna_required_corpus_manifest_unavailable/
);
const missingCorpus = spawnSync(process.execPath, [
  "scripts/analyze-post-luna-current-150.mjs",
  "--canonical", "docs/evaluation/does-not-exist-post-luna-corpus.jsonl"
], { encoding: "utf8" });
assert.notEqual(missingCorpus.status, 0);
assert.match(missingCorpus.stderr, /post_luna_required_canonical_corpus_unavailable/);
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("post_luna_evaluation_network_forbidden");
};
let result;
try {
  result = analyzePostLunaCurrent150({ canonicalRows, exhaustiveRows });
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(networkCalls, 0);
assert.equal(result.provider_calls, 0);
assert.equal(result.production_runtime_changed, false);
assert.equal(result.cohort.cards, 150);
assert.deepEqual(result.cohort.pairing, {
  paired_assets: 150,
  reference_verified_pairs: 150,
  image_set_verified_pairs: 150,
  configuration_verified_pairs: 150
});
assert.equal(result.earliest_boundary.counts.canonical_schema_compression.token_occurrences, 109);
assert.equal(result.earliest_boundary.counts.downstream_composition.token_occurrences, 63);
assert.equal(result.accuracy_loss_ledger.fields.print_finish.dropped, 67);
assert.ok(result.constraint_removal.all_withheld_finish.delta_macro_f1 < 0);
assert.ok(result.constraint_removal.search_optimization.delta_macro_f1 < 0);
assert.ok(result.constraint_removal.card_number.delta_macro_f1 < 0);
assert.ok(result.composer_recovery.generalizable.delta_macro_f1 > 0);
assert.equal(result.composer_recovery.generalizable.losses, 0);
assert.equal(result.composer_recovery.generalizable.critical.unbacked_new_token_cards, 0);
assert.equal(result.composer_recovery.diagnostic_reference_oracle.critical.numeric_claim_add_cards, 1);
assert.equal(result.composer_recovery.diagnostic_reference_oracle.critical.unbacked_numeric_claim_cards, 0);
assert.deepEqual(new Set(result.composer_recovery.generalizable.changed_card_rows.map((row) => row.outcome)), new Set(["win"]));
assert.ok(result.composer_recovery.generalizable.changed_card_rows
  .every((row) => row.evaluation_recovery_reasons.length > 0));

const firstCanonicalIndex = canonicalRows.findIndex((row) => row.arm === "thin_canonical_high");
assert.ok(firstCanonicalIndex >= 0);
assert.throws(() => analyzePostLunaCurrent150({
  canonicalRows: canonicalRows.filter((_, index) => index !== firstCanonicalIndex),
  exhaustiveRows
}), /post_luna_complete_150_mismatch/);

assert.throws(() => analyzePostLunaCurrent150({
  canonicalRows: canonicalRows.map((row, index) => index === firstCanonicalIndex
    ? { ...row, image_set_sha256: "wrong-image" } : row),
  exhaustiveRows
}), /post_luna_image_set_mismatch/);
assert.throws(() => analyzePostLunaCurrent150({
  canonicalRows: canonicalRows.map((row, index) => index === firstCanonicalIndex
    ? { ...row, image_detail: "original" } : row),
  exhaustiveRows
}), /post_luna_nuisance_mismatch:image_detail/);

const committed = JSON.parse(readFileSync("docs/evaluation/post-luna-current-main-150-2026-08-08.json", "utf8"));
const { inputs, ...committedResult } = committed;
assert.deepEqual(committedResult, result, "the checked-in JSON must be the exact current replay");
const canonicalBody = readFileSync(inputs.canonical.path, "utf8");
const exhaustiveBody = readFileSync(inputs.exhaustive.path, "utf8");
assert.equal(inputs.canonical.sha256, sha256(canonicalBody));
assert.equal(inputs.exhaustive.sha256, sha256(exhaustiveBody));
assert.deepEqual(inputs.replay_sources, buildReplaySourceContract());
assert.equal(
  readFileSync("docs/evaluation/post-luna-current-main-150-2026-08-08.md", "utf8"),
  reportMarkdown(committed),
  "the checked-in Markdown must be generated from the checked-in JSON"
);

process.stdout.write("post-Luna current-150 analyzer: ok\n");
