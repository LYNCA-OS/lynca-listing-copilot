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

// --- a bracket the composer places but the contract does not is flagged -------
{
  const { fields, composed } = run(base);
  const view = buildCsmResolutionView({ fields, composed });
  const comps = view.brackets.find((b) => b.bracket === "observable_components");
  assert.ok(comps, "RC appears in the title, so a bracket must explain it");
  assert.equal(comps.outside_contract_order, true, "COS-41: the position is an inference");
  assert.equal(view.summary.outside_contract_order, 1);
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
