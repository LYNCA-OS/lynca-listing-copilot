import assert from "node:assert/strict";
import { extractAnchorDossier, resolvedHintFromAnchorDossier } from "../lib/listing/v4/anchors/anchor-extractor.mjs";
import { anchorRoutes, planAnchorRoute } from "../lib/listing/v4/anchors/anchor-router.mjs";
import { probePreL2Anchors } from "../lib/listing/v4/anchors/pre-l2-anchor-probe.mjs";

function patch(field, value, confidence = 0.94, cropType = "card_code_crop") {
  return {
    field,
    value,
    confidence,
    source_type: "OCR",
    source_image_id: "image_1",
    provenance: { crop_type: cropType }
  };
}

const tcgDossier = extractAnchorDossier({
  preingestion_evidence_patches: [patch("tcg_card_number", "OP01-120")]
});
assert.equal(tcgDossier.anchors[0].anchor_type, "tcg_card_code");
assert.equal(tcgDossier.anchor_candidates.tcg_code[0].value, "OP01-120");
assert.equal(planAnchorRoute(tcgDossier).route, anchorRoutes.TCG_EXACT_LOOKUP);
assert.equal(resolvedHintFromAnchorDossier(tcgDossier).tcg_card_number, "OP01-120");

const sportsDossier = extractAnchorDossier({
  preingestion_evidence_patches: [
    patch("checklist_code", "CL-LM"),
    patch("product_text", "2024 Topps Chrome", 0.91, "year_product_crop"),
    patch("player_names", ["Lionel Messi"], 0.92, "subject_crop")
  ]
});
assert.equal(planAnchorRoute(sportsDossier).route, anchorRoutes.SPORTS_COMPOSITE_LOOKUP);

const insufficient = extractAnchorDossier({
  preingestion_evidence_patches: [patch("checklist_code", "CL-LM")]
});
assert.equal(planAnchorRoute(insufficient).route, anchorRoutes.NORMAL_L2);

const certOnly = extractAnchorDossier({
  preingestion_evidence_patches: [
    patch("grade_company", "PSA", 0.99, "grade_label_crop"),
    patch("cert_number", "87654321", 0.96, "grade_label_crop")
  ]
});
assert.equal(planAnchorRoute(certOnly).route, anchorRoutes.CERT_VERIFY);
assert.equal(planAnchorRoute(certOnly).allow_identity_finalize, false);
assert.equal(certOnly.anchors.find((anchor) => anchor.anchor_type === "cert_number")?.grader, "PSA");

const payloadHintCannotFinalizeSports = extractAnchorDossier({
  resolvedHint: { year: "2024", product: "Topps Chrome", players: ["Lionel Messi"] },
  preingestion_evidence_patches: [patch("checklist_code", "CL-LM")]
});
assert.equal(
  planAnchorRoute(payloadHintCannotFinalizeSports).route,
  anchorRoutes.NORMAL_L2,
  "a direct code plus non-direct payload hints must not bypass full visual recognition"
);

const bareBarcode = extractAnchorDossier({
  preingestion_evidence_patches: [patch("unknown_number", "012345678905", 0.96, "unknown_crop")]
});
assert.equal(bareBarcode.anchors[0]?.anchor_type, "barcode_candidate");
assert.equal(bareBarcode.anchor_candidates.barcode[0].value, "012345678905");
assert.equal(planAnchorRoute(bareBarcode).route, anchorRoutes.NORMAL_L2);

const rarityOnly = extractAnchorDossier({
  preingestion_evidence_patches: [patch("serial_number", "2/3", 0.98, "serial_crop")]
});
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
assert.equal(probe.finalized, true, JSON.stringify(probe));
assert.equal(probe.plan.route, anchorRoutes.TCG_EXACT_LOOKUP);
assert.equal(probe.finalize.resolved_fields.players[0], "Shanks");

console.log("v4-anchor-router.test.mjs OK");
