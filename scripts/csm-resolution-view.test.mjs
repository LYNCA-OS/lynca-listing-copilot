#!/usr/bin/env node
// COS-42 stage 1 and 2 contracts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildCsmResolutionView, BRACKET_STATE, COMPOSER_DISPOSITION, RATIONALE
} from "../lib/listing/csm/resolution-view.mjs";
import {
  CSM_TCG_GRAMMAR_CONTEXT_AUTHORITY_PUBLIC_RECEIPT_VERSION,
  publicDurableProjectionReceipts
} from "../api/csm-resolution-view.js";
import {
  buildCsmResolutionReview, buildReviewMeasurementSnapshot, projectReviewAccuracy,
  REVIEW_VERDICT, CORRECTION_REASON, REVIEW_MEASUREMENT_BASIS,
  CAPTURED_REVIEW_MEASUREMENT_SNAPSHOT_VERSION,
  CSM_REVIEW_MEASUREMENT_SNAPSHOT_VERSION
} from "../lib/listing/csm/resolution-review.mjs";
import {
  CANONICAL_FIELDS_PARSER_SEMANTICS,
  parseCanonicalFields
} from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  buildCsmStageRows,
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  CSM_WRITER_PROJECTION_CONTRACTS
} from "../lib/listing/thin/csm-projection-activation.mjs";
import { finishCanonicalFields } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import {
  PUBLICATION_DISPOSITION,
  createPublicationCoverage
} from "../lib/listing/thin/publication-coverage.mjs";

const coverage = (atoms) => createPublicationCoverage(atoms.map((atom) => ({
  source_index: 0,
  ...atom
})));

const run = (payload) => {
  const { fields } = parseCanonicalFields(JSON.stringify(payload));
  return {
    fields,
    composed: composeFromCanonicalFields(fields, {
      features: {
        durable_lot_terminal_shared_only: true,
        publication_coverage: true
      }
    })
  };
};
const base = {
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
  descriptive_rarity: "", subjects: ["Shohei Ohtani"], team: "Dodgers", card_number: "150",
  serial: "17/50", attributes: ["RC"], grading_info: null, grammar: "standard",
  lot_count: "", language: "", unreadable: [], low_confidence: []
};

const measurementFor = (provenance, grammar = "standard", confidence = "OBSERVED") =>
  buildReviewMeasurementSnapshot({
    view: {
      schema_version: provenance.view_version,
      asset_id: provenance.asset_id,
      recognition_session_id: provenance.recognition_session_id,
      grammar: { raw: grammar },
      composer: { title: "t", character_budget: 80, length: 1, truncated: false },
      brackets: ["set", "print_finish", "card_name", "product"].map((bracket) => ({
        bracket,
        canonical_field: bracket,
        state: bracket === "set" ? BRACKET_STATE.ABSENT : BRACKET_STATE.VALUE,
        semantic_confidence: bracket === "set" ? null : confidence,
        composer_disposition: bracket === "set"
          ? COMPOSER_DISPOSITION.NOT_APPLICABLE
          : COMPOSER_DISPOSITION.INCLUDED,
        rendered_text: bracket === "set" ? null : "x",
        publication_coverage: bracket === "set" ? [] : [{
          bracket,
          source_field: bracket,
          source_index: 0,
          canonical_value: "x",
          disposition: PUBLICATION_DISPOSITION.PUBLISHED
        }],
        partially_published: false,
        outside_contract_order: false
      }))
    },
    composerVersion: provenance.composer_version,
    marketplaceProfileVersion: "profile-v1"
  });
const measurementOriginalFields = Object.freeze({
  set: "", print_finish: "x", card_name: "x", product: "x"
});

// Confidence calibration is useful only if the server freezes the band that
// was actually shown. Missing or invented bands fail closed at write time.
{
  const { fields, composed } = run(base);
  const validView = buildCsmResolutionView({
    fields, composed,
    assetId: "confidence-contract-a",
    recognitionSessionId: "confidence-contract-s"
  });
  const missing = structuredClone(validView);
  delete missing.brackets.find((row) => row.state === BRACKET_STATE.VALUE)
    .semantic_confidence;
  assert.throws(() => buildReviewMeasurementSnapshot({
    view: missing,
    composerVersion: "v"
  }), /semantic_confidence_invalid/);

  const invented = structuredClone(validView);
  invented.brackets.find((row) => row.state === BRACKET_STATE.ABSENT)
    .semantic_confidence = "OBSERVED";
  assert.throws(() => buildReviewMeasurementSnapshot({
    view: invented,
    composerVersion: "v"
  }), /semantic_confidence_unexpected/);
}

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
  assert.equal(so.composer_disposition, COMPOSER_DISPOSITION.NORMALIZED,
    "a mixed bracket remains rendered while its atom receipt records profile suppression");
  assert.equal(so.partially_published, true);
  assert.ok(so.publication_coverage.some((atom) => (
    atom.source_field === "team" && atom.disposition === "SUPPRESSED_BY_PROFILE"
  )));
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

