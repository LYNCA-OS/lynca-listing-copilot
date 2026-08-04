#!/usr/bin/env node
// COS-42 stage 1 and 2 contracts.
import assert from "node:assert/strict";
import {
  buildCsmResolutionView, BRACKET_STATE, COMPOSER_DISPOSITION, RATIONALE
} from "../lib/listing/csm/resolution-view.mjs";
import {
  buildCsmResolutionReview, projectReviewAccuracy, REVIEW_VERDICT, CORRECTION_REASON
} from "../lib/listing/csm/resolution-review.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const run = (payload) => {
  const { fields } = parseCanonicalFields(JSON.stringify(payload));
  return { fields, composed: composeFromCanonicalFields(fields) };
};
const base = {
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
  descriptive_rarity: "", subjects: ["Shohei Ohtani"], team: "Dodgers", card_number: "150",
  serial: "17/50", attributes: ["RC"], grading_info: null, grammar: "standard",
  lot_count: "", language: "", unreadable: [], low_confidence: []
};

// --- every bracket appears, including the empty ones --------------------------
{
  const { fields, composed } = run(base);
  const view = buildCsmResolutionView({ fields, composed });
  assert.ok(view.brackets.length >= 13, "the full canonical set, not only what was rendered");
  assert.ok(view.brackets.some((b) => b.state === BRACKET_STATE.ABSENT), "EMPTY results are shown");
  // The resolver makes one observation, so alternatives are honestly empty.
  for (const b of view.brackets) {
    assert.deepEqual(b.alternate_candidates, [], "no alternatives may be implied");
    assert.equal(b.alternates_unavailable_reason, "SINGLE_OBSERVATION_RESOLVER");
    assert.equal(b.resolver_version, "thin-path-observation-only-v1");
  }
}

// --- ABSENT and INSUFFICIENT_EVIDENCE are different facts ---------------------
{
  const noSerial = run({ ...base, serial: "" });
  const absent = buildCsmResolutionView(noSerial).brackets.find((b) => b.bracket === "numerical_rarity");
  assert.equal(absent.state, BRACKET_STATE.ABSENT);
  assert.deepEqual(absent.rationale_codes, [RATIONALE.NOT_OBSERVED]);

  const unread = run({ ...base, serial: "", unreadable: ["serial"] });
  const cannotRead = buildCsmResolutionView(unread).brackets.find((b) => b.bracket === "numerical_rarity");
  assert.equal(cannotRead.state, BRACKET_STATE.INSUFFICIENT_EVIDENCE,
    "a serial we could not read is not a card without one");
  assert.deepEqual(cannotRead.rationale_codes, [RATIONALE.MODEL_REPORTED_UNREADABLE]);
}

// --- the composer trace distinguishes suppression from the budget -------------
{
  const { fields, composed } = run(base);
  const view = buildCsmResolutionView({ fields, composed });
  const so = view.brackets.find((b) => b.bracket === "search_optimization");
  assert.equal(so.state, BRACKET_STATE.VALUE, "the team was observed");
  assert.equal(so.composer_disposition, COMPOSER_DISPOSITION.SUPPRESSED_BY_PROFILE,
    "eBay removes it before the budget is consulted, which is not the same as dropping it");
}

// --- every rendered term is explained by a bracket the contract names --------
{
  const { fields, composed } = run(base);
  const view = buildCsmResolutionView({ fields, composed });
  // COS-41 decided against a [Visible Components] bracket: RC belongs to
  // [Search Optimization], which the grammar does name. So the title still has
  // to be explainable, but now with nothing outside the contract order.
  assert.match(composed.title, /\bRC\b/, "RC is in the title");
  const so = view.brackets.find((b) => b.bracket === "search_optimization");
  assert.ok(so, "and Search Optimization is the bracket that explains it");
  assert.match(so.value, /RC/);
  assert.ok(!view.brackets.some((b) => b.bracket === "observable_components"),
    "the rejected bracket must not reappear");
  assert.equal(view.summary.outside_contract_order, 0,
    "nothing is rendered from outside the grammar's own order");
}

// --- a withheld observation is a policy decision, not a blind spot ------------
{
  const { fields, composed } = run({ ...base, surface_color: "Rainbow", parallel_family: "" });
  const view = buildCsmResolutionView({ fields, composed });
  const finish = view.brackets.find((b) => b.bracket === "print_finish");
  assert.equal(finish.state, BRACKET_STATE.ABSENT);
  assert.deepEqual(finish.rationale_codes, [RATIONALE.WITHHELD_BASE_APPEARANCE]);
  assert.match(finish.evidence.withheld_observation || "", /Rainbow/,
    "the observation survives and is shown");
}

