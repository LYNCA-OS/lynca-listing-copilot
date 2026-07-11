import assert from "node:assert/strict";
import { __listingCopilotTitleTestHooks } from "../api/listing-copilot-title.js";
import { createEvidenceField, createVisionSource } from "../lib/listing/evidence/evidence-schema.mjs";
import { extractDirectSlabLabelParallel } from "../lib/listing/preingestion/slab-label-evidence.mjs";

function slabPatch(rawText, confidence = 0.96) {
  return {
    field: "grade",
    value: "PSA 10",
    source_type: "OCR",
    source_image_id: "img-slab",
    crop_id: "crop-slab",
    confidence,
    raw_text: rawText,
    provenance: { crop_type: "grade_label" }
  };
}

const blackScope = extractDirectSlabLabelParallel([
  slabPatch("2021 PANINI CONTENDERS OPTIC\nSPLTNG.IMG - BLACK SCOPE\nPSA 10")
]);
assert.equal(blackScope.verified, true);
assert.equal(blackScope.value, "Black Scope");
assert.equal(blackScope.surface_color, "Black");

const flattenedBlackScope = extractDirectSlabLabelParallel([
  slabPatch("2021 CONTENDERS OPTIC #8 AARON RODGERS GEM MT SPLTNG.IMG-BLACK SCOPE 10 PSA 65992325", 0.9648)
]);
assert.equal(flattenedBlackScope.verified, true, "real PaddleOCR output must retain the printed slab parallel");
assert.equal(flattenedBlackScope.value, "Black Scope");
assert.equal(flattenedBlackScope.surface_color, "Black");

assert.equal(extractDirectSlabLabelParallel([
  slabPatch("2023-24 TOPPS CHROME GOLD LABEL GEM MT 10 PSA 12345678")
]).verified, false, "unmarked grade-label prose must not create parallel evidence");

const orangeRefractor = extractDirectSlabLabelParallel([
  slabPatch("2022 BOWMAN CHROME\nCHR.PROS.AUTO - ORANGE REF.\nPSA 9")
]);
assert.equal(orangeRefractor.verified, true);
assert.equal(orangeRefractor.value, "Orange Refractor");

assert.equal(extractDirectSlabLabelParallel([{
  ...slabPatch("SPLTNG.IMG - BLACK SCOPE"),
  provenance: { crop_type: "serial_number" }
}]).verified, false, "non-slab crops cannot create exact parallel evidence");

assert.equal(extractDirectSlabLabelParallel([
  slabPatch("SPLTNG.IMG - BLACK SCOPE"),
  slabPatch("SPLTNG.IMG - ORANGE SCOPE", 0.97)
]).conflict, true, "conflicting slab readings must fail closed");

const visualOrangeEvidence = createEvidenceField({
  value: "Orange",
  status: "REVIEW",
  confidence: 0.72,
  sources: [createVisionSource({
    sourceType: "VISION_MODEL",
    imageId: "img-card",
    observedText: "orange surface"
  })]
});
const locked = __listingCopilotTitleTestHooks.withVerifiedPreingestionSlabParallel({
  confidence: "MEDIUM",
  fields: {
    year: "2021",
    manufacturer: "Panini",
    product: "Contenders Optic",
    players: ["Aaron Rodgers"],
    surface_color: "Orange",
    parallel_exact: "Orange"
  },
  resolved: {
    year: "2021",
    manufacturer: "Panini",
    product: "Contenders Optic",
    players: ["Aaron Rodgers"],
    surface_color: "Orange",
    parallel_exact: "Orange"
  },
  evidence: {
    surface_color: visualOrangeEvidence,
    parallel_exact: visualOrangeEvidence
  }
}, {
  preingestion_evidence_patches: [
    slabPatch("2021 PANINI CONTENDERS OPTIC\nSPLTNG.IMG - BLACK SCOPE\nPSA 10")
  ]
});

assert.match(locked.final_title, /Black Scope/i);
assert.doesNotMatch(locked.final_title, /Orange/i);
assert.equal(locked.resolved_fields.parallel_exact, "Black Scope");
assert.equal(locked.evidence.parallel_exact.status, "CONFIRMED");
assert.equal(locked.evidence.parallel_exact.sources[0].source_type, "SLAB_LABEL");
assert.equal(locked.conflict_map.at(-1).conflict_type, "SLAB_LABEL_CURRENT_IMAGE_OVERRIDE");

console.log("slab-label-evidence.test.mjs OK");
