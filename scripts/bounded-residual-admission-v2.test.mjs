#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOUNDED_RESIDUAL_ADMISSION_V2,
  BOUNDED_RESIDUAL_ADMISSION_V2_ALLOWED_FIELDS,
  applyBoundedResidualAdmissionV2
} from "../experiments/accuracy/bounded-residual-admission-v2.mjs";

const candidate = (text, overrides = {}) => ({
  text,
  target: "marker",
  anchor: "front_text",
  replay_eligible: true,
  disposition: "resolver_candidate",
  reason: "bounded_literal_marker",
  automatic_csm_admission: false,
  automatic_renderer_admission: false,
  ...overrides
});

const base = {
  grammar: "standard",
  year: "2024",
  manufacturer: "Topps",
  product: "Bowman Chrome",
  subjects: ["A Player"],
  serial: "7/25",
  attributes: ["Auto", "1st Edition"],
  components: ["Auto"],
  descriptive_rarity: "1st Edition"
};

{
  const before = structuredClone(base);
  const result = applyBoundedResidualAdmissionV2(base, [candidate("1ST BOWMAN")]);
  assert.deepEqual(base, before, "caller fields must remain immutable");
  assert.equal(result.schema_version, BOUNDED_RESIDUAL_ADMISSION_V2);
  assert.equal(result.authority, "evaluation_only");
  assert.equal(result.production_promoted, false);
  assert.equal(result.provider_calls, 0);
  assert.equal(result.fields.descriptive_rarity, "1st Bowman");
  assert.match(result.title, /\b1st\b/i);
  assert.doesNotMatch(result.title, /\bEdition\b/i);
  assert.deepEqual(result.changed_fields, ["descriptive_rarity"]);
  assert.ok(Object.values(result.guards).every(Boolean));
}

for (const marker of ["RC", "Rookie Card", "Rated Rookie"]) {
  const result = applyBoundedResidualAdmissionV2({ ...base, attributes: ["Auto"], components: ["Auto"], descriptive_rarity: "" }, [
    candidate(marker, { anchor: "front_symbol" })
  ]);
  assert.deepEqual(result.fields.attributes, ["RC", "Auto"]);
  assert.deepEqual(result.fields.components, ["RC", "Auto"]);
  assert.match(result.title, /\bRC\b/);
}

for (const marker of ["SP", "SSP", "1st Edition"]) {
  const result = applyBoundedResidualAdmissionV2({ ...base, attributes: ["Auto"], components: ["Auto"], descriptive_rarity: "" }, [
    candidate(marker, { anchor: "slab_text" })
  ]);
  assert.equal(result.fields.descriptive_rarity, marker);
}

{
  const result = applyBoundedResidualAdmissionV2(base, [
    candidate("SSP"),
    candidate("SP")
  ]);
  assert.deepEqual(result.fields, base);
  assert.ok(result.decisions.filter(({ reason }) => reason === "multiple_rarity_markers_conflict").length === 2);
}

{
  const result = applyBoundedResidualAdmissionV2(base, [
    candidate("Auto", { replay_eligible: false, disposition: "candidate_only",
      reason: "component_or_rarity_role_requires_resolution" }),
    candidate("27/99", { target: "serial", anchor: "stamped_number",
      disposition: "same_value_format_candidate" })
  ]);
  assert.deepEqual(result.fields, base);
  assert.equal(result.applied, false);
  assert.ok(result.decisions.some(({ reason }) => reason === "physical_component_requires_independent_evidence"));
  assert.ok(result.decisions.some(({ reason }) => reason === "serial_out_of_scope"));
}

{
  const result = applyBoundedResidualAdmissionV2({ ...base, descriptive_rarity: "Case Hit" }, [candidate("SSP")]);
  assert.equal(result.fields.descriptive_rarity, "Case Hit");
  assert.ok(result.decisions.some(({ reason }) => reason === "descriptive_rarity_conflict"));
}

{
  const forged = applyBoundedResidualAdmissionV2(base, [candidate("1st Bowman", {
    automatic_csm_admission: true
  })]);
  assert.deepEqual(forged.fields, base);
  assert.ok(forged.decisions.some(({ reason }) => reason === "parser_approval_missing"));
}

{
  const titleOnlyBaseline = "lotx3 2024 Topps Chrome A Player";
  const unchanged = applyBoundedResidualAdmissionV2(base, [], { baselineTitle: titleOnlyBaseline });
  assert.equal(unchanged.title, titleOnlyBaseline, "a title-only upstream mechanism must survive a no-op admission");
  const rejected = applyBoundedResidualAdmissionV2(base, [candidate("1st Bowman")], {
    baselineTitle: titleOnlyBaseline
  });
  assert.equal(rejected.title, titleOnlyBaseline, "non-replayable upstream title must fail closed");
  assert.equal(rejected.applied, false);
  assert.equal(rejected.guards.inherited_title_replayable_when_admitting, false);
}

{
  assert.deepEqual(BOUNDED_RESIDUAL_ADMISSION_V2_ALLOWED_FIELDS,
    ["attributes", "components", "descriptive_rarity"]);
  const source = readFileSync(new URL("../experiments/accuracy/bounded-residual-admission-v2.mjs", import.meta.url), "utf8");
  for (const forbidden of ["OPENAI_API_KEY", "SUPABASE", "fetch(", "asset_id", "reference"]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace("(", "\\("), "i"));
  }
}

console.log(`${BOUNDED_RESIDUAL_ADMISSION_V2}: ok`);
