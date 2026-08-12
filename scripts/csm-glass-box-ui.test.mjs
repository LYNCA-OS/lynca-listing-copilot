#!/usr/bin/env node
// The panel must not make the resolution look better than it is.
import assert from "node:assert/strict";
import { renderCsmGlassBox } from "../app/csm-glass-box.mjs";

// A legacy compatibility fixture proves historical extra brackets remain
// visible without being promoted into the current CSM contract.
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
assert.ok(!html.includes("glass-box-external"), "baseline cards must not grow an empty external section");

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

// An APPLIED receipt is visible as a provenance summary, never a raw payload.
const external = renderCsmGlassBox({
  ...view,
  summary: { ...view.summary, external_supported_fields: 2 },
  brackets: view.brackets.map((bracket) => bracket.bracket === "search_optimization"
    ? {
        ...bracket,
        rationale_codes: ["OBSERVED", "EXACT_EXTERNAL_IDENTITY_SUPPORT"],
        semantic_confidence: "VERIFIED_EXTERNAL",
        alternates_unavailable_reason: "EXACT_EXTERNAL_IDENTITY_RESOLUTION"
      }
    : bracket),
  external_identity_support: {
    schema_version: "csm-external-identity-public-receipt.v1",
    status: "APPLIED",
    match_basis: "VERIFIED_ORIGINAL_SET",
    registry_release: {
      id: "registry_thin_external_identity_high_risers_v1",
      registry_version: "thin-path-external-identity-high-risers-v1"
    },
    resolver_version: "thin-path-exact-external-identity-v1",
    index: { version: "tcdb-2551.psa-25618.beckett-3117708.2026-08-10" },
    supported_fields: ["card_number", "team"],
    sources: [
      {
        provider: "TCDB", source_id: "tcdb.set.2551",
        url: "https://www.tcdb.com/Checklist.cfm/sid/2551/High-Risers",
        retrieved_at: "2026-08-10", fields: ["card_number", "team"]
      },
      {
        provider: "PSA", source_id: "psa.set-registry.25618",
        url: "https://www.psacard.com/psasetregistry/composition/25618",
        retrieved_at: "2026-08-10", fields: ["card_number"]
      },
      {
        provider: "Beckett", source_id: "beckett.item.3117708",
        url: "https://www.beckett.com/basketball/item/3117708",
        retrieved_at: "2026-08-10", fields: ["card_number", "team"]
      }
    ],
    raw_registry_payload: "must-not-be-rendered"
  }
}, { assetIndex: 1 });
assert.ok(external.includes("外部身份已核验"));
assert.ok(external.includes("已验证原图集合"));
assert.ok(external.includes("外部身份来源精确核验"));
assert.ok(external.includes("registry_thin_external_identity_high_risers_v1"));
assert.ok(external.includes("tcdb-2551.psa-25618.beckett-3117708.2026-08-10"));
for (const provider of ["TCDB", "PSA", "Beckett"]) assert.ok(external.includes(`>${provider}</a>`));
assert.equal((external.match(/rel="noopener noreferrer"/g) || []).length, 3,
  "every external source opens with an opener-safe link");
assert.ok(external.includes("卡号、球队"));
assert.ok(external.includes("不展示原始 Registry payload"));
assert.ok(!external.includes("must-not-be-rendered"));

console.log("csm-glass-box-ui.test.mjs OK");