// Independent commercial search terms remain distinct from components/team in
// canonical state, while the marketplace bracket explains all three lanes in
// the same order the CNL renderer used.
{
  const fields = {
    ...base,
    components: ["RC"],
    search_optimization: ["Young Guns"],
    team: "Blackhawks"
  };
  const composed = {
    grammar: "standard",
    brackets: ["search_optimization"],
    bracket_text: [{
      bracket: "search_optimization",
      text: "RC Young Guns Blackhawks"
    }],
    title: "RC Young Guns Blackhawks",
    character_budget: 80,
    length: 24,
    publication_coverage: coverage([
      { bracket: "search_optimization", source_field: "components",
        canonical_value: "RC", disposition: PUBLICATION_DISPOSITION.PUBLISHED },
      { bracket: "search_optimization", source_field: "search_optimization",
        canonical_value: "Young Guns", disposition: PUBLICATION_DISPOSITION.PUBLISHED },
      { bracket: "search_optimization", source_field: "team",
        canonical_value: "Blackhawks", disposition: PUBLICATION_DISPOSITION.PUBLISHED }
    ])
  };
  const view = buildCsmResolutionView({ fields, composed });
  const row = view.brackets.find((bracket) => bracket.bracket === "search_optimization");
  assert.deepEqual(row.canonical_fields, ["components", "search_optimization", "team"]);
  assert.equal(row.value, "RC, Young Guns, Blackhawks");
  assert.equal(row.selected_candidate, "RC, Young Guns, Blackhawks");
  assert.equal(row.rendered_text, "RC Young Guns Blackhawks");
  assert.equal(row.composer_disposition, COMPOSER_DISPOSITION.INCLUDED);
  assert.equal(row.partially_published, false,
    "punctuation normalization with every source atom present is not partial");

  const allComponents = buildCsmResolutionView({
    fields: { ...fields, components: ["RC", "Auto"], search_optimization: [], team: "" },
    composed: { ...composed, bracket_text: [{
      bracket: "search_optimization", text: "RC Auto"
    }], title: "RC Auto", length: 7, publication_coverage: coverage([
      { bracket: "search_optimization", source_field: "components", source_index: 0,
        canonical_value: "RC", disposition: PUBLICATION_DISPOSITION.PUBLISHED },
      { bracket: "search_optimization", source_field: "components", source_index: 1,
        canonical_value: "Auto", disposition: PUBLICATION_DISPOSITION.PUBLISHED }
    ]) }
  }).brackets.find((bracket) => bracket.bracket === "search_optimization");
  assert.equal(allComponents.partially_published, false,
    "an array lane is complete when every atomic component is rendered");

  const withheldTeam = buildCsmResolutionView({
    fields: { ...fields, components: ["RC"], search_optimization: [], team: "Blackhawks" },
    composed: { ...composed, bracket_text: [{
      bracket: "search_optimization", text: "RC"
    }], title: "RC", length: 2, publication_coverage: coverage([
      { bracket: "search_optimization", source_field: "components",
        canonical_value: "RC", disposition: PUBLICATION_DISPOSITION.PUBLISHED },
      { bracket: "search_optimization", source_field: "team",
        canonical_value: "Blackhawks", disposition: PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE }
    ]) }
  }).brackets.find((bracket) => bracket.bracket === "search_optimization");
  assert.equal(withheldTeam.partially_published, true,
    "a rendered component with an unpublished independent team lane is partial");

  const withheldSearchAtom = buildCsmResolutionView({
    fields: { ...fields, components: ["RC"], search_optimization: ["Young Guns", "Canvas"], team: "" },
    composed: { ...composed, bracket_text: [{
      bracket: "search_optimization", text: "RC Young Guns"
    }], title: "RC Young Guns", length: 13, publication_coverage: coverage([
      { bracket: "search_optimization", source_field: "components",
        canonical_value: "RC", disposition: PUBLICATION_DISPOSITION.PUBLISHED },
      { bracket: "search_optimization", source_field: "search_optimization", source_index: 0,
        canonical_value: "Young Guns", disposition: PUBLICATION_DISPOSITION.PUBLISHED },
      { bracket: "search_optimization", source_field: "search_optimization", source_index: 1,
        canonical_value: "Canvas", disposition: PUBLICATION_DISPOSITION.DROPPED_FOR_BUDGET }
    ]) }
  }).brackets.find((bracket) => bracket.bracket === "search_optimization");
  assert.equal(withheldSearchAtom.partially_published, true,
    "one missing atomic search term makes the multi-lane projection partial");
}

