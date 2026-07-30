import assert from "node:assert/strict";
import { createEvidenceField, createVisionSource } from "../lib/listing/evidence/evidence-schema.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import {
  exactAnchorQueryFieldsFromScout,
  maybeFinalizeL1FromExactAnchor,
  scoutHasFinalizeAnchors
} from "../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
};

function directEvidence(value, side = "front") {
  const observedText = Array.isArray(value) ? value.join(" / ") : String(value);
  const source = createVisionSource({
    sourceType: side === "back" ? "CARD_BACK" : "CARD_FRONT",
    imageId: `image_${side}`,
    side,
    observedText,
    rawText: observedText,
    trustTier: 1
  });
  return createEvidenceField({
    value,
    normalizedValue: value,
    status: "CONFIRMED",
    confidence: 0.97,
    candidates: [{ value, confidence: 0.97, sources: [source] }],
    sources: [source],
    conflicts: []
  });
}

const exactAnchorCurrentImageContext = Object.freeze({
  tenant_id: "tenant_exact_anchor_test",
  asset_id: "asset-exact-anchor-test",
  image_generation_id: "asset-exact-anchor-test",
  images: ["front", "back"].map((side, index) => Object.freeze({
    image_id: side,
    object_path: `tenants/tenant_exact_anchor_test/listing-assets/2026-07-30/asset-exact-anchor-test/${side}.jpg`,
    content_sha256: String(index + 1).repeat(64),
    tenant_id: "tenant_exact_anchor_test",
    asset_id: "asset-exact-anchor-test",
    image_generation_id: "asset-exact-anchor-test",
    storage_verified: true
  }))
});

const scoutResult = {
  current_image_context: exactAnchorCurrentImageContext,
  resolved_fields: {
    players: ["Jesus Made"],
    year: "2025",
    manufacturer: "Topps",
    product_family: "Bowman Chrome",
    collector_number: "BS-4",
    print_run_denominator: "5",
    serial_number: "3/5",
    surface_color: "Red"
  },
  evidence: {
    year: directEvidence("2025", "back"),
    manufacturer: directEvidence("Topps", "back"),
    product: directEvidence("Bowman Chrome", "back"),
    players: directEvidence(["Jesus Made"]),
    collector_number: directEvidence("BS-4", "back"),
    serial_number: directEvidence("3/5"),
    surface_color: directEvidence("Red")
  }
};

const forbiddenCandidateInstanceFields = new Set([
  "serial_number",
  "numerical_rarity",
  "grade_company",
  "card_grade",
  "auto_grade",
  "cert_number",
  "condition"
]);

function resolverDecisionFor(finalize) {
  assert.equal(finalize.finalized, true);
  assert.equal(finalize.finalized_semantics, "RESOLVER_READY");
  assert.equal(finalize.resolver_ready, true);
  assert.equal(finalize.title, undefined);
  assert.equal(finalize.presentation, undefined);
  assert.equal(finalize.resolved_fields, undefined);
  assert.ok(finalize.resolver_input);
  const application = finalize.resolver_input.retrieval_application;
  assert.equal(application?.owner, "retrieval_application_layer");
  assert.equal(application?.owns_candidate_application, true);
  assert.equal(
    application?.selected_candidate_id,
    finalize.candidate?.candidate_id,
    "canonical Candidate Selection must select the same exact-anchor winner"
  );
  const items = application.identity_evidence_items;
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.metadata?.candidate_is_evidence_not_truth === true));
  assert.ok(items.every((item) => ["APPLY", "SUPPORT"].includes(item.metadata?.retrieval_application_decision)));
  assert.ok(items.every((item) => item.metadata?.field_permission));
  assert.ok(items.every((item) => !forbiddenCandidateInstanceFields.has(item.field)));
  assert.ok(finalize.resolver_input.resolution_trace.some((entry) => (
    entry.output?.candidate_application_owner === "retrieval_application_layer"
    && entry.output?.exact_anchor_policy_version
  )));

  const decision = applyIdentityResolutionGate(finalize.resolver_input, {
    maxLength: 80,
    providerId: "v4_exact_anchor"
  });
  assert.ok(["CONFIRMED", "RESOLVED", "ABSTAIN"].includes(decision.identity_resolution_status));
  assert.ok(decision.final_title.length <= 80);
  if (decision.identity_resolution_status === "ABSTAIN") {
    assert.equal(decision.publication_gate.auto_publish_allowed, false);
  } else {
    assert.ok(decision.final_title.length > 0);
  }
  return decision;
}

