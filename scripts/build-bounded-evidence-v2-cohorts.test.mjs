#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createHash } from "node:crypto";

import {
  CONFIRMATORY_SELECTION_SALT,
  deriveBoundedEvidenceV2Cohorts
} from "./build-bounded-evidence-v2-cohorts.mjs";

const canonicalRows = Array.from({ length: 150 }, (_, index) => ({
  arm: "thin_canonical",
  asset_id: `asset-${String(index + 1).padStart(3, "0")}`
}));
const auditedRows = canonicalRows.slice(0, 100).flatMap((row) => [
  { arm: "thin_canonical_high", asset_id: row.asset_id },
  { arm: "exhaustive_observation_high", asset_id: row.asset_id }
]);
const outsideRows = Array.from({ length: 105 }, (_, index) => ({
  asset_id: `outside-${String(index + 1).padStart(3, "0")}`
}));
const datasetItems = [...canonicalRows, ...outsideRows];
const mechanismIds = canonicalRows.slice(0, 6).map(({ asset_id }) => asset_id);
const derived = deriveBoundedEvidenceV2Cohorts(
  canonicalRows, auditedRows, datasetItems, { mechanismIds }
);
assert.equal(derived.audited100.length, 100);
assert.equal(derived.screen50.length, 50);
assert.equal(derived.development150.length, 150);
assert.equal(derived.confirmatory50.length, 50);
assert.equal(derived.reserve55.length, 55);
assert.equal(derived.mechanism6.length, 6);
assert.deepEqual(derived.screen50, canonicalRows.slice(100).map(({ asset_id }) => asset_id));
const selectionHash = (id) => createHash("sha256")
  .update(`${CONFIRMATORY_SELECTION_SALT}\u0000${id}`).digest("hex");
const expectedOutside = outsideRows.map(({ asset_id }) => asset_id)
  .sort((left, right) => selectionHash(left).localeCompare(selectionHash(right)));
assert.deepEqual(derived.confirmatory50, expectedOutside.slice(0, 50));
assert.deepEqual(derived.reserve55, expectedOutside.slice(50));
assert.equal(new Set([...derived.audited100, ...derived.screen50]).size, 150);

const actualCanonical = (await readFile(
  new URL("../artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl", import.meta.url),
  "utf8"
)).split("\n").filter(Boolean).map(JSON.parse);
const actualHigh100 = (await readFile(
  new URL("../artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl", import.meta.url),
  "utf8"
)).split("\n").filter(Boolean).map(JSON.parse);
const actualDataset = JSON.parse(await readFile(
  "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json",
  "utf8"
));
const actual = deriveBoundedEvidenceV2Cohorts(actualCanonical, actualHigh100, actualDataset.items);
assert.deepEqual({
  screen: actual.screen50.length,
  audited: actual.audited100.length,
  development: actual.development150.length,
  confirmatory: actual.confirmatory50.length,
  reserve: actual.reserve55.length,
  mechanism: actual.mechanism6.length,
  overlap: actual.screen50.filter((id) => actual.audited100.includes(id)).length,
  confirmatory_development_overlap: actual.confirmatory50
    .filter((id) => actual.development150.includes(id)).length
}, { screen: 50, audited: 100, development: 150, confirmatory: 50, reserve: 55, mechanism: 6,
  overlap: 0, confirmatory_development_overlap: 0 });

assert.throws(() => deriveBoundedEvidenceV2Cohorts(
  canonicalRows.slice(0, 149), auditedRows, datasetItems, { mechanismIds }
), /canonical_v3_population_not_150/);

console.log("bounded evidence v2 cohort tests passed");