// Composite identity and subject arrays are normalized presentations, never
// partial source publication merely because commas are absent.
{
  const lot = run({
    ...base, grammar: "lot", lot_count: "2", manufacturer: "Topps",
    product: "Chrome", set: "Update", subjects: ["A", "B"], attributes: []
  });
  const view = buildCsmResolutionView(lot);
  assert.equal(view.brackets.find((row) => row.bracket === "manufacturer_product_set")
    .partially_published, false);
  assert.equal(view.brackets.find((row) => row.bracket === "subject")
    .partially_published, false);
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
    measurementSnapshot: buildReviewMeasurementSnapshot({
      view: buildCsmResolutionView({ fields, composed, assetId: "a1", recognitionSessionId: "s1" }),
      composerVersion: "v1"
    }),
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
    originalFields: fields, originalTitle: composed.title,
    measurementSnapshot: buildReviewMeasurementSnapshot({
      view: buildCsmResolutionView({ fields, composed, assetId: "a1", recognitionSessionId: "s1" }),
      composerVersion: "v1"
    })
  }), /needs_recomposer/, "corrections cannot be applied without deterministic recomposition");

  assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{
      bracket: "subject", canonical_field: "grammar",
      reason: CORRECTION_REASON.WRONG_VALUE,
      original_value: fields.grammar, corrected_value: "tcg"
    }],
    originalFields: fields, originalTitle: composed.title,
    measurementSnapshot: buildReviewMeasurementSnapshot({
      view: buildCsmResolutionView({ fields, composed, assetId: "a1", recognitionSessionId: "s1" }),
      composerVersion: "v1"
    }),
    recomposeTitle: () => composed.title
  }), /field_outside_bracket:subject:grammar/,
  "a Subject correction cannot write Grammar");

  for (const [correction, expected] of [
    [{ bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.WRONG_VALUE,
      original_value: "not-the-stored-set", corrected_value: "Update" }, /original_value_mismatch:set/],
    [{ bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.WRONG_VALUE,
      original_value: fields.set, corrected_value: ["Update"] }, /value_type_invalid:set/]
  ]) assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED, corrections: [correction],
    originalFields: fields, originalTitle: composed.title,
    measurementSnapshot: buildReviewMeasurementSnapshot({
      view: buildCsmResolutionView({ fields, composed, assetId: "a1", recognitionSessionId: "s1" }),
      composerVersion: "v1"
    }), recomposeTitle: () => composed.title
  }), expected);
}

// A composed bracket is one accuracy denominator but may legitimately carry
// corrections for more than one canonical lane. Uniqueness is therefore the
// (bracket, canonical_field) pair, not the display bracket alone.
{
  const provenance = {
    asset_id: "compound-a", recognition_session_id: "compound-s",
    resolution_id: "compound-r", output_id: "compound-o",
    resolver_version: "v", composer_version: "v", view_version: "v",
    reviewer_id: "manager-1", tenant_id: "tenant-1"
  };
  const measurementSnapshot = buildReviewMeasurementSnapshot({
    composerVersion: "v",
    view: {
      schema_version: "v", asset_id: provenance.asset_id,
      recognition_session_id: provenance.recognition_session_id,
      grammar: { raw: "standard" },
      composer: { title: "A", character_budget: 80, length: 1, truncated: false },
      brackets: [{
        bracket: "search_optimization",
        canonical_fields: ["components", "search_optimization", "team"],
        state: BRACKET_STATE.ABSENT,
        semantic_confidence: null,
        composer_disposition: COMPOSER_DISPOSITION.NOT_APPLICABLE,
        rendered_text: null
      }]
    }
  });
  const originalFields = { components: [], search_optimization: [], team: "" };
  const corrections = [{
    bracket: "search_optimization", canonical_field: "components",
    reason: CORRECTION_REASON.MISSED_VALUE, original_value: [], corrected_value: ["RC"]
  }, {
    bracket: "search_optimization", canonical_field: "team",
    reason: CORRECTION_REASON.MISSED_VALUE, original_value: "", corrected_value: "Dodgers"
  }];
  const review = buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED, corrections,
    originalFields, originalTitle: "A", recomposeTitle: () => "A RC Dodgers",
    measurementSnapshot
  });
  assert.deepEqual(review.corrected_fields.components, ["RC"]);
  assert.equal(review.corrected_fields.team, "Dodgers");

  assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [corrections[0], { ...corrections[0], corrected_value: ["Auto"] }],
    originalFields, originalTitle: "A", recomposeTitle: () => "A",
    measurementSnapshot
  }), /duplicate_bracket_field_correction:search_optimization:components/,
  "the same canonical lane cannot be corrected twice in one review");

  const [cell] = projectReviewAccuracy([review], { cohortId: "compound-bracket-v1" }).cells;
  assert.equal(cell.reviewed, 1);
  assert.equal(cell.corrections, 1, "two field edits remain one corrected bracket");
  assert.equal(cell.correction_rate, 1);
  assert.equal(cell.empty_errors, 1, "the EMPTY bracket error is counted once");
  assert.equal(cell.empty_error_rate, 1);
  assert.equal(cell.by_reason.MISSED_VALUE, 1, "one bracket cannot double its reason metric");
  assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "search_optimization", canonical_field: "team",
      reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "" }],
    originalFields, originalTitle: "A", recomposeTitle: () => "A",
    measurementSnapshot
  }), /correction_noop:team/);
  assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "search_optimization", canonical_field: "team",
      reason: CORRECTION_REASON.MISSED_VALUE, corrected_value: "Dodgers" }],
    originalFields: { ...originalFields, team: "Lakers" },
    originalTitle: "A", recomposeTitle: () => "A",
    measurementSnapshot
  }), /missed_value_semantics_invalid:team/);
  assert.throws(() => buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "search_optimization", canonical_field: "team",
      reason: CORRECTION_REASON.INVENTED_VALUE, corrected_value: "Dodgers" }],
    originalFields: { ...originalFields, team: "Lakers" },
    originalTitle: "A", recomposeTitle: () => "A",
    measurementSnapshot
  }), /invented_value_semantics_invalid:team/);
}

