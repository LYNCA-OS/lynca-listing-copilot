import assert from "node:assert/strict";
import {
  applyColdStartSafeDraftPolicy,
  externalRetrievalTraceFromResult
} from "../lib/listing/cold-start/cold-start-policy.mjs";

const openSetReadiness = {
  status: "REFERENCE_CANDIDATES_ONLY",
  assist_enabled: true,
  known_catalog_candidate_available: false,
  prompt_safe_candidate_count: 0,
  raw_candidate_count: 3,
  approved_candidate_count: 0,
  conflict_blocked_count: 0
};

const providerOptions = { cold_start_blind: true };

{
  const result = applyColdStartSafeDraftPolicy({
    final_title: "2023 Topps Chrome Test Player Gold Refractor Base",
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      parallel: "Gold Refractor",
      card_type: "Base"
    },
    resolved: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      parallel: "Gold Refractor",
      card_type: "Base"
    }
  }, { providerOptions, openSetReadiness });
  assert.equal(result.cold_start_safe_draft.active, true);
  assert.equal(result.resolved.parallel, null);
  assert.equal(result.resolved.surface_color, "Gold");
  assert.equal(result.resolved.card_type, null);
  assert.match(JSON.stringify(result.high_risk_guess_removed), /exact_parallel_requires_catalog/);
  assert.match(JSON.stringify(result.high_risk_guess_removed), /base_must_not_be_defaulted/);
  assert.doesNotMatch(result.final_title, /Refractor/);
  assert.doesNotMatch(result.final_title, /\bBase\b/);
}

{
  const result = applyColdStartSafeDraftPolicy({
    final_title: "2023 Topps Chrome Test Player 17/50 PSA 10",
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      serial_number: "17/50",
      grade_company: "PSA",
      card_grade: "10"
    },
    resolved: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      serial_number: "17/50",
      grade_company: "PSA",
      card_grade: "10"
    }
  }, { providerOptions, openSetReadiness });
  assert.equal(result.resolved.serial_number, null);
  assert.equal(result.resolved.grade_company, null);
  assert.equal(result.resolved.card_grade, null);
  assert.deepEqual(result.cold_start_safe_draft.analysis.copied_reference_instance_fields, []);
  assert.match(JSON.stringify(result.high_risk_guess_removed), /serial_number_must_come_from_current_image/);
  assert.match(JSON.stringify(result.high_risk_guess_removed), /grade_must_come_from_current_slab_label/);
}

{
  const result = applyColdStartSafeDraftPolicy({
    final_title: "2023 Topps Chrome Test Player 17/50 PSA 10",
    fields: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      serial_number: "17/50",
      grade_company: "PSA",
      card_grade: "10"
    },
    resolved: {
      year: "2023",
      product: "Topps Chrome",
      players: ["Test Player"],
      serial_number: "17/50",
      grade_company: "PSA",
      card_grade: "10"
    },
    field_evidence: {
      serial_number: {
        source_type: "CARD_BACK_PRINTED_TEXT",
        direct_observation: true,
        visible_text: "17/50"
      },
      grade: {
        support_type: "SLAB_LABEL",
        direct_observation: true,
        visible_text: "PSA GEM MT 10"
      }
    }
  }, { providerOptions, openSetReadiness });
  assert.equal(result.resolved.serial_number, "17/50");
  assert.equal(result.resolved.grade_company, "PSA");
  assert.equal(result.resolved.card_grade, "10");
  assert.equal(result.cold_start_safe_draft.analysis.serial_current_image_only, true);
  assert.equal(result.cold_start_safe_draft.analysis.grade_current_image_only, true);
}

{
  const trace = externalRetrievalTraceFromResult({
    catalog_retrieval: {
      sources: [{
        provider_id: "ebay_browse",
        source_type: "MARKETPLACE",
        query: "test player topps chrome",
        source_url: "https://www.ebay.com/itm/123",
        title: "2023 Topps Chrome Test Player Gold Refractor PSA 10 17/50",
        snippet: "seller title",
        fields: {
          year: "2023",
          product: "Topps Chrome",
          players: ["Test Player"],
          serial_number: "17/50",
          grade_company: "PSA",
          card_grade: "10",
          cert_number: "12345678",
          surface_color: "Gold"
        },
        conflicting_fields: ["parallel"]
      }]
    }
  });
  assert.equal(trace.length, 1);
  assert.equal(trace[0].used_as_truth, false);
  assert.equal(trace[0].source_type, "MARKETPLACE");
  assert.equal(trace[0].parsed_weak_fields.year, "2023");
  assert.equal(trace[0].parsed_weak_fields.surface_color, "Gold");
  assert.equal(trace[0].parsed_weak_fields.serial_number, undefined);
  assert.equal(trace[0].parsed_weak_fields.grade_company, undefined);
  assert.equal(trace[0].parsed_weak_fields.card_grade, undefined);
  assert.equal(trace[0].parsed_weak_fields.cert_number, undefined);
  assert.deepEqual(trace[0].conflict_fields, ["parallel"]);
}

console.log("cold-start policy tests passed");
