#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MODEL_RESIDUAL_EXPLICIT_SHORT_FIELDS_SCHEMA_V4,
  MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4,
  compactModelResidualCandidatesV4,
  inferModelResidualSinglePrintedPhraseRouteV4,
  inflateModelResidualExplicitShortFieldsV4,
  inflateModelResidualSinglePrintedPhraseV4,
  projectModelResidualExplicitShortFieldsV4,
  projectModelResidualSinglePrintedPhraseV4,
  rankModelResidualCandidatesV4,
  selectRankedModelResidualCandidatesV4,
  serializeModelResidualCompactV4
} from "../experiments/accuracy/model-residual-compact-v4.mjs";

const candidates = [
  { text: "SHORTSTOP", role: "other_visible", region: "card_front", basis: "printed_text" },
  { text: "AUTO-RED REFRACTOR", role: "finish_phrase", region: "slab_label", basis: "printed_text" },
  { text: "1ST BOWMAN", role: "identity_phrase", region: "front_symbol", basis: "printed_text" },
  { text: "PRIZM", role: "finish_phrase", region: "card_back", basis: "printed_text" },
  { text: "rainbow foil", role: "finish_phrase", region: "card_front", basis: "visual_pattern" }
];

assert.deepEqual(rankModelResidualCandidatesV4(candidates).map((row) => row.text), [
  "1ST BOWMAN", "AUTO-RED REFRACTOR", "PRIZM", "SHORTSTOP"
]);
assert.deepEqual(selectRankedModelResidualCandidatesV4(candidates, { maxItems: 1 })
  .map((row) => row.text), ["1ST BOWMAN"]);
assert.deepEqual(selectRankedModelResidualCandidatesV4(candidates, { maxItems: 2 })
  .map((row) => row.text), ["1ST BOWMAN", "AUTO-RED REFRACTOR"]);
assert.throws(() => selectRankedModelResidualCandidatesV4(candidates, { maxItems: 3 }),
  /compact_v4_max_items_must_be_1_or_2/);

const explicit = projectModelResidualExplicitShortFieldsV4(candidates);
assert.deepEqual(explicit, {
  rarity_marker: "1st Bowman",
  slab_finish: "AUTO-RED REFRACTOR"
});
assert.deepEqual(inflateModelResidualExplicitShortFieldsV4(explicit), [
  { text: "1st Bowman", role: "identity_phrase", region: "card_front", basis: "printed_text" },
  { text: "AUTO-RED REFRACTOR", role: "finish_phrase", region: "slab_label", basis: "printed_text" }
]);
assert.equal(projectModelResidualSinglePrintedPhraseV4(candidates), "1ST BOWMAN");
assert.deepEqual(inflateModelResidualSinglePrintedPhraseV4("1st Bowman"), [
  { text: "1st Bowman", role: "identity_phrase", region: "front_symbol", basis: "printed_text" }
]);
assert.deepEqual(inflateModelResidualSinglePrintedPhraseV4("AUTO-RED REFRACTOR"), [
  { text: "AUTO-RED REFRACTOR", role: "finish_phrase", region: "slab_label", basis: "printed_text" }
]);
assert.deepEqual(compactModelResidualCandidatesV4(candidates, { mode: "single_printed_phrase" }),
  inflateModelResidualSinglePrintedPhraseV4("1ST BOWMAN"));
assert.deepEqual(projectModelResidualExplicitShortFieldsV4([
  { text: "PRIZM", role: "finish_phrase", region: "card_back", basis: "printed_text" }
]), { rarity_marker: null, slab_finish: null });
assert.deepEqual(compactModelResidualCandidatesV4(candidates, { mode: "explicit_short_fields" }),
  inflateModelResidualExplicitShortFieldsV4(explicit));

const productExtension = [{
  text: "Topps Chrome", role: "identity_phrase", region: "card_front", basis: "printed_text"
}];
assert.equal(projectModelResidualSinglePrintedPhraseV4(productExtension), "Topps Chrome",
  "general single phrase preserves the highest-value complete identity extension");
