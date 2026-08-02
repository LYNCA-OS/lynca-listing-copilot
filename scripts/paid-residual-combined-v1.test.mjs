#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COMBINED_POSITIVE_PAID_MECHANISMS_V1 } from "../experiments/accuracy/combined-positive-bundle-v1.mjs";
import {
  PAID_RESIDUAL_COMBINED_V1,
  paidResidualCombinedContextV1,
  runPaidResidualCombinedV1
} from "../experiments/accuracy/paid-residual-combined-v1.mjs";

const replayCandidate = (text, target, anchor, disposition = "resolver_candidate") => ({
  text, target, anchor, disposition, replay_eligible: true,
  automatic_csm_admission: false,
  automatic_renderer_admission: false
});

{
  const fields = {
    grammar: "standard",
    year: "2024",
    manufacturer: "Topps",
    product: "Chrome",
    surface_color: "Gold",
    print_finish: "Gold",
    subjects: ["A Player"]
  };
  const before = structuredClone(fields);
  const result = runPaidResidualCombinedV1(fields, [
    replayCandidate("Gold Refractor", "finish", "slab_text")
  ], { sourceFingerprint: "a".repeat(64) });
  assert.deepEqual(fields, before);
  assert.equal(result.schema_version, PAID_RESIDUAL_COMBINED_V1);
  assert.equal(result.authority, "evaluation_only");
  assert.equal(result.production_promoted, false);
  assert.equal(result.provider_calls, 0);
  assert.deepEqual(result.enabled_mechanisms, COMBINED_POSITIVE_PAID_MECHANISMS_V1);
  assert.equal(result.enabled_mechanisms.length, 11);
  assert.ok(!result.enabled_mechanisms.includes("candidate_identity_v3"));
  assert.match(result.bundle.candidate.title, /Gold Refractor/);
  assert.deepEqual(result.bundle.candidate.fields.subjects, before.subjects);
}

{
  const result = runPaidResidualCombinedV1({
    grammar: "standard",
    manufacturer: "Panini",
    product: "Prizm",
    serial: "8/25",
    subjects: ["A Player"]
  }, [replayCandidate("08/25", "serial", "stamped_number", "same_value_format_candidate")]);
  assert.equal(result.bundle.candidate.fields.serial, "08/25");
}

{
  const context = paidResidualCombinedContextV1([
    replayCandidate("NBL", "identity", "front_symbol"),
    { ...replayCandidate("Lucky Hyper", "finish", "visual"), replay_eligible: false, disposition: "candidate_only" }
  ]);
  assert.equal(context.observations.length, 1);
  assert.equal(context.observations[0].label, "logo");
  assert.equal(context.expressionFields.product, undefined,
    "ambiguous identity must not become Product/Set before a typed resolver");
}

{
  const source = readFileSync(new URL("../experiments/accuracy/paid-residual-combined-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["OPENAI_API_KEY", "SUPABASE", "fetch(", "asset_id", "reference"]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace("(", "\\("), "i"));
  }
}

console.log(`${PAID_RESIDUAL_COMBINED_V1}: ok`);
