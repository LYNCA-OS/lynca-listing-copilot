#!/usr/bin/env node
// Clause-by-clause verification of the 2026-08-04 founder decisions.
//
// Written because the first pass through them missed three clauses, and the
// only reliable way to know a decision is implemented is to assert it against
// running code rather than against my memory of having read it.
//
// Every check names the decision and the clause it comes from, so a future
// change that breaks one fails with the reason attached.
import assert from "node:assert/strict";
import {
  semTcgTitleOrder, semStandardTitleOrder, semCanonicalBracket, semTcgIpLabel,
  isSemCardNumberText, classifySemNumberBoundary
} from "../csm/ontology/sem-definition.mjs";
import { csmFieldLabels } from "../csm/ontology/field-labels.mjs";
import { BRACKET_ORDER, DROP_ORDER, composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../lib/listing/thin/marketplace-composer-rules.mjs";
import { buildCsmResolutionView } from "../csm/contracts/resolution-view.mjs";
import { routeReviewPatterns, OWNING_LAYER, CORRECTION_REASON } from "../csm/contracts/resolution-review.mjs";
import { TENANT_PERMISSIONS } from "../lib/tenant/permissions.mjs";

const results = [];
const check = (decision, clause, fn) => {
  try { fn(); results.push({ decision, clause, ok: true }); }
  catch (error) { results.push({ decision, clause, ok: false, why: error.message.split("\n")[0].slice(0, 110) }); }
};

const card = (over = {}) => ({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
  descriptive_rarity: "", subjects: ["Player"], team: "San Antonio Spurs", card_number: "150",
  serial: "17/50", attributes: ["Auto", "RC"], components: ["Auto", "RC"], grading_info: null,
  grade: "", grammar: "standard", lot_count: "", language: "", unreadable: [], low_confidence: [],
  withheld_finish_terms: [], ...over
});

// ---------------------------------------------------------------- COS-39
check("COS-39", "there is no CSM field named Product Finish", () => {
  assert.ok(!semTcgTitleOrder.includes("product_finish"));
  assert.ok(semTcgTitleOrder.includes("print_finish"));
});
check("COS-39", "the old name still resolves for stored orders", () => {
  assert.equal(semCanonicalBracket("tcg", "product_finish"), "print_finish");
});
check("COS-39", "grammar classification is validated, not assumed", () => {
  const uncorroborated = buildCsmResolutionView({
    fields: card({ grammar: "tcg" }), composed: composeFromCanonicalFields(card({ grammar: "tcg" }))
  });
  assert.equal(uncorroborated.grammar.ip_corroborated, false);
  assert.equal(uncorroborated.grammar.review_required, true);
});
check("COS-39", "Manufacturer, Product and Set stay separate canonical fields", () => {
  for (const f of ["manufacturer", "product", "set"]) assert.ok(semStandardTitleOrder.includes(f));
});
check("COS-39", "containment: Topps + Topps Chrome + Topps Chrome Update -> Topps Chrome Update", () => {
  const t = composeFromCanonicalFields(card({
    manufacturer: "Topps", product: "Topps Chrome", set: "Topps Chrome Update",
    surface_color: "", parallel_family: "", components: [], attributes: [], serial: "", card_number: ""
  })).title;
  assert.match(t, /Topps Chrome Update/);
  assert.ok(!/Topps Topps/.test(t), `mechanical concatenation: ${t}`);
});
check("COS-39", "manufacturer_product_set is not a canonical alias", () => {
  // It may translate for the Lot order, but it must not appear as a CSM field.
  assert.ok(!semStandardTitleOrder.includes("manufacturer_product_set"));
  assert.ok(!Object.keys(csmFieldLabels).includes("manufacturer_product_set"));
});

// ---------------------------------------------------------------- COS-38
check("COS-38", "TCG subset codes are Card Number", () => {
  for (const c of ["TG22/TG30", "GG01/GG70", "SV01/SV122", "086/070"]) {
    assert.ok(isSemCardNumberText(c, { grammar: "tcg", field: "card_number", checklistContext: true }), c);
  }
});
check("COS-38", "Standard 04/10 stays Numerical Rarity", () => {
  assert.equal(classifySemNumberBoundary("04/10", { grammar: "standard", field: "card_number" }).boundary,
    "NUMERICAL_RARITY");
  assert.ok(!isSemCardNumberText("TG22/TG30", { grammar: "standard", field: "card_number", checklistContext: true }));
});

// ---------------------------------------------------------------- COS-41
check("COS-41", "no Visible Components bracket in any grammar order", () => {
  for (const [g, order] of Object.entries(BRACKET_ORDER)) {
    assert.ok(!order.includes("observable_components"), `${g} still places it`);
  }
});
check("COS-41", "not declared as a CSM field label", () => {
  assert.ok(!("observable_components" in csmFieldLabels));
});
check("COS-41", "not in any drop order", () => {
  for (const [g, order] of Object.entries(DROP_ORDER)) {
    assert.ok(!order.includes("observable_components"), `${g} still ranks it`);
  }
});
check("COS-41", "Auto and RC survive the eBay profile; the team does not", () => {
  const t = composeFromCanonicalFields(card()).title;
  assert.match(t, /\bAuto\b/, `Auto missing: ${t}`);
  assert.match(t, /\bRC\b/, `RC missing: ${t}`);
  assert.ok(!/Spurs/.test(t), `team leaked: ${t}`);
});
check("COS-41", "retention is a profile policy, not a hard-coded list", () => {
  assert.ok(MARKETPLACE_PROFILES.ebay.retainWithinSuppressed?.search_optimization?.length);
});

// ---------------------------------------------------------------- COS-42
check("COS-42", "field review needs a reviewer permission writers lack", () => {
  assert.ok(TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS);
  assert.notEqual(TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS, TENANT_PERMISSIONS.EDIT_TITLE);
  assert.notEqual(TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS, TENANT_PERMISSIONS.SUBMIT_FEEDBACK);
});
check("COS-42", "one correction routes nowhere", () => {
  const one = routeReviewPatterns([{
    asset_id: "a", excluded_from_metrics: false,
    corrections: [{ bracket: "print_finish", reason: CORRECTION_REASON.MISSED_VALUE }]
  }]);
  assert.equal(one.routable.length, 0);
  assert.ok(one.observed_not_routable[0].withheld_reason);
});
check("COS-42", "a repeated pattern routes to the owning layer", () => {
  const many = routeReviewPatterns(["a", "b", "c"].map((id) => ({
    asset_id: id, excluded_from_metrics: false,
    corrections: [{ bracket: "print_finish", reason: CORRECTION_REASON.MISSED_VALUE }]
  })));
  assert.equal(many.routable[0].owning_layer, OWNING_LAYER.RECOGNITION_WORKER);
});
check("COS-42", "only a repeated wrong-bracket can reach a CSM proposal", () => {
  const many = routeReviewPatterns(["a", "b", "c"].map((id) => ({
    asset_id: id, excluded_from_metrics: false,
    corrections: [{ bracket: "card_name", reason: CORRECTION_REASON.WRONG_BRACKET }]
  })));
  assert.equal(many.routable[0].owning_layer, OWNING_LAYER.CSM_BOUNDARY_PROPOSAL);
});
check("COS-42", "every bracket including EMPTY is exposed", () => {
  const v = buildCsmResolutionView({ fields: card({ set: "" }), composed: composeFromCanonicalFields(card({ set: "" })) });
  assert.ok(v.brackets.some((b) => b.state === "ABSENT"));
  assert.ok(v.brackets.every((b) => b.alternate_candidates.length === 0));
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ✓" : "  ✗"} ${r.decision}  ${r.clause}${r.ok ? "" : `\n        ${r.why}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 条子句已落实`);
if (failed.length) process.exitCode = 1;