assert.deepEqual(compactModelResidualCandidatesV4(productExtension, {
  mode: "single_printed_phrase", canonicalFields: { product: "Chrome" }
}), productExtension, "post-adapter infers a strict Product token extension without wire metadata");
assert.deepEqual(selectRankedModelResidualCandidatesV4(productExtension, { maxItems: 1 }),
  productExtension, "ranked max1 retains the identity extension needed for field fidelity");
assert.equal(inferModelResidualSinglePrintedPhraseRouteV4("1ST BOWMAN", {
  canonicalFields: { product: "Bowman" }
}).route, "marker", "an exact marker outranks its accidental Product token overlap");
const ambiguous = inferModelResidualSinglePrintedPhraseRouteV4("Topps Chrome Refractor", {
  canonicalFields: { product: "Chrome" }
});
assert.equal(ambiguous.ambiguous, true);
assert.equal(ambiguous.candidate.role, "other_visible", "multi-role text must fail closed");

assert.deepEqual(MODEL_RESIDUAL_EXPLICIT_SHORT_FIELDS_SCHEMA_V4.required,
  ["rarity_marker", "slab_finish"]);
assert.deepEqual(MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4.type, ["string", "null"]);
assert.equal(JSON.parse(serializeModelResidualCompactV4(candidates,
  { mode: "single_printed_phrase" })).residual_printed_phrase, "1ST BOWMAN");
assert.equal(JSON.parse(serializeModelResidualCompactV4(candidates,
  { mode: "explicit_short_fields" })).slab_finish, "AUTO-RED REFRACTOR");
assert.equal(JSON.parse(serializeModelResidualCompactV4(candidates,
  { mode: "ranked_max1" })).title_evidence.length, 1);
assert.throws(() => compactModelResidualCandidatesV4(candidates, { mode: "missing" }),
  /compact_v4_mode_invalid/);

const report = JSON.parse(readFileSync(new URL(
  "../docs/evaluation/model-residual-compact-v4-zero-call-2026-08-08.json",
  import.meta.url
), "utf8"));
assert.equal(report.decision, "HOLD_PRODUCTION");
assert.equal(report.screen_result, "TITLE_AND_FIELD_FIDELITY_PRESERVED_HOLD_INDEPENDENT_GATE");
assert.equal(report.selection.recommended_variant, "single_printed_phrase");
assert.equal(report.selection.exact_lane_fidelity, true);
assert.equal(report.selection.minimum_exact_lane_fidelity_variant, "single_printed_phrase");
assert.equal(report.variants.single_printed_phrase.full_v3_exact_title_fidelity_cards, 35);
assert.equal(report.variants.single_printed_phrase.full_v3_exact_field_fidelity_cards, 35);
assert.deepEqual(report.variants.single_printed_phrase.full_v3_field_mismatch_cards, []);
assert.equal(report.variants.single_printed_phrase.ambiguous_route_cards, 0);
const expectedMaximumSingleBytes = Buffer.byteLength(JSON.stringify({
  residual_printed_phrase: "X".repeat(MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4.maxLength)
}));
assert.equal(report.static_cost_proxy.single_printed_phrase.maximum_candidate_json_bytes,
  expectedMaximumSingleBytes);
assert.equal(report.static_cost_proxy.single_printed_phrase.maximum_candidate_json_tokens_at_4_bytes,
  Math.ceil(expectedMaximumSingleBytes / 4));

const markdown = readFileSync(new URL(
  "../docs/evaluation/model-residual-compact-v4-zero-call-2026-08-08.md",
  import.meta.url
), "utf8");
assert.match(markdown, /35\/35 resolved titles、35\/35 canonical fields/);
assert.match(markdown, new RegExp(`JSON 字节从 7987 降到 ${report.variants.single_printed_phrase.candidate_output_bytes}`));
assert.match(markdown, /general string 现在从 max1 选最高价值完整 printed phrase/);
assert.doesNotMatch(markdown, /不是完整 lane fidelity|single-string 把该 identity phrase 丢掉|只容纳一个逐字 rarity marker|single-string 不是 field-lossless|1181 bytes/);

process.stdout.write("model residual compact v4: ok\n");
