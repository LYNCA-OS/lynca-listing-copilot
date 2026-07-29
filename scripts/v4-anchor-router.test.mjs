import assert from "node:assert/strict";
import { createEvidenceField, createVisionSource } from "../lib/listing/evidence/evidence-schema.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { extractAnchorDossier, resolvedHintFromAnchorDossier } from "../lib/listing/v4/anchors/anchor-extractor.mjs";
import { anchorRoutes, planAnchorRoute } from "../lib/listing/v4/anchors/anchor-router.mjs";
import { probePreL2Anchors } from "../lib/listing/v4/anchors/pre-l2-anchor-probe.mjs";

function patch(field, value, confidence = 0.94, cropType = "card_code_crop", sourceType = "OCR") {
  return {
    field,
    value,
    raw_text: Array.isArray(value) ? value.join(" / ") : String(value),
    confidence,
    source_type: sourceType,
    source_image_id: "image_1",
    provenance: { crop_type: cropType }
  };
}

function canonicalDocument(patches = []) {
  const evidence = {};
  const resolved = {};
  for (const entry of patches) {
    const observedText = entry.raw_text || (Array.isArray(entry.value) ? entry.value.join(" / ") : String(entry.value));
    const source = createVisionSource({
      sourceType: entry.source_type,
      imageId: entry.source_image_id,
      region: entry.provenance?.crop_type,
      observedText,
      rawText: observedText,
      trustTier: entry.source_type === "STRUCTURED_DATABASE" ? 4 : 1
    });
    evidence[entry.field] = createEvidenceField({
      value: entry.value,
      normalizedValue: entry.value,
      status: entry.confidence >= 0.86 ? "CONFIRMED" : "REVIEW",
      confidence: entry.confidence,
      candidates: [{ value: entry.value, confidence: entry.confidence, sources: [source] }],
      sources: [source],
      conflicts: []
    });
    resolved[entry.field] = entry.value;
  }
  return {
    schema_version: "evidence-fields-v1",
    evidence,
    resolved,
    unresolved: []
  };
}

function resolverDecision(finalize) {
  assert.equal(finalize.finalized_semantics, "RESOLVER_READY");
  assert.equal(finalize.title, undefined);
  assert.equal(finalize.presentation, undefined);
  assert.ok(finalize.resolver_input);
  const decision = applyIdentityResolutionGate(finalize.resolver_input, {
    maxLength: 80,
    providerId: "v4_exact_anchor"
  });
  assert.ok(["CONFIRMED", "RESOLVED", "ABSTAIN"].includes(decision.identity_resolution_status));
  assert.ok(decision.final_title.length <= 80);
  if (decision.identity_resolution_status === "ABSTAIN") {
    assert.equal(decision.publication_gate.auto_publish_allowed, false);
  }
  return decision;
}

const tcgDossier = extractAnchorDossier(canonicalDocument([
  patch("tcg_card_number", "OP01-120")
]));
assert.equal(tcgDossier.anchors[0].anchor_type, "tcg_card_code");
assert.equal(tcgDossier.anchor_candidates.tcg_code[0].value, "OP01-120");
assert.equal(planAnchorRoute(tcgDossier).route, anchorRoutes.TCG_EXACT_LOOKUP);
assert.equal(resolvedHintFromAnchorDossier(tcgDossier).tcg_card_number, "OP01-120");

const sportsDossier = extractAnchorDossier(canonicalDocument([
    patch("checklist_code", "CL-LM"),
    patch("year", "2024", 0.93, "year_product_crop"),
    patch("product", "Topps Chrome", 0.91, "year_product_crop"),
    patch("players", ["Lionel Messi"], 0.92, "subject_crop")
]));
assert.equal(planAnchorRoute(sportsDossier).route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);

const insufficient = extractAnchorDossier(canonicalDocument([
  patch("checklist_code", "CL-LM")
]));
assert.equal(planAnchorRoute(insufficient).route, anchorRoutes.NORMAL_L2);

const certOnly = extractAnchorDossier(canonicalDocument([
    patch("grade_company", "PSA", 0.99, "grade_label_crop"),
    patch("cert_number", "87654321", 0.96, "grade_label_crop")
]));
assert.equal(planAnchorRoute(certOnly).route, anchorRoutes.CERT_VERIFY);
assert.equal(planAnchorRoute(certOnly).allow_identity_finalize, false);
assert.equal(certOnly.anchors.find((anchor) => anchor.anchor_type === "cert_number")?.grader, "PSA");

