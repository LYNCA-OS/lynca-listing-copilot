#!/usr/bin/env node
// The panel must not make the resolution look better than it is.
import assert from "node:assert/strict";
import { renderCsmGlassBox } from "../app/csm-glass-box.mjs";

const view = {
  grammar: { value: "NON_TCG", resolver_version: "thin-path-observation-only-v1", review_required: false },
  composer: { length: 62, character_budget: 80, trace_reliable: true },
  summary: { with_value: 5, absent: 6, insufficient_evidence: 1, suppressed_by_profile: 2, dropped_for_budget: 0 },
  brackets: [
    { bracket: "year", label: "Year", state: "VALUE", value: "2025", composer_disposition: "INCLUDED", rationale_codes: ["OBSERVED"], semantic_confidence: "OBSERVED", evidence: {}, alternate_candidates: [], alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER", outside_contract_order: false },
    { bracket: "numerical_rarity", label: "Numerical Rarity", state: "INSUFFICIENT_EVIDENCE", value: "", composer_disposition: "NOT_APPLICABLE", rationale_codes: ["MODEL_REPORTED_UNREADABLE"], semantic_confidence: null, evidence: {}, alternate_candidates: [], alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER", outside_contract_order: false },
    { bracket: "set", label: "Set", state: "ABSENT", value: "", composer_disposition: "NOT_APPLICABLE", rationale_codes: ["NOT_OBSERVED"], semantic_confidence: null, evidence: {}, alternate_candidates: [], alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER", outside_contract_order: false },
    { bracket: "print_finish", label: "Print Finish", state: "ABSENT", value: "", composer_disposition: "NOT_APPLICABLE", rationale_codes: ["WITHHELD_BASE_APPEARANCE"], semantic_confidence: null, evidence: { withheld_observation: "Rainbow (BASE_APPEARANCE_NOT_PARALLEL)" }, alternate_candidates: [], alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER", outside_contract_order: false },
    { bracket: "observable_components", label: "Visible Components", state: "VALUE", value: "RC", composer_disposition: "INCLUDED", rationale_codes: ["OBSERVED"], semantic_confidence: "OBSERVED", evidence: {}, alternate_candidates: [], alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER", outside_contract_order: true },
    { bracket: "search_optimization", label: "Search Optimization", state: "VALUE", value: "Dodgers", composer_disposition: "SUPPRESSED_BY_PROFILE", rationale_codes: ["OBSERVED"], semantic_confidence: "OBSERVED", evidence: {}, alternate_candidates: [], alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER", outside_contract_order: false }
  ]
};

const html = renderCsmGlassBox(view, { assetIndex: 1 });

// Every bracket appears, including the empty ones.
for (const b of view.brackets) assert.ok(html.includes(`data-bracket="${b.bracket}"`), `${b.bracket} must be shown`);

// The two kinds of empty are told apart, in words and in styling.
assert.ok(html.includes("卡上没有"), "ABSENT is named");
assert.ok(html.includes("看不清"), "INSUFFICIENT_EVIDENCE is named");
assert.ok(html.includes("glass-box-insufficient_evidence"), "and is visually distinct, because it is the fixable one");

// A withheld observation is shown rather than presented as a blind spot.
assert.ok(html.includes("Rainbow"), "the withheld observation survives into the UI");
assert.ok(html.includes("未晋升"), "and is labelled as a policy decision");

// Suppression is not the same as dropping for budget.
assert.ok(html.includes("档位压制"));
assert.ok(!html.includes("预算丢弃 "), "nothing was dropped for budget here");

// COS-41 honesty.
assert.ok(html.includes("契约外"), "a bracket the grammar does not name is marked");

// No implied alternatives.
assert.ok(html.includes("SINGLE_OBSERVATION_RESOLVER"));
assert.ok(html.includes("没有备选候选"), "the absence of alternatives is stated, not left blank");
assert.ok(html.includes("不是模型的内部推理"), "a decision trace is not chain-of-thought");

// A stale trace warns rather than presenting itself as the explanation.
const drifted = renderCsmGlassBox({ ...view, composer: { ...view.composer, trace_reliable: false } }, { assetIndex: 1 });
assert.ok(drifted.includes("描述的不是已发布的那条标题"));

// Values are escaped.
const hostile = renderCsmGlassBox({ ...view, brackets: [{ ...view.brackets[0], value: '<img onerror=x>' }] }, {});
assert.ok(!hostile.includes("<img"), "values must be escaped");

console.log("csm-glass-box-ui.test.mjs OK");
