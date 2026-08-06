#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COMBINED_POSITIVE_BUNDLE_V1,
  COMBINED_POSITIVE_MECHANISMS_V1,
  runCombinedPositiveBundleV1
} from "../experiments/accuracy/combined-positive-bundle-v1.mjs";

const observation = (evidence, label, region = "card_back") => ({
  evidence,
  label,
  region,
  kind: "printed_text",
  confidence: "high"
});
const provenance = { source: "fixture", checkpoint_sha256: "fixture" };

{
  const fields = {
    grammar: "standard",
    year: "2018",
    manufacturer: "Panini",
    product: "Prizm",
    subjects: ["Jalen Brunson"]
  };
  const before = structuredClone(fields);
  const replay = runCombinedPositiveBundleV1(fields, {
    observations: [observation("2018-19 PANINI - PRIZM BASKETBALL", "set")],
    provenance,
    enabledMechanisms: ["phrase_aware_resolver_guard"]
  });
  assert.deepEqual(fields, before, "evaluation bundle must not mutate caller fields");
  assert.equal(replay.schema_version, COMBINED_POSITIVE_BUNDLE_V1);
  assert.equal(replay.authority, "evaluation_only");
  assert.equal(replay.production_promoted, false);
  assert.equal(replay.provider_calls, 0);
  assert.match(replay.candidate.title, /^2018-19 /);
  assert.deepEqual(replay.stages.map((row) => row.mechanism), COMBINED_POSITIVE_MECHANISMS_V1);
  assert.equal(replay.stages.filter((row) => row.changed_title).length, 1);
}

{
  const replay = runCombinedPositiveBundleV1({
    grammar: "standard",
    year: "2026",
    manufacturer: "Topps",
    product: "Chrome",
    set: "",
    subjects: ["A Player"]
  }, {
    observations: [observation("STAR WARS", "logo", "card_front")],
    provenance,
    enabledMechanisms: ["phrase_aware_resolver_guard"]
  });
  assert.equal(replay.candidate.title, replay.baseline.title,
    "generic logo identity must remain candidate-only");
  const phrase = replay.stages.find((row) => row.mechanism === "phrase_aware_resolver_guard");
  assert.ok(phrase.decisions.some((row) => row.admission_reason === "generic_logo_identity_role_hold"));
  assert.equal(phrase.actions.length, 0);
}

{
  const replay = runCombinedPositiveBundleV1({
    grammar: "lot",
    lot_count: "3",
    year: "2026",
    manufacturer: "Topps",
    product: "Bowman Chrome",
    subjects: ["A Player"]
  }, { enabledMechanisms: ["compact_lot_quantity"] });
  assert.match(replay.candidate.title, /^lotx3\b/);
  assert.doesNotMatch(replay.candidate.title, /Card Lot/);
  assert.equal(replay.stages.filter((row) => row.changed_title).length, 1);
}

{
  const fields = { grammar: "standard", year: "2026", subjects: ["A Player"] };
  const replay = runCombinedPositiveBundleV1(fields, { enabledMechanisms: [] });
  assert.equal(replay.candidate.title, replay.baseline.title);
  assert.equal(replay.stages.some((row) => row.changed_title), false);
  assert.throws(
    () => runCombinedPositiveBundleV1(fields, { enabledMechanisms: ["not_a_mechanism"] }),
    /unknown_combined_positive_mechanism/
  );
}

{
  const source = readFileSync(new URL("../experiments/accuracy/combined-positive-bundle-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["asset_id", "reference"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), `rule boundary reads ${forbidden}`);
  }
  for (const excluded of [
    "typed_grade_compaction",
    "typed_patch_relic_compaction",
    "typed_product_parent",
    "manufacturer_product_set",
    "shared_observable_components",
    "shared_grading_info"
  ]) {
    assert.doesNotMatch(source, new RegExp(`"${excluded}"`), `excluded mechanism entered bundle: ${excluded}`);
  }
}

console.log(`${COMBINED_POSITIVE_BUNDLE_V1}: ok`);
