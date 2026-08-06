#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  analyzeComplementarity,
  score,
  tokens,
  validateCohort
} from "./analyze-bare-canonical-complementarity-v1.mjs";

assert.deepEqual(tokens("2024-25 Star Wars 027/150"), ["2024", "25", "star", "wars", "027/150"]);
assert.equal(score("Star Wars", "Star Wars").f1, 1);
assert.equal(score("Star Wars", "Star").recall, 0.5);

const rowsPath = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const manifestPath = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.manifest.json";
const exhaustivePath = "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl";
const rows = readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const exhaustive = readFileSync(exhaustivePath, "utf8").split("\n").filter(Boolean).map(JSON.parse);

validateCohort(rows, manifest, exhaustive);
const result = analyzeComplementarity(rows, exhaustive);
assert.deepEqual(result.headline.pair_signs, { bare_wins: 44, canonical_wins: 95, ties: 11 });
assert.equal(result.deployment_boundary.production_selector, false);
assert.equal(result.deployment_boundary.provider_calls, 0);
assert.equal(result.unions.token_union.delta_vs_canonical < 0, true);
assert.equal(result.same_call_residual_slot.verdict, "TESTABLE_NOT_PROVEN");

process.stdout.write("bare/canonical complementarity audit: ok\n");