function applicationValue(finalize, field) {
  return finalize.resolver_input.retrieval_application.identity_evidence_items
    .find((item) => item.field === field)?.value;
}

function catalogRow(overrides = {}) {
  return {
    identity_id: "11111111-1111-1111-1111-111111111111",
    canonical_title: "2025 Bowman Chrome Jesus Made Spotlights BS-4",
    retrieval_status: "reviewed",
    source_type: "STRUCTURED_DATABASE",
    supporting_fields: ["subject", "year", "product", "collector_number"],
    raw_score: 0.8,
    normalized_score: 0.8,
    fields: {
      year: "2025",
      manufacturer: "Topps",
      brand: "Bowman",
      product: "Bowman Chrome",
      set: "Spotlights",
      players: ["Jesus Made"],
      collector_number: "BS-4"
    },
    ...overrides
  };
}

function fetchReturning(rows) {
  return async () => ({ ok: true, json: async () => rows });
}

// Query-field mapping and anchor precondition.
const queryFields = exactAnchorQueryFieldsFromScout(scoutResult.resolved_fields);
assert.deepEqual(queryFields.subjects, ["Jesus Made"]);
assert.equal(queryFields.collector_number, "BS-4");
assert.equal(queryFields.expected_serial_denominator, "5");
assert.equal(scoutHasFinalizeAnchors(queryFields), true);
assert.equal(scoutHasFinalizeAnchors(exactAnchorQueryFieldsFromScout({ players: ["X"], year: "2024" })), false);
const sportsProductKey = exactAnchorQueryFieldsFromScout({
  year: "2024",
  product: "Topps Chrome",
  collector_number: "54"
});
assert.equal(scoutHasFinalizeAnchors(sportsProductKey), false, "legacy scout path still requires a subject");
assert.equal(
  scoutHasFinalizeAnchors(sportsProductKey, { allowSportsProductKey: true }),
  true,
  "formal anchor router may use year + product + printed card number"
);

// Unique strict-tier hit -> finalized, catalog identity merged, instance
// fields (serial from the current image) preserved and never overwritten.
const finalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([catalogRow()])
});
assert.equal(finalized.finalized, true);
assert.equal(finalized.reason, "exact_anchor_catalog_resolver_ready");
const finalizedDecision = resolverDecisionFor(finalized);
assert.match(finalizedDecision.final_title, /Bowman Chrome/i);
assert.match(finalizedDecision.final_title, /Jesus Made/i);
assert.equal(finalizedDecision.resolved.set, "Spotlights");
assert.equal(finalizedDecision.resolved.serial_number, "3/5");
assert.equal(finalized.candidate.candidate_identity_id, "11111111-1111-1111-1111-111111111111");
assert.equal(finalized.catalog_lookup_attempted, true);
assert.equal(finalized.catalog_candidate_count, 1);
assert.equal(finalized.trusted_candidate_count, 1);
assert.equal(finalized.eligible_candidate_count, 1);

const selfExcluded = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  excludeSourceFeedbackIds: ["feedback-current-card"],
  env,
  fetchImpl: fetchReturning([
    catalogRow({ source_feedback_id: "feedback-current-card" }),
    catalogRow({
      identity_id: "44444444-4444-4444-4444-444444444444",
      source_feedback_id: "feedback-other-card"
    })
  ])
});
assert.equal(selfExcluded.finalized, true);
assert.equal(
  selfExcluded.candidate.candidate_identity_id,
  "44444444-4444-4444-4444-444444444444",
  "exact-anchor finalize must exclude the current feedback row but retain other references"
);

let secretKeyAuthorization = "";
const secretKeyFinalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SECRET_KEY: "test-secret-key"
  },
  fetchImpl: async (_url, options = {}) => {
    secretKeyAuthorization = options.headers?.authorization || "";
    return { ok: true, json: async () => [catalogRow()] };
  }
});
assert.equal(secretKeyFinalized.finalized, true, "modern Supabase secret keys should support the exact-anchor path");
resolverDecisionFor(secretKeyFinalized);
assert.equal(secretKeyAuthorization, "Bearer test-secret-key");