// --- REVIEW: provenance and verdict integrity --------------------------------
{
  const full = {
    asset_id: "a1", recognition_session_id: "s1", resolution_id: "r1", output_id: "o1",
    resolver_version: "v", composer_version: "v", view_version: "v", reviewer_id: "u", tenant_id: "t"
  };
  assert.throws(() => buildCsmResolutionReview({
    provenance: { ...full, resolution_id: "" }, verdict: REVIEW_VERDICT.APPROVED,
    measurementSnapshot: measurementFor(full)
  }), /missing_provenance:resolution_id/, "a review nobody can trace to a run is worse than none");
  assert.throws(() => buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.CORRECTED, corrections: [],
    measurementSnapshot: measurementFor(full)
  }), /corrected_without_corrections/);
  assert.throws(() => buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.APPROVED,
    corrections: [{ bracket: "set", reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "x" }],
    measurementSnapshot: measurementFor(full)
  }), /approved_with_corrections/);
  // An omitted value must not pass as a deliberate blank.
  assert.throws(() => buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "set", reason: CORRECTION_REASON.INVENTED_VALUE }],
    measurementSnapshot: measurementFor(full)
  }), /needs_value/);
  // UNDECIDED is excluded from metrics rather than counted as agreement.
  const undecided = buildCsmResolutionReview({
    provenance: full, verdict: REVIEW_VERDICT.UNDECIDED,
    measurementSnapshot: measurementFor(full)
  });
  assert.equal(undecided.excluded_from_metrics, true);
}

// --- PROJECTION: correction rate by grammar and bracket ----------------------
{
  const full = {
    asset_id: "a", recognition_session_id: "s", resolution_id: "r", output_id: "o",
    resolver_version: "v", composer_version: "v", view_version: "v", reviewer_id: "u", tenant_id: "t"
  };
  let sequence = 0;
  const mk = (verdict, corrections = [], confidence = "OBSERVED") => {
    const provenance = { ...full, asset_id: `a${++sequence}`, resolution_id: `r${sequence}` };
    return buildCsmResolutionReview({
      provenance, verdict, corrections, originalFields: measurementOriginalFields, originalTitle: "t",
      recomposeTitle: () => "t2", measurementSnapshot: measurementFor(
        provenance, "standard", confidence
      )
    });
  };
  const projection = projectReviewAccuracy([
    mk(REVIEW_VERDICT.APPROVED),
    mk(REVIEW_VERDICT.CORRECTED, [{ bracket: "print_finish", reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "Gold Refractor" }], "LOW"),
    mk(REVIEW_VERDICT.CORRECTED, [{ bracket: "set", reason: CORRECTION_REASON.MISSED_VALUE, corrected_value: "Refractor" }]),
    mk(REVIEW_VERDICT.UNDECIDED)
  ], { cohortId: "cos42-unit-cohort" });
  assert.equal(projection.schema_version, "csm-review-accuracy-projection-v3");
  assert.equal(projection.measurement_basis, REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED);
  assert.match(projection.cohort_sha256, /^[0-9a-f]{64}$/);
  assert.equal(projection.distinct_reviewers, 1);
  assert.equal(projection.reviews_counted, 3, "UNDECIDED is not agreement");
  assert.equal(projection.reviews_excluded, 1);
  const printFinish = projection.cells.find((cell) => cell.bracket === "print_finish");
  assert.equal(printFinish.reviewed, 3, "every frozen bracket contributes its denominator");
  assert.equal(printFinish.corrections, 1);
  assert.equal(printFinish.by_reason.WRONG_VALUE, 1);
  assert.deepEqual(printFinish.confidence_calibration.LOW,
    { reviewed: 1, errors: 1, error_rate: 1 });
  assert.deepEqual(printFinish.confidence_calibration.OBSERVED,
    { reviewed: 2, errors: 0, error_rate: 0 });
  const set = projection.cells.find((cell) => cell.bracket === "set");
  assert.equal(set.empty_reviewed, 3);
  assert.equal(set.composer_eligible, 0);
}

