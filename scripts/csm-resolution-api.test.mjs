#!/usr/bin/env node
// COS-42 endpoint behaviour. No network: the persistence boundary is injected.
import assert from "node:assert/strict";
import {
  composeResolutionView, handleResolutionViewRequest, handleResolutionReviewRequest
} from "../api/csm-resolution-view.js";
import { REVIEW_VERDICT, CORRECTION_REASON } from "../lib/listing/csm/resolution-review.mjs";

const payload = JSON.stringify({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
  descriptive_rarity: "", subjects: ["Shohei Ohtani"], team: "Dodgers", card_number: "150",
  serial: "17/50", attributes: ["RC"], grading_info: null, grammar: "standard",
  lot_count: "", language: "", unreadable: [], low_confidence: []
});
const record = {
  asset_id: "asset-1", recognition_session_id: "sess-1", resolution_id: "res-1",
  output_id: "out-1", canonical_payload: payload,
  output_title: composeResolutionView({ canonical_payload: payload }).composed.title,
  resolver_version: "thin-path-observation-only-v1"
};
const deps = { readRecord: async () => record, appendReview: async ({ review }) => review };

// --- the view is a pure read -------------------------------------------------
{
  const view = await handleResolutionViewRequest({ tenantId: "t1", assetId: "asset-1", dependencies: deps });
  assert.ok(view.brackets.length >= 13);
  assert.equal(view.composer.recomposed_matches_stored, true);
  assert.equal(view.composer.trace_reliable, true);
  assert.ok(view.composer.composer_version, "the version the trace was produced under travels with it");
}

// --- a stored title the current composer no longer reproduces is flagged ------
{
  const drifted = { ...record, output_title: "2025 Topps Chrome Something Else" };
  const view = await handleResolutionViewRequest({
    tenantId: "t1", assetId: "asset-1",
    dependencies: { ...deps, readRecord: async () => drifted }
  });
  assert.equal(view.composer.recomposed_matches_stored, false);
  assert.equal(view.composer.trace_reliable, false,
    "an operator must not be told a bracket was dropped for budget when the shipped title came from other code");
}

// --- a missing run is 404, not an empty view ---------------------------------
{
  await assert.rejects(
    () => handleResolutionViewRequest({ tenantId: "t1", assetId: "nope", dependencies: { readRecord: async () => null } }),
    (error) => error.statusCode === 404);
}

// --- review: the corrected title comes from corrected fields only -------------
{
  let appended = null;
  const review = await handleResolutionReviewRequest({
    tenantId: "t1", reviewerId: "u1",
    payload: {
      asset_id: "asset-1",
      verdict: REVIEW_VERDICT.CORRECTED,
      corrections: [{ bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.MISSED_VALUE, original_value: "", corrected_value: "Sapphire Selections" }],
      // A reviewer's own title, which must be ignored entirely.
      corrected_title: "WHATEVER THE REVIEWER TYPED"
    },
    dependencies: { ...deps, appendReview: async ({ review: r }) => { appended = r; return r; } }
  });
  assert.match(review.corrected_title, /Sapphire Selections/);
  assert.ok(!/WHATEVER/.test(review.corrected_title),
    "a title in the payload must never reach the record");
  assert.equal(review.original_title, record.output_title, "the shipped output is preserved");
  assert.ok(appended, "the review is persisted");
  assert.equal(appended.revision_sha256, review.revision_sha256);
  // Provenance is filled from the stored run, not from the client.
  assert.equal(review.resolution_id, "res-1");
  assert.equal(review.output_id, "out-1");
  assert.equal(review.reviewer_id, "u1");
}

// --- review: an approval cannot carry corrections ----------------------------
{
  await assert.rejects(() => handleResolutionReviewRequest({
    tenantId: "t1", reviewerId: "u1",
    payload: { asset_id: "asset-1", verdict: REVIEW_VERDICT.APPROVED, corrections: [{ bracket: "set", reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "x" }] },
    dependencies: deps
  }), /approved_with_corrections/);
}

console.log("csm-resolution-api.test.mjs OK");