// Candidate/review-required rows can support shadow analysis but can never
// finalize a writer-visible title.
const untrusted = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([catalogRow({ retrieval_status: "candidate" })])
});
assert.equal(untrusted.finalized, false);
assert.equal(untrusted.reason, "no_exact_anchor_agreement");
assert.equal(untrusted.catalog_candidate_count, 1);
assert.equal(untrusted.trusted_candidate_count, 0);
assert.equal(untrusted.eligible_candidate_count, 0);

// A bare TCG code may retrieve one official/reviewed row, but the shared
// Candidate Selection owner currently requires independent identity context.
// The exact route must fall through instead of manufacturing that context.
const tcgFinalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult: { resolved_fields: { tcg_card_number: "OP01-120" } },
  env,
  fetchImpl: fetchReturning([catalogRow({
    canonical_title: "2022 One Piece Romance Dawn Shanks OP01-120 SEC",
    retrieval_status: "registry",
    source_type: "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
    fields: {
      year: "2022",
      ip: "One Piece",
      product: "Romance Dawn",
      players: ["Shanks"],
      collector_number: "OP01-120",
      rarity: "SEC"
    }
  })]),
  policy: { allow_tcg_code_only: true, allow_catalog_finalize: true, allow_cert_lane: false }
});
assert.equal(tcgFinalized.finalized, false, JSON.stringify(tcgFinalized));
assert.equal(tcgFinalized.reason, "exact_anchor_candidate_not_selected_by_candidate_control");
assert.equal(tcgFinalized.resolver_ready, false);
assert.equal(tcgFinalized.resolver_input, undefined);

// Sports checklist natural key: year + product hierarchy + printed card
// number can identify a unique approved row before the subject OCR settles.
const sportsProductFinalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult: {
    current_image_context: exactAnchorCurrentImageContext,
    resolved_fields: {
      year: "2024",
      product: "Panini Contenders",
      collector_number: "54"
    }
  },
  env,
  fetchImpl: fetchReturning([catalogRow({
    canonical_title: "2024 Panini Contenders Jaren Jackson Rookie Ticket Auto #54",
    fields: {
      year: "2024",
      manufacturer: "Panini",
      product: "Panini Contenders",
      players: ["Jaren Jackson"],
      card_name: "Rookie Ticket Autograph",
      collector_number: "54"
    }
  })]),
  policy: {
    allow_sports_product_key: true,
    allow_catalog_finalize: true,
    allow_cert_lane: false
  }
});
assert.equal(sportsProductFinalized.finalized, true, JSON.stringify(sportsProductFinalized));
resolverDecisionFor(sportsProductFinalized);
assert.equal(applicationValue(sportsProductFinalized, "players")[0], "Jaren Jackson");
assert.equal(sportsProductFinalized.catalog_lookup_attempted, true);

// Two strict-tier candidates -> ambiguous, no finalize.
const ambiguous = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([
    catalogRow(),
    catalogRow({ identity_id: "22222222-2222-2222-2222-222222222222", canonical_title: "2025 Bowman Chrome Jesus Made Alt BS-4" })
  ])
});
assert.equal(ambiguous.finalized, false);
assert.equal(ambiguous.reason, "ambiguous_exact_anchor_candidates");
assert.equal(ambiguous.catalog_candidate_count, 2);
assert.equal(ambiguous.eligible_candidate_count, 2);

// Code mismatch -> hard conflict -> no finalize.
const mismatch = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([catalogRow({ fields: { ...catalogRow().fields, collector_number: "BCP-50" } })])
});
assert.equal(mismatch.finalized, false);

// Scout without a printed exact code never attempts the fast lane.
const noAnchor = await maybeFinalizeL1FromExactAnchor({
  scoutResult: { resolved_fields: { players: ["Jesus Made"], year: "2025", product_family: "Bowman Chrome" } },
  env,
  fetchImpl: fetchReturning([catalogRow()])
});
assert.equal(noAnchor.finalized, false);
assert.equal(noAnchor.reason, "scout_missing_exact_anchors");

// Kill switch.
const disabled = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env: { ...env, ENABLE_V4_EXACT_ANCHOR_FINALIZE: "false" },
  fetchImpl: fetchReturning([catalogRow()])
});
assert.equal(disabled.finalized, false);
assert.equal(disabled.reason, "disabled_by_env");

console.log("v4 exact anchor finalize tests passed");