// Every COS-42 denominator comes from the frozen Composer snapshot, not from
// whichever correction rows happened to exist.
{
  const provenance = {
    asset_id: "metric-a", recognition_session_id: "metric-s",
    resolution_id: "metric-r", output_id: "metric-o",
    resolver_version: "v", composer_version: "v", view_version: "v",
    reviewer_id: "owner-1", tenant_id: "tenant-1"
  };
  const measurementSnapshot = buildReviewMeasurementSnapshot({
    composerVersion: "v",
    marketplaceProfileVersion: "profile-v1",
    view: {
      schema_version: "v", asset_id: "metric-a", recognition_session_id: "metric-s",
      grammar: { raw: "lot" },
      composer: { title: "Lot*2 A B", character_budget: 80, length: 9, truncated: false },
      brackets: [
        { bracket: "set", canonical_field: "set", state: BRACKET_STATE.ABSENT,
          semantic_confidence: null,
          composer_disposition: COMPOSER_DISPOSITION.NOT_APPLICABLE, rendered_text: null },
        { bracket: "print_finish", canonical_field: "print_finish", state: BRACKET_STATE.VALUE,
          semantic_confidence: "LOW",
          composer_disposition: COMPOSER_DISPOSITION.DROPPED_FOR_BUDGET, rendered_text: null,
          publication_coverage: [{ bracket: "print_finish", source_field: "print_finish",
            source_index: 0, canonical_value: "Refractor",
            disposition: PUBLICATION_DISPOSITION.DROPPED_FOR_BUDGET }] },
        { bracket: "product", canonical_field: "product", state: BRACKET_STATE.VALUE,
          semantic_confidence: "OBSERVED",
          composer_disposition: COMPOSER_DISPOSITION.SUPPRESSED_BY_PROFILE, rendered_text: null,
          publication_coverage: [{ bracket: "product", source_field: "product",
            source_index: 0, canonical_value: "Prizm",
            disposition: PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE }] },
        { bracket: "search_optimization", canonical_field: "team", state: BRACKET_STATE.VALUE,
          semantic_confidence: "OBSERVED",
          composer_disposition: COMPOSER_DISPOSITION.NORMALIZED, rendered_text: "RC",
          partially_published: true, publication_coverage: [
            { bracket: "search_optimization", source_field: "components",
              source_index: 0, canonical_value: "RC",
              disposition: PUBLICATION_DISPOSITION.PUBLISHED },
            { bracket: "search_optimization", source_field: "team",
              source_index: 0, canonical_value: "Spurs",
              disposition: PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE }
          ] }
      ]
    }
  });
  const review = buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "set", reason: CORRECTION_REASON.MISSED_VALUE,
      corrected_value: "Update" }],
    originalFields: { set: "" }, originalTitle: "Lot*2 A B",
    recomposeTitle: () => "Lot*2 Update A B",
    measurementSnapshot
  });
  const titleDerived = { ...review, measurement_basis: REVIEW_MEASUREMENT_BASIS.TITLE_DERIVED };
  const projection = projectReviewAccuracy([review, titleDerived], {
    cohortId: "lot-structured-v1"
  });
  assert.equal(projection.title_derived_reviews_excluded, 1,
    "commercial title edits never enter the semantic accuracy denominator");
  const byBracket = Object.fromEntries(projection.cells.map((cell) => [cell.bracket, cell]));
  assert.equal(byBracket.set.empty_errors, 1);
  assert.equal(byBracket.set.empty_error_rate, 1);
  assert.equal(byBracket.set.absent_reviewed, 1);
  assert.equal(byBracket.set.absent_errors, 1);
  assert.equal(byBracket.set.absent_error_rate, 1);
  assert.equal(byBracket.set.insufficient_evidence_reviewed, 0);
  assert.equal(byBracket.set.insufficient_evidence_error_rate, null);
  assert.equal(byBracket.print_finish.composer_eligible, 1);
  assert.equal(byBracket.print_finish.composer_omissions, 1);
  assert.equal(byBracket.print_finish.composer_omission_rate, 1);
  assert.equal(byBracket.product.profile_suppressed, 1);
  assert.equal(byBracket.search_optimization.partial_publications, 1);
}

{
  const provenance = {
    asset_id: "insufficient-a", recognition_session_id: "insufficient-s",
    resolution_id: "insufficient-r", output_id: "insufficient-o",
    resolver_version: "v", composer_version: "v", view_version: "v",
    reviewer_id: "manager-1", tenant_id: "tenant-1"
  };
  const measurementSnapshot = buildReviewMeasurementSnapshot({
    composerVersion: "v",
    view: {
      schema_version: "v", asset_id: provenance.asset_id,
      recognition_session_id: provenance.recognition_session_id,
      grammar: { raw: "tcg" }, composer: { title: "A", character_budget: 80, length: 1 },
      brackets: [{
        bracket: "card_number", canonical_field: "card_number",
        state: BRACKET_STATE.INSUFFICIENT_EVIDENCE,
        semantic_confidence: null,
        composer_disposition: COMPOSER_DISPOSITION.NOT_APPLICABLE,
        rendered_text: null
      }]
    }
  });
  const review = buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.CORRECTED,
    corrections: [{ bracket: "card_number", reason: CORRECTION_REASON.MISSED_VALUE,
      corrected_value: "089/063" }],
    originalFields: { card_number: "" }, originalTitle: "A",
    recomposeTitle: () => "A 089/063",
    measurementSnapshot
  });
  const [cell] = projectReviewAccuracy([review], { cohortId: "insufficient-v1" }).cells;
  assert.equal(cell.insufficient_evidence_reviewed, 1);
  assert.equal(cell.insufficient_evidence_errors, 1);
  assert.equal(cell.insufficient_evidence_error_rate, 1);
  assert.equal(cell.absent_reviewed, 0);
  assert.equal(cell.absent_error_rate, null);
}