const payloadHintCannotFinalizeSports = extractAnchorDossier(canonicalDocument([
  patch("checklist_code", "CL-LM"),
  patch("year", "2024", 0.95, "year_product_crop", "STRUCTURED_DATABASE"),
  patch("product", "Topps Chrome", 0.95, "year_product_crop", "STRUCTURED_DATABASE"),
  patch("players", ["Lionel Messi"], 0.95, "subject_crop", "STRUCTURED_DATABASE")
]));
assert.equal(
  planAnchorRoute(payloadHintCannotFinalizeSports).route,
  anchorRoutes.NORMAL_L2,
  "a direct code plus non-direct payload hints must not bypass full visual recognition"
);

const bareBarcode = extractAnchorDossier(canonicalDocument([
  patch("unknown_number", "012345678905", 0.96, "unknown_crop")
]));
assert.equal(bareBarcode.anchors[0]?.anchor_type, "barcode_candidate");
assert.equal(bareBarcode.anchor_candidates.barcode[0].value, "012345678905");
assert.equal(planAnchorRoute(bareBarcode).route, anchorRoutes.NORMAL_L2);

const rarityOnly = extractAnchorDossier(canonicalDocument([
  patch("serial_number", "2/3", 0.98, "serial_crop")
]));
assert.equal(planAnchorRoute(rarityOnly).route, anchorRoutes.NORMAL_L2);

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-key"
};
const probe = await probePreL2Anchors({
  payload: {
    preingestion_evidence_patches: [patch("tcg_card_number", "OP01-120")]
  },
  env,
  fetchImpl: async () => ({
    ok: true,
    json: async () => [{
      identity_id: "tcg-identity-1",
      canonical_title: "2022 One Piece Romance Dawn Shanks OP01-120 SEC",
      retrieval_status: "registry",
      source_type: "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
      normalized_score: 1,
      supporting_fields: ["collector_number"],
      fields: {
        year: "2022",
        ip: "One Piece",
        product: "Romance Dawn",
        players: ["Shanks"],
        collector_number: "OP01-120",
        rarity: "SEC"
      }
    }]
  })
});
assert.equal(probe.finalized, false, JSON.stringify(probe));
assert.equal(probe.plan.route, anchorRoutes.TCG_EXACT_LOOKUP);
assert.equal(probe.finalize.reason, "exact_anchor_candidate_not_selected_by_candidate_control");
assert.equal(probe.finalize.resolver_ready, false);
assert.equal(probe.finalize.resolver_input, undefined);
assert.equal(probe.metrics.anchor_count, 1);
assert.equal(probe.metrics.direct_anchor_count, 1);
assert.deepEqual(probe.metrics.anchor_type_breakdown, { tcg_card_code: 1 });
assert.equal(probe.metrics.lookup_attempted, true);
assert.equal(probe.metrics.catalog_candidate_count, 1);
assert.equal(probe.metrics.trusted_candidate_count, 1);
assert.equal(probe.metrics.eligible_candidate_count, 1);

const sportsProbe = await probePreL2Anchors({
  payload: {
    preingestion_evidence_patches: [
      patch("collector_number", "54"),
      patch("year", "2024", 0.96, "year_product_crop"),
      patch("product", "Panini Contenders", 0.95, "year_product_crop")
    ]
  },
  env,
  fetchImpl: async () => ({
    ok: true,
    json: async () => [{
      identity_id: "sports-identity-54",
      canonical_title: "2024 Panini Contenders Jaren Jackson Rookie Ticket Auto #54",
      retrieval_status: "reviewed",
      source_type: "REVIEWED_INTERNAL",
      normalized_score: 1,
      supporting_fields: ["year", "product", "collector_number"],
      fields: {
        year: "2024",
        manufacturer: "Panini",
        product: "Panini Contenders",
        players: ["Jaren Jackson"],
        card_name: "Rookie Ticket Autograph",
        collector_number: "54"
      }
    }]
  })
});
assert.equal(
  sportsProbe.plan.route,
  anchorRoutes.NORMAL_L2,
  "raw product and bare-year patches rejected by canonical preingestion must not unlock the sports fast lane"
);
assert.equal(sportsProbe.finalized, false);
assert.equal(sportsProbe.metrics.lookup_attempted, false);

console.log("v4-anchor-router.test.mjs OK");