// --- REVIEW: a corrected title comes only from corrected fields ---------------
{
  const { fields, composed } = run(base);
  const provenance = {
    asset_id: "a1", recognition_session_id: "s1", resolution_id: "r1", output_id: "o1",
    resolver_version: "thin-path-observation-only-v1", composer_version: "v1",
    view_version: "csm-resolution-view-v1", reviewer_id: "u1", tenant_id: "t1"
  };
  let recomposedFrom = null;
  const review = buildCsmResolutionReview({
    provenance,
    verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.MISSED_VALUE, original_value: "", corrected_value: "Sapphire Selections" }],
    originalFields: fields,
    originalTitle: composed.title,
    recomposeTitle: (corrected) => { recomposedFrom = corrected; return composeFromCanonicalFields(corrected).title; }
  });
  assert.equal(recomposedFrom.set, "Sapphire Selections", "the recomposer sees corrected FIELDS");
  assert.match(review.corrected_title, /Sapphire Selections/);
  assert.equal(review.original_title, composed.title, "the original output is preserved");
  assert.deepEqual(review.original_fields, fields, "the original resolution is preserved");
  assert.match(review.revision_sha256, /^[0-9a-f]{64}$/);

  // There is no path that takes a human's title as input.
  assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "set", reason: CORRECTION_REASON.MISSED_VALUE, corrected_value: "X" }],
    originalFields: fields, originalTitle: composed.title
  }), /needs_recomposer/, "corrections cannot be applied without deterministic recomposition");
}

// --- REVIEW: provenance and verdict integrity --------------------------------
{
  const full = {
    asset_id: "a1", recognition_session_id: "s1", resolution_id: "r1", output_id: "o1",
    resolver_version: "v", composer_version: "v", view_version: "v", reviewer_id: "u", tenant_id: "t"
  };
  assert.throws(() => buildCsmResolutionReview({
    provenance: { ...full, resolution_id: "" }, verdict: REVIEW_VERDICT.APPROVED
  }), /missing_provenance:resolution_id/, "a review nobody can trace to a run is worse than none");
  assert.throws(() => buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.CORRECTED, corrections: []
  }), /corrected_without_corrections/);
  assert.throws(() => buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.APPROVED,
    corrections: [{ bracket: "set", reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "x" }]
  }), /approved_with_corrections/);
  // An omitted value must not pass as a deliberate blank.
  assert.throws(() => buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "set", reason: CORRECTION_REASON.INVENTED_VALUE }]
  }), /needs_value/);
  // UNDECIDED is excluded from metrics rather than counted as agreement.
  const undecided = buildCsmResolutionReview({ provenance: full, verdict: REVIEW_VERDICT.UNDECIDED });
  assert.equal(undecided.excluded_from_metrics, true);
}

// --- PROJECTION: correction rate by grammar and bracket ----------------------
{
  const full = {
    asset_id: "a", recognition_session_id: "s", resolution_id: "r", output_id: "o",
    resolver_version: "v", composer_version: "v", view_version: "v", reviewer_id: "u", tenant_id: "t"
  };
  const mk = (verdict, corrections = []) => buildCsmResolutionReview({
    provenance: full, verdict, corrections, originalFields: {}, originalTitle: "t",
    recomposeTitle: () => "t2"
  });
  const projection = projectReviewAccuracy([
    mk(REVIEW_VERDICT.APPROVED),
    mk(REVIEW_VERDICT.CORRECTED, [{ bracket: "print_finish", reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "Gold Refractor" }]),
    mk(REVIEW_VERDICT.CORRECTED, [{ bracket: "print_finish", reason: CORRECTION_REASON.MISSED_VALUE, corrected_value: "Refractor" }]),
    mk(REVIEW_VERDICT.UNDECIDED)
  ]);
  assert.equal(projection.reviews_counted, 3, "UNDECIDED is not agreement");
  assert.equal(projection.reviews_excluded, 1);
  assert.equal(projection.cells[0].bracket, "print_finish");
  assert.equal(projection.cells[0].corrections, 2);
  assert.equal(projection.cells[0].by_reason.WRONG_VALUE, 1);
}

console.log("csm-resolution-view.test.mjs OK");