// Historical v1 snapshots remain replayable, but they cannot manufacture a
// confidence label that the operator never reviewed.
{
  const provenance = {
    asset_id: "legacy-confidence-a", recognition_session_id: "legacy-confidence-s",
    resolution_id: "legacy-confidence-r", output_id: "legacy-confidence-o",
    resolver_version: "v", composer_version: "v", view_version: "v",
    reviewer_id: "manager-1", tenant_id: "tenant-1"
  };
  const current = measurementFor(provenance);
  assert.equal(current.schema_version, CSM_REVIEW_MEASUREMENT_SNAPSHOT_VERSION);
  const legacy = {
    ...structuredClone(current),
    schema_version: CAPTURED_REVIEW_MEASUREMENT_SNAPSHOT_VERSION,
    brackets: current.brackets.map(({ semantic_confidence: _ignored, ...row }) => row)
  };
  const review = buildCsmResolutionReview({
    provenance, verdict: REVIEW_VERDICT.APPROVED,
    originalFields: measurementOriginalFields, originalTitle: "t",
    measurementSnapshot: legacy
  });
  const printFinish = projectReviewAccuracy([review], {
    cohortId: "legacy-confidence-v1"
  }).cells.find((cell) => cell.bracket === "print_finish");
  assert.deepEqual(printFinish.confidence_calibration.UNAVAILABLE,
    { reviewed: 1, errors: 0, error_rate: 0 });
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
  const pokemon = run({
    ...base, grammar: "tcg", manufacturer: "Pokemon", product: "Pokemon SWSH",
    set: "Lost Origin", language: "EN"
  });
  const pv = buildCsmResolutionView(pokemon);
  assert.equal(pv.grammar.value, "TCG");
  assert.equal(pv.grammar.ip_corroborated, true);
  assert.equal(pv.grammar.review_required, false, "a corroborated TCG claim is not a review case");

  const dedupedMaker = pv.brackets.find((row) => row.bracket === "manufacturer");
  if (dedupedMaker.state === BRACKET_STATE.VALUE && dedupedMaker.rendered_text == null) {
    assert.equal(dedupedMaker.composer_disposition, COMPOSER_DISPOSITION.DEDUPED_COVERED,
      "an IP-prefix duplicate is semantically covered, not a phantom restored omission");
  }

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
    corrections: [{ bracket, reason, corrected_value: reason === CORRECTION_REASON.MISSED_VALUE
      ? "x" : "corrected" }],
    originalFields: reason === CORRECTION_REASON.MISSED_VALUE
      ? { ...measurementOriginalFields, [bracket]: "" }
      : measurementOriginalFields,
    originalTitle: "t", recomposeTitle: () => "t2",
    measurementSnapshot: measurementFor(prov(asset))
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

  const commercialTitleEdit = {
    ...mk("commercial-only", "product", CORRECTION_REASON.WRONG_VALUE),
    measurement_basis: REVIEW_MEASUREMENT_BASIS.TITLE_DERIVED
  };
  assert.equal(routeReviewPatterns([commercialTitleEdit]).routable.length, 0);
  assert.equal(routeReviewPatterns([commercialTitleEdit]).observed_not_routable.length, 0,
    "title-derived commercial feedback never enters semantic learning patterns");

  // Excluded reviews carry no weight at all.
  const undecided = buildCsmResolutionReview({
    provenance: prov("u1"), verdict: REVIEW_VERDICT.UNDECIDED,
    measurementSnapshot: measurementFor(prov("u1"))
  });
  assert.equal(routeReviewPatterns([undecided]).routable.length, 0);
}

console.log("csm-resolution-view learning-flow assertions OK");

