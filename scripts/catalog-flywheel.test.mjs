import assert from "node:assert/strict";
import {
  applyWriterConfirmationToFlywheel,
  buildCatalogFlywheelGapRow,
  catalogColdStartStatuses,
  catalogFlywheelTrustMetrics,
  writerConfirmationActions
} from "../lib/listing/cold-start/catalog-flywheel.mjs";
import {
  sourceTrustValues
} from "../lib/listing/external/external-candidate-contract.mjs";

const now = new Date("2026-07-01T12:00:00.000Z");

{
  const gapRow = buildCatalogFlywheelGapRow({
    item: {
      asset_id: "asset-1",
      images: [{ image_id: "front-1" }, { image_id: "back-1" }]
    },
    result: {
      final_title: "1997-98 Bowman's Best Michael Jordan Best Performance",
      resolved_fields: {
        year: "1997-98",
        product: "Bowman's Best",
        players: ["Michael Jordan"],
        serial_number: "12/100"
      }
    },
    externalCandidates: [{
      external_card_id: "cs-card-96",
      title: "1997-98 Bowman's Best Michael Jordan Best Performance #96",
      match_level: "exact_card",
      fields: {
        year: "1997-98",
        product: "Bowman's Best",
        card_name: "Best Performance",
        players: ["Michael Jordan"],
        serial_number: "99/100",
        grade_company: "PSA",
        cert_number: "no-copy"
      }
    }],
    now
  });

  assert.equal(gapRow.cold_start_status, catalogColdStartStatuses.EXTERNAL_DIRECTORY_CANDIDATES_ONLY);
  assert.equal(gapRow.writer_action_required, true);
  assert.deepEqual(gapRow.image_ids, ["front-1", "back-1"]);
  assert.equal(gapRow.metadata.ebay_title_used_as_ground_truth, false);
  assert.equal(gapRow.metadata.ebay_title_sent_to_model, false);
  assert.equal(gapRow.metadata.external_candidates_used_as_truth, false);
  assert.equal(gapRow.external_candidates[0].used_as_truth, false);
  assert.equal(gapRow.external_candidates[0].fields.serial_number, undefined);
  assert.equal(gapRow.external_candidates[0].fields.grade_company, undefined);
  assert.equal(gapRow.external_candidates[0].fields.cert_number, undefined);

  const reviewed = applyWriterConfirmationToFlywheel({
    gapRow,
    action: writerConfirmationActions.SELECT_EXTERNAL_CANDIDATE,
    selectedCandidateId: "cs-card-96",
    rejectedCandidateIds: ["cs-wrong-1"],
    writerFinalTitle: "1997-98 Bowman's Best Michael Jordan Best Performance",
    writerConfirmedFields: {
      year: "1997-98",
      product: "Bowman's Best",
      card_name: "Best Performance",
      players: ["Michael Jordan"],
      collector_number: "96",
      serial_number: "12/100",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    },
    reviewTimeMs: 45000,
    actor: "writer-1",
    promotedCatalogIdentityId: "identity-96",
    now
  });

  assert.equal(reviewed.promoted, true);
  assert.equal(reviewed.gap_row.promotion_status, "promoted");
  assert.equal(reviewed.gap_row.training_eligible, false);
  assert.equal(reviewed.catalog_staging.source.source_type, "INTERNAL_VERIFIED_TITLE");
  assert.equal(reviewed.catalog_staging.staging.import_status, "REVIEWED_INTERNAL");
  assert.equal(reviewed.catalog_staging.staging.field_statuses.year, "REVIEWED_INTERNAL");
  assert.equal(reviewed.catalog_staging.staging.field_statuses.serial_number, "REVIEWED_INTERNAL");
  assert.equal(reviewed.catalog_staging.source.source_metadata.external_candidate_used_as_truth, false);
  assert.equal(reviewed.promotion_event.action, "promote_external_candidate_after_review");
  assert.equal(reviewed.hard_negatives.length, 1);
  assert.equal(reviewed.hard_negatives[0].training_eligible, false);
}

{
  const internal = buildCatalogFlywheelGapRow({
    item: { asset_id: "asset-2" },
    internalCandidates: [{
      candidate_id: "internal-1",
      source_trust: sourceTrustValues.REVIEWED_INTERNAL,
      fields: { product: "Topps Chrome" }
    }],
    now
  });
  assert.equal(internal.cold_start_status, catalogColdStartStatuses.EXACT_INTERNAL_MATCH);
  assert.equal(internal.writer_action_required, false);

  const official = buildCatalogFlywheelGapRow({
    item: { asset_id: "asset-3" },
    officialCandidates: [{
      candidate_id: "official-1",
      source_trust: sourceTrustValues.OFFICIAL_CHECKLIST,
      fields: { product: "Topps Chrome" }
    }],
    now
  });
  assert.equal(official.cold_start_status, catalogColdStartStatuses.OFFICIAL_CHECKLIST_MATCH);

  const marketplace = buildCatalogFlywheelGapRow({
    item: { asset_id: "asset-4" },
    marketplaceHints: [{
      candidate_id: "market-1",
      source_trust: sourceTrustValues.MARKETPLACE_RAW,
      title: "seller title only"
    }],
    now
  });
  assert.equal(marketplace.cold_start_status, catalogColdStartStatuses.MARKETPLACE_HINTS_ONLY);
}

{
  const metrics = catalogFlywheelTrustMetrics([{
    external_candidates: [{
      source_trust: sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
      used_as_truth: true,
      fields: { grade: "10" }
    }],
    marketplace_hints: [{
      source_trust: sourceTrustValues.MARKETPLACE_RAW,
      used_as_truth: true,
      fields: { product: "Prizm" }
    }]
  }]);
  assert.ok(metrics.forbidden_usage_violation_count >= 2);
  assert.ok(metrics.serial_grade_cert_copy_violation_count >= 1);
  assert.equal(metrics.marketplace_pollution_count, 1);
}

console.log("catalog flywheel tests passed");
