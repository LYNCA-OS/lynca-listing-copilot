#!/usr/bin/env node
// COS-42 endpoint behaviour. No network: the persistence boundary is injected.
import assert from "node:assert/strict";
import {
  composeResolutionView, handleResolutionViewRequest, handleResolutionReviewRequest
} from "../api/csm-resolution-view.js";
import { REVIEW_VERDICT, CORRECTION_REASON } from "../lib/listing/csm/resolution-review.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  buildCsmStageRows,
  THIN_COMPOSER_VERSION_V1
} from "../lib/listing/thin/csm-persistence.mjs";

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

const legacyPayload = {
  year: "2018", manufacturer: "Topps", product: "Topps Silver Pack", set: "",
  subjects: ["Shohei Ohtani"], team: "", card_name: "1983 Chrome Promo",
  release_variant: "", surface_color: "Blue", parallel_family: "Refractor",
  parallel_exact: "Blue Refractor", descriptive_rarity: "", card_number: "",
  serial: "018/150", attributes: ["RC"], grading_info: {
    company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
  }, grammar: "standard", lot_count: "", language: "", unreadable: [], low_confidence: []
};
const legacyFields = parseCanonicalFields(legacyPayload).fields;
const legacyComposed = composeFromCanonicalFields(legacyFields, {
  features: { exact_parallel_color_compaction: false }
});
const legacyRows = buildCsmStageRows({
  tenantId: "t1", recognitionSessionId: "legacy-session",
  fields: legacyFields, composed: legacyComposed, title: legacyComposed.title
});
legacyRows.output.composer_version = THIN_COMPOSER_VERSION_V1;
legacyRows.output.title = legacyComposed.title;
const legacyRecord = {
  asset_id: "legacy-asset", recognition_session_id: "legacy-session",
  resolution_id: legacyRows.resolution.id, output_id: legacyRows.output.id,
  output_title: legacyComposed.title, composer_version: THIN_COMPOSER_VERSION_V1,
  resolver_version: "thin-path-observation-only-v1", replay_rows: legacyRows
};

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

// --- stored Composer versions remain executable, including in review --------
{
  const replayed = composeResolutionView(legacyRecord);
  assert.equal(replayed.composer_version, THIN_COMPOSER_VERSION_V1);
  assert.equal(replayed.composed.title, legacyComposed.title);
  assert.doesNotMatch(replayed.composed.title, /\bBlue\b/,
    "the Glass Box must not reinterpret a historical v1 title with v2 compaction");
  assert.doesNotMatch(replayed.compose_corrected_title({ ...legacyFields, team: "Dodgers" }), /\bBlue\b/,
    "review recomposition must execute the stored v1 contract as well");

  const view = await handleResolutionViewRequest({
    tenantId: "t1", assetId: legacyRecord.asset_id,
    dependencies: { readRecord: async () => legacyRecord }
  });
  assert.equal(view.composer.composer_version, THIN_COMPOSER_VERSION_V1);
  assert.equal(view.composer.recomposed_matches_stored, true);
  assert.equal(view.composer.trace_reliable, true);

  const review = await handleResolutionReviewRequest({
    tenantId: "t1", reviewerId: "u1",
    payload: {
      asset_id: legacyRecord.asset_id,
      verdict: REVIEW_VERDICT.CORRECTED,
      corrections: [{
        bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.MISSED_VALUE,
        original_value: "", corrected_value: "Sapphire Selections"
      }]
    },
    dependencies: { readRecord: async () => legacyRecord, appendReview: async ({ review: value }) => value }
  });
  assert.equal(review.composer_version, THIN_COMPOSER_VERSION_V1);
  assert.equal(review.original_title, legacyComposed.title);
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

// COS-42 (founder, 2026-08-04): "Field-level semantic approval/correction is a
// separate trusted reviewer/admin workflow; it is not the default writer
// workflow." A writer's title edit is cleaned commercial feedback, and the
// route from editing a title to rewriting canonical fields must not exist.
{
  const { TENANT_PERMISSIONS, permissionScopeFor } = await import("../lib/tenant/permissions.mjs");
  const REVIEW = TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS;
  assert.ok(REVIEW, "the review workflow needs its own permission, not a borrowed one");
  assert.equal(permissionScopeFor("WRITER", REVIEW), "NONE",
    "a writer must not be able to approve or correct canonical fields");
  assert.notEqual(permissionScopeFor("OWNER", REVIEW), "NONE");
  assert.notEqual(permissionScopeFor("MANAGER", REVIEW), "NONE");
  // The separation is the point: writers keep the title edit they had.
  assert.notEqual(permissionScopeFor("WRITER", TENANT_PERMISSIONS.EDIT_TITLE), "NONE",
    "writers still edit titles; that is commercial feedback, not semantic truth");

  // And the endpoint must ask for the reviewer permission, not the writer one.
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../api/csm-resolution-view.js", import.meta.url), "utf8");
  assert.match(source, /TENANT_PERMISSIONS\.REVIEW_SEMANTIC_FIELDS/,
    "the POST path gates on the reviewer permission");
  // The USAGE, not any mention: the comment above that line names the two
  // non-existent constants it replaced, and a whole-file regex would fail on
  // the explanation rather than on the code.
  assert.ok(!/TENANT_PERMISSIONS\.(WRITE|READ)_LISTING/.test(source),
    "those constants never existed and read as undefined at the permission check");
}

console.log("csm-resolution-api reviewer-workflow assertions OK");