// Stage-v4 keeps its execution-bound authority receipts private. The owner
// read model exposes only the semantic facts needed to prove why Grammar was
// (or was not) changed; operation, image, and provider identity hashes never
// cross the public projection.
function grammarContextRows({
  recognitionSessionId,
  cardNumber = "TG22/TG30",
  grammar = "standard",
  sourceAuthorized = true,
  stageV4 = true
}) {
  const writer = stageV4
    ? CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4
    : CSM_WRITER_PROJECTION_CONTRACTS.future_v3;
  const raw = {
    year: "2022", ip: "", language: "", manufacturer: "",
    product: stageV4 ? "Sword & Shield—Brilliant Stars" : "Chrome",
    set: stageV4 ? "Trainer Gallery" : "Base",
    subjects: [stageV4 ? "Eternatus" : "Shohei Ohtani"], team: "",
    card_name: "", release_variant: "", surface_color: "",
    parallel_family: "", parallel_exact: "", descriptive_rarity: "",
    card_number: stageV4 ? cardNumber : "150", serial: "", attributes: [],
    grading_info: null, grammar, lot_count: "", unreadable: [],
    low_confidence: [], special_stamp: "", description: ""
  };
  const founderBetaWebReceipt = {
    schema_version: "founder-beta-web-receipt-v2",
    outcome: "NOT_USED",
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: "gpt-5.6-luna",
    reasoning_effort: "low",
    web_search_used: false,
    web_search_call_count: 0,
    queries: [],
    urls: [],
    field_evidence: [],
    semantic_state_sha256: createHash("sha256")
      .update(JSON.stringify(raw)).digest("hex")
  };
  let sourceReceipt = null;
  let claimReceipt = null;
  if (stageV4) {
    const identity = createHash("sha256")
      .update(`${recognitionSessionId}\u0000${cardNumber}\u0000${grammar}`)
      .digest("hex");
    sourceReceipt = buildTcgFieldSourceAuthorityReceipt({
      fieldSources: [
        { field: "set", source_ids: sourceAuthorized ? ["original_image_1"] : [] },
        { field: "card_number", source_ids: ["original_image_1"] }
      ],
      fields: raw,
      originalImageCount: 1,
      semanticStateSha256: founderBetaWebReceipt.semantic_state_sha256,
      founderBetaWebReceipt,
      sourceExecution: {
        operationPayloadSha256: identity,
        originalImageFingerprints: [`sha256:${identity}`],
        recognitionImageFingerprints: [`sha256:${identity}`],
        providerClientRequestId: `client-${recognitionSessionId}`,
        providerResponseId: `response-${recognitionSessionId}`,
        tenantId: "tenant-resolution-view-v4",
        recognitionSessionId
      }
    });
    claimReceipt = buildTcgGrammarContextClaimReceipt({
      fields: raw,
      fieldSourceAuthorityReceipt: sourceReceipt
    });
  }
  const parsed = parseCanonicalFields(raw, {
    semantics: stageV4
      ? CANONICAL_FIELDS_PARSER_SEMANTICS.WEB_V3_TCG_CONTEXT
      : writer.canonical_fields.parser_semantics,
    ...(stageV4 ? {
      tcgFieldSourceAuthorityReceipt: sourceReceipt,
      tcgGrammarContextClaimReceipt: claimReceipt
    } : {})
  });
  const finished = finishCanonicalFields(parsed.fields, { writerContract: writer });
  const composed = {
    grammar: finished.grammar,
    brackets: finished.brackets,
    bracket_text: finished.bracket_text,
    dropped: finished.dropped_brackets,
    suppressed: finished.suppressed_brackets,
    restored: finished.restored_brackets,
    truncated: finished.truncated,
    input_empty_fields: finished.input_empty_fields,
    normalization_reasons: finished.normalization_reasons,
    character_budget: finished.character_budget,
    length: finished.length,
    composer_version: finished.composer_version,
    marketplace_profile_version: finished.marketplace_profile_version,
    canonical_naming_trace: finished.canonical_naming_trace,
    canonical_naming_publishable: finished.canonical_naming_publishable,
    publication_coverage: finished.publication_coverage,
    lot_quantity_unresolved: finished.lot_quantity_unresolved,
    lot_single_card: finished.lot_single_card,
    lot_unshared_attributes: finished.lot_unshared_attributes,
    lot_publishable: finished.lot_publishable,
    lot_publication_failure_code: finished.lot_publication_failure_code
  };
  const rows = buildCsmStageRows({
    tenantId: "tenant-resolution-view-v4",
    recognitionSessionId,
    fields: parsed.fields,
    observedFields: parsed.observed_fields || parsed.fields,
    composed,
    founderBetaWebReceipt,
    setCardNameRelationReceipt: {
      schema_version: "set-card-name-relations-v1",
      set: { predicate: "CURRENT_CARD_MEMBER_OF_SET", value: raw.set },
      card_name: null
    },
    ...(stageV4 ? {
      tcgFieldSourceAuthorityReceipt: sourceReceipt,
      tcgGrammarContextClaimReceipt: claimReceipt,
      ...(claimReceipt.status === "APPLIED" ? {
        registryReleaseId: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id
      } : {}),
      contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
    } : {
      contractVersion: CSM_DURABLE_PROJECTION_CONTRACT_VERSION
    }),
    title: finished.title
  });
  return { rows, sourceReceipt, claimReceipt };
}

