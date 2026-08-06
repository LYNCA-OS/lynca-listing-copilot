#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  ACCURACY_PHRASE_AWARE_RESOLVER_V1,
  buildPhraseAwareCandidatesV1,
  resolvePhraseAwareCandidateV1,
  resolvePhraseAwareCandidatesV1
} from "../lib/listing/thin/accuracy-phrase-aware-resolver-v1.mjs";

const provenance = { source: "fixture_exhaustive_observation_high", checkpoint_sha256: "fixture" };
const row = (evidence, label, region = "card_front", kind = "printed_text", confidence = "high") => ({
  evidence, label, region, kind, confidence
});

function decisions(fields, observations) {
  return resolvePhraseAwareCandidatesV1(
    fields,
    buildPhraseAwareCandidatesV1(fields, observations, { provenance })
  );
}

{
  const fields = { grammar: "standard", product: "Topps Chrome", set: "" };
  const input = [row("STAR WARS", "logo")];
  const before = structuredClone(fields);
  const output = decisions(fields, input);
  assert.deepEqual(fields, before, "resolver must not mutate canonical fields");
  assert.equal(output.length, 1);
  assert.equal(output[0].candidate_field, "set");
  assert.equal(output[0].candidate_value, "Star Wars");
  assert.equal(output[0].decision, "admit");
  assert.equal(output[0].admission_reason, "exact_registered_identity_phrase_into_empty_typed_field");
  assert.equal(output[0].observation_phrase, "STAR WARS");
  assert.equal(output[0].source_role, "logo");
  assert.equal(output[0].provenance.source, provenance.source);
  for (const forbidden of ["title", "reference", "fields", "asset_id"]) {
    assert.equal(Object.hasOwn(output[0], forbidden), false, `decision leaked ${forbidden}`);
  }
}

{
  const fields = { grammar: "tcg", product: "Topps Chrome", ip: "" };
  const output = decisions(fields, [row("Disney", "logo")]);
  assert.equal(output[0].candidate_field, "ip");
  assert.equal(output[0].candidate_value, "Disney");
  assert.equal(output[0].decision, "admit");
}

{
  const fields = { year: "2018" };
  const output = decisions(fields, [
    row("2018-19 PANINI - PRIZM BASKETBALL", "set", "card_back"),
    row("2018-19 PANINI - HOOPS BASKETBALL", "copyright_set_line", "card_back")
  ]);
  assert.equal(output[0].candidate_value, "2018-19");
  assert.equal(output[0].decision, "admit");
  assert.equal(output[1].decision, "reject");
  assert.equal(output[1].admission_reason, "wrong_role_copyright");
}

{
  const output = decisions({ year: "2024" }, [row("24-25", "season", "card_back")]);
  assert.equal(output[0].candidate_value, "2024-25");
  assert.equal(output[0].decision, "admit");
  assert.equal(decisions({ year: "2025" }, [row("24-25", "season", "card_back")]).length, 0,
    "short season must not rewrite an ending-year canonical value backwards");
}

{
  const fields = { product: "Topps Signature Class", card_name: "" };
  const output = decisions(fields, [row("PICK 2", "unknown")]);
  assert.equal(output[0].candidate_field, "card_name");
  assert.equal(output[0].candidate_value, "Pick 2");
  assert.equal(output[0].decision, "admit");
}

{
  const fields = { product: "Bowman Chrome", set: "" };
  const output = decisions(fields, [row("2024 BOWMAN DRAFT", "set", "slab_label")]);
  assert.equal(output[0].candidate_field, "set");
  assert.equal(output[0].candidate_value, "Draft");
  assert.equal(output[0].decision, "admit");
  assert.equal(output[0].observation_phrase, "2024 BOWMAN DRAFT");
}

{
  const fields = { product: "Donruss Football" };
  const output = decisions(fields, [row("OPTIC", "logo")]);
  assert.equal(output[0].candidate_value, "Donruss Optic Football");
  assert.equal(output[0].decision, "admit");
}

{
  const output = decisions({}, [
    row("Walter capped an outstanding rookie season", "biographical_text", "card_back"),
    row("Player wearing a blue uniform", "player_image", "card_front", "visual_property"),
    row("Horizontal maroon and white striped bands", "pattern", "card_back", "visual_property"),
    row("© 2026 THE TOPPS COMPANY, INC. ALL RIGHTS RESERVED.", "copyright_line", "card_back"),
    row("2025*", "statistic_year", "card_back"),
    row("Player wearing a red batting helmet", "player image", "card_front", "visual_property")
  ]);
  assert.deepEqual(output.map((item) => item.decision), ["reject", "reject", "reject", "reject", "reject", "reject"]);
  assert.deepEqual(output.map((item) => item.admission_reason), [
    "wrong_role_biography",
    "wrong_role_uniform_background_or_layout",
    "wrong_role_uniform_background_or_layout",
    "wrong_role_copyright",
    "wrong_role_statistics",
    "wrong_role_uniform_background_or_layout"
  ]);
}

{
  const partial = buildPhraseAwareCandidatesV1({}, [row("STAR", "logo"), row("WARS", "logo")], { provenance });
  assert.equal(partial.length, 0, "split tokens must not recreate a registered phrase");
}

{
  const candidate = buildPhraseAwareCandidatesV1(
    { product: "Topps Signature Class", card_name: "" },
    [row("PICK 2", "unknown")],
    { provenance: {} }
  )[0];
  const resolved = resolvePhraseAwareCandidateV1({}, candidate);
  assert.equal(resolved.decision, "reject");
  assert.equal(resolved.admission_reason, "invalid_or_missing_provenance");
}

console.log(`${ACCURACY_PHRASE_AWARE_RESOLVER_V1}: ok`);
