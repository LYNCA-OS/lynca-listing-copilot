#!/usr/bin/env node

import assert from "node:assert/strict";

import { analyzeResidualEvidenceLaneV1 } from "./analyze-residual-evidence-lane-v1.mjs";

const report = await analyzeResidualEvidenceLaneV1();
assert.equal(report.provider_calls, 0);
assert.equal(report.production_promoted, false);
assert.equal(report.inputs.ledger.sha256,
  "5d1719d32752ccfd6039769488aba3d34afda39fb0d4d14994d2148a9cff682a");
assert.equal(report.inputs.canonical.sha256,
  "2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5");
assert.equal(report.inputs.candidates.sha256,
  "39fbbaeef1c9bd2d01d74aaf36c3a1380e9901d26b76dac502756a91811d5819");
assert.equal(report.inputs.exhaustive.sha256,
  "96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9");
assert.equal(report.inputs.production_canonical.sha256,
  "173ccdb000ba0b7328e602abf84f77e376efc8fc8220fdf249f78e208d4d89b8");
assert.equal(report.cohort.cards, 150);
assert.equal(report.cohort.stage_one_occurrences, 255);

const routeCounts = Object.values(report.route_decomposition).map(({ occurrences }) => occurrences);
assert.equal(routeCounts.reduce((sum, value) => sum + value, 0), 255);
assert.equal(report.route_decomposition.already_canonical_downstream.occurrences, 7);
assert.equal(report.route_decomposition.surface_form_or_grammar_review.occurrences, 12);
assert.equal(report.route_decomposition.direct_text_symbol_or_stamp_attention.occurrences, 79);
assert.equal(report.route_decomposition.visual_or_catalog_semantics.occurrences, 96);
assert.equal(report.route_decomposition.identity_or_world_resolution.occurrences, 37);
assert.equal(report.route_decomposition.ambiguous_numeric_context.occurrences, 24);

assert.equal(report.minimal_lane_coverage.structurally_eligible_occurrences, 233);
assert.equal(report.minimal_lane_coverage.cap_coverage[4].token_occurrences, 229);
assert.equal(report.minimal_lane_coverage.cap_coverage[4].uncovered, 4);

assert.equal(report.alternative_prompt_capture_proxy.matched_occurrences, 13);
assert.equal(report.alternative_prompt_capture_proxy.true_absent_occurrences, 10);
assert.equal(report.alternative_prompt_capture_proxy.already_canonical_shadow_occurrences, 3);

assert.equal(report.unsafe_direct_concat_proxy.wins, 10);
assert.equal(report.unsafe_direct_concat_proxy.losses, 140);
assert.equal(report.unsafe_direct_concat_proxy.ties, 0);
assert.ok(report.unsafe_direct_concat_proxy.delta_macro_f1 < -0.13);
assert.equal(report.unsafe_direct_concat_proxy.numeric_unhelpful_tokens, 150);
assert.equal(report.unsafe_direct_concat_proxy.proxy_over_80_cards, 144);

assert.equal(report.request_budget.prompt_delta_bytes, 611);
assert.equal(report.request_budget.schema_delta_bytes, 503);
assert.equal(report.request_budget.prompt_plus_schema_delta_bytes, 1114);
assert.equal(report.request_budget.four_max_rows_output_bytes, 543);
assert.equal(report.request_budget.max_output_tokens_unchanged, 4096);

assert.equal(report.tail_probability_math.zero_events_required_for_0_1_percent_at_95_confidence, 2995);
assert.equal(report.tail_probability_math.zero_events_required_for_0_1_percent_at_99_confidence, 4603);

console.log("residual evidence lane v1 analysis: ok");