{
  const publicKeys = [
    "claim_id", "conflict_codes", "ip_action", "normalization_version",
    "normalized_card_number", "normalized_set", "policy_version", "raw_grammar",
    "reason_code", "registry_content_sha256", "registry_record_sha256",
    "registry_release_id", "resolved_grammar", "schema_version",
    "source_authority", "status", "web_authority_used"
  ].sort();
  const cases = [
    { status: "APPLIED", cardNumber: "TG22/TG30", grammar: "standard",
      resolvedGrammar: "tcg", sourceAuthorized: true,
      authorityUsed: "CURRENT_IMAGE", reasonCode: "EXACT_JOINT_SET_NUMBER_NAMESPACE" },
    { status: "ABSTAIN", cardNumber: "TG22/TG30", grammar: "standard",
      resolvedGrammar: "standard", sourceAuthorized: false,
      authorityUsed: "ABSTAIN", reasonCode: "CURRENT_IMAGE_AUTHORITY_MISSING" },
    { status: "NOT_REQUIRED", cardNumber: "TG22/TG30", grammar: "tcg",
      resolvedGrammar: "tcg", sourceAuthorized: true,
      authorityUsed: "CURRENT_IMAGE", reasonCode: "RAW_TCG_GRAMMAR_UNCHANGED" }
  ];
  const unverified = grammarContextRows({
    recognitionSessionId: "session-public-unverified"
  });
  assert.throws(
    () => publicDurableProjectionReceipts(unverified.rows),
    (error) => error.statusCode === 409
      && error.message === "csm_resolution_durable_projection_receipt_invalid",
    "row-only replay must not publish a session authority receipt"
  );
  for (const testCase of cases) {
    const fixture = grammarContextRows({
      recognitionSessionId: `session-public-${testCase.status.toLowerCase()}`,
      cardNumber: testCase.cardNumber,
      grammar: testCase.grammar,
      sourceAuthorized: testCase.sourceAuthorized
    });
    const projected = publicDurableProjectionReceipts(fixture.rows, {
      sourceExecutionVerified: true
    });
    const receipt = projected.tcg_grammar_context_authority_receipt;
    assert.deepEqual(Object.keys(receipt).sort(), publicKeys);
    assert.equal(receipt.schema_version,
      CSM_TCG_GRAMMAR_CONTEXT_AUTHORITY_PUBLIC_RECEIPT_VERSION);
    assert.equal(receipt.status, testCase.status);
    assert.equal(receipt.raw_grammar, testCase.grammar);
    assert.equal(receipt.resolved_grammar, testCase.resolvedGrammar);
    assert.equal(receipt.reason_code, testCase.reasonCode);
    assert.equal(receipt.normalized_set, "Trainer Gallery");
    assert.equal(receipt.normalized_card_number, testCase.cardNumber);
    assert.equal(receipt.ip_action, "UNCHANGED");
    assert.equal(receipt.web_authority_used, false);
    assert.deepEqual(Object.keys(receipt.source_authority).sort(), [
      "authority_used", "field_authority"
    ]);
    assert.equal(receipt.source_authority.authority_used, testCase.authorityUsed);
    assert.deepEqual(receipt.source_authority.field_authority.map((row) => row.field), [
      "card_number", "set"
    ]);
    for (const row of receipt.source_authority.field_authority) {
      assert.deepEqual(Object.keys(row).sort(), [
        "current_image_source_present", "field", "web_source_present"
      ]);
      assert.equal(row.current_image_source_present,
        row.field === "set" ? testCase.sourceAuthorized : true);
      assert.equal(row.web_source_present, false);
    }
    const serialized = JSON.stringify(receipt);
    for (const privateKey of [
      "operation_payload_sha256", "original_image_fingerprints_sha256",
      "recognition_image_fingerprints_sha256",
      "provider_client_request_id_sha256", "provider_response_id_sha256",
      "session_identity_sha256",
      "semantic_state_sha256", "normalized_field_sources_sha256",
      "founder_beta_web_receipt_sha256", "authorized_field_values_sha256",
      "receipt_sha256", "field_source_authority_receipt_sha256"
    ]) {
      assert.equal(serialized.includes(`\"${privateKey}\"`), false,
        `${privateKey} must stay private`);
    }
  }

  const historical = publicDurableProjectionReceipts(grammarContextRows({
    recognitionSessionId: "session-public-historical-v3",
    stageV4: false
  }).rows);
  assert.deepEqual(Object.keys(historical).sort(), [
    "founder_beta_web_receipt", "set_card_name_relation_receipt"
  ], "v1-v3 public keys remain byte-compatible");
  assert.equal(JSON.stringify(historical), JSON.stringify({
    founder_beta_web_receipt:
      historical.founder_beta_web_receipt,
    set_card_name_relation_receipt:
      historical.set_card_name_relation_receipt
  }), "v3 receipt property order remains byte-compatible");

  const target = grammarContextRows({
    recognitionSessionId: "session-public-private-target",
    cardNumber: "TG22/TG30"
  });
  const donor = grammarContextRows({
    recognitionSessionId: "session-public-private-donor",
    cardNumber: "TG21/TG30"
  });
  for (const mutate of [
    (rows) => { delete rows.output.structured_output.tcg_field_source_authority_receipt; },
    (rows) => { delete rows.output.structured_output.tcg_grammar_context_claim_receipt; },
    (rows) => {
      rows.output.structured_output.tcg_grammar_context_claim_receipt.receipt_sha256 =
        "0".repeat(64);
    },
    (rows) => {
      rows.output.structured_output.tcg_field_source_authority_receipt =
        donor.sourceReceipt;
      rows.output.structured_output.tcg_grammar_context_claim_receipt =
        donor.claimReceipt;
    }
  ]) {
    const invalid = structuredClone(target.rows);
    mutate(invalid);
    let partialProjection = null;
    assert.throws(() => {
      partialProjection = publicDurableProjectionReceipts(invalid, {
        sourceExecutionVerified: true
      });
    }, (error) => error.statusCode === 409
      && error.message === "csm_resolution_durable_projection_receipt_invalid");
    assert.equal(partialProjection, null,
      "invalid private authority must not return a partial public view");
  }
}

console.log("csm-resolution-view v4 public Grammar authority assertions OK");