// COS-39 (founder, 2026-08-04): "Grammar classification must happen first",
// because each grammar then applies its own domain validation -- a Pokemon card
// must not receive Gold Refractor. A TCG claim the contract cannot corroborate
// is therefore a review case.
//
// Surfaced, never corrected. Across 255 cards the model claimed TCG five times
// and the IP table recognised one; of the remaining four, two are genuinely
// wrong (Topps Chrome Disney is an Entertainment product COS-8 covers) and two
// are genuinely right and invisible to the table, which reads `product` while
// those cards carry "Mega Brave" or nothing at all. Forcing Standard whenever
// the table is silent would fix two and break two.
{
  const pokemon = run({ ...base, grammar: "tcg", product: "Pokemon SWSH", set: "Lost Origin", language: "EN" });
  const pv = buildCsmResolutionView(pokemon);
  assert.equal(pv.grammar.value, "TCG");
  assert.equal(pv.grammar.ip_corroborated, true);
  assert.equal(pv.grammar.review_required, false, "a corroborated TCG claim is not a review case");

  const disney = run({ ...base, grammar: "tcg", product: "Topps Chrome", set: "" });
  const dv = buildCsmResolutionView(disney);
  assert.equal(dv.grammar.ip_corroborated, false);
  assert.equal(dv.grammar.review_required, true, "an uncorroborated TCG claim must be visible");

  // Standard cards are not interrogated about an IP they never claimed.
  const sv = buildCsmResolutionView(run(base));
  assert.equal(sv.grammar.ip_corroborated, null);
  assert.equal(sv.grammar.review_required, false);
}

console.log("csm-resolution-view grammar-corroboration assertions OK");

// COS-42's approved learning flow: accumulate, group, review, then route. No
// single correction changes anything, and the routing threshold is the rule
// rather than a tuning knob.
{
  const { routeReviewPatterns, OWNING_LAYER } = await import("../csm/contracts/resolution-review.mjs");
  const prov = (asset) => ({
    asset_id: asset, recognition_session_id: "s", resolution_id: "r", output_id: "o",
    resolver_version: "v", composer_version: "v", view_version: "v", reviewer_id: "u", tenant_id: "t"
  });
  const mk = (asset, bracket, reason) => buildCsmResolutionReview({
    provenance: prov(asset), verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket, reason, corrected_value: "x" }],
    originalFields: {}, originalTitle: "t", recomposeTitle: () => "t2"
  });

  const routed = routeReviewPatterns([
    mk("a1", "print_finish", CORRECTION_REASON.MISSED_VALUE),
    mk("a2", "print_finish", CORRECTION_REASON.MISSED_VALUE),
    mk("a3", "print_finish", CORRECTION_REASON.MISSED_VALUE),
    mk("b1", "card_name", CORRECTION_REASON.WRONG_BRACKET)
  ]);
  const finish = routed.routable.find((r) => r.bracket === "print_finish");
  assert.ok(finish, "three distinct assets is a pattern");
  assert.equal(finish.owning_layer, OWNING_LAYER.RECOGNITION_WORKER,
    "a repeated observation failure belongs to Recognition, not to CSM");

  // One correction routes nowhere, and says why rather than going silent.
  const single = routed.observed_not_routable.find((r) => r.bracket === "card_name");
  assert.ok(single, "it is still reported");
  assert.equal(single.routable, false);
  assert.match(single.withheld_reason, /1 of the 3 distinct assets/);
  assert.equal(single.owning_layer, OWNING_LAYER.CSM_BOUNDARY_PROPOSAL,
    "a wrong bracket is the one signal that can reach CSM -- when repeated");

  // The same card reviewed repeatedly must not promote itself.
  const repeated = routeReviewPatterns([
    mk("same", "product", CORRECTION_REASON.WRONG_VALUE),
    mk("same", "product", CORRECTION_REASON.WRONG_VALUE),
    mk("same", "product", CORRECTION_REASON.WRONG_VALUE)
  ]);
  assert.equal(repeated.routable.length, 0,
    "three revisions of one asset is one pattern seen once");
  assert.equal(repeated.observed_not_routable[0].occurrences, 3);
  assert.equal(repeated.observed_not_routable[0].distinct_assets, 1);

  // Excluded reviews carry no weight at all.
  const undecided = buildCsmResolutionReview({ provenance: prov("u1"), verdict: REVIEW_VERDICT.UNDECIDED });
  assert.equal(routeReviewPatterns([undecided]).routable.length, 0);
}

console.log("csm-resolution-view learning-flow assertions OK");
