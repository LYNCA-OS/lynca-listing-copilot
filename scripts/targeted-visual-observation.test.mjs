import assert from "node:assert/strict";

import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import {
  buildTargetedVisualPrompt,
  expandTargetedVisualFields,
  expandTargetedVisualPacket,
  runTargetedVisualObservation,
  selectTargetedVisualImages,
  targetedVisualImageManifest,
  targetedVisualObservationSafety,
  targetedVisualResponseSchema
} from "../lib/listing/v4/targeted-assist/targeted-visual-observation.mjs";

const routeTargets = ["year", "manufacturer", "players", "card_name_or_insert_or_code"];
const expanded = expandTargetedVisualFields(routeTargets);
assert.deepEqual(expanded, [
  "year",
  "manufacturer",
  "players",
  "card_name",
  "insert",
  "set",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "card_number"
]);
assert.throws(
  () => expandTargetedVisualFields(["product"]),
  /READ-only: product/
);

const images = [
  { image_id: "front", role: "front", signed_url: "https://example.test/front.jpg" },
  { image_id: "back", role: "back", signed_url: "https://example.test/back.jpg" },
  { image_id: "serial", role: "serial_crop", derived: true, signed_url: "https://example.test/serial.jpg" },
  { image_id: "subject", role: "subject_crop", derived: true, signed_url: "https://example.test/subject.jpg" },
  { image_id: "code", role: "card_code_crop", derived: true, signed_url: "https://example.test/code.jpg" },
  { image_id: "year", role: "year_product_crop", derived: true, signed_url: "https://example.test/year.jpg" },
  { image_id: "unrelated", role: "parallel_crop", derived: true, signed_url: "https://example.test/parallel.jpg" }
];
const selected = selectTargetedVisualImages(images, routeTargets, {
  imagePolicy: "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
  maxDerived: 4
});
assert.deepEqual(selected.map((image) => image.image_id), ["front", "back", "year", "subject", "code"]);
assert.equal(selected.some((image) => image.image_id === "unrelated"), false);
assert.deepEqual(targetedVisualImageManifest(selected), [
  { ref: "image_1", image_id: "front", role: "front", side: "front" },
  { ref: "image_2", image_id: "back", role: "back", side: "back" },
  { ref: "image_3", image_id: "year", role: "year_product_crop", side: "front" },
  { ref: "image_4", image_id: "subject", role: "subject_crop", side: "front" },
  { ref: "image_5", image_id: "code", role: "card_code_crop", side: "front" }
]);

const cropOnly = selectTargetedVisualImages(images, ["players"], {
  imagePolicy: "RELEVANT_CROPS_ONLY",
  maxDerived: 4
});
assert.deepEqual(cropOnly.map((image) => image.image_id), ["subject"]);

const partialCropCoverage = selectTargetedVisualImages(
  images.filter((image) => image.image_id !== "code"),
  expanded,
  {
    imagePolicy: "RELEVANT_CROPS_ONLY",
    maxDerived: 4,
    requiredTargets: routeTargets
  }
);
assert.deepEqual(
  partialCropCoverage.map((image) => image.image_id),
  ["front", "back", "year", "subject"],
  "a year/product crop must not masquerade as coverage for the identity OR-group"
);

const schema = targetedVisualResponseSchema(routeTargets, selected);
assert.equal(schema.additionalProperties, false);
assert.ok(schema.properties.v.properties.s.items.properties.f.enum.includes("year"));
assert.equal(schema.properties.v.properties.s.items.properties.f.enum.includes("product"), false);
assert.deepEqual(schema.properties.e.items.properties.i.enum, ["image_1", "image_2", "image_3", "image_4", "image_5"]);
assert.match(buildTargetedVisualPrompt(routeTargets, selected), /image_1=front, image_2=back/);
assert.match(buildTargetedVisualPrompt(routeTargets, selected), /Never infer product, team/);
assert.match(
  buildTargetedVisualPrompt(expanded, selected, routeTargets),
  /any one of \[card_name, insert, set, collector_number, checklist_code, tcg_card_number, card_number\]/
);

const packet = {
  r: "CONFIRMED",
  v: {
    s: [
      { f: "year", v: "2024" },
      { f: "manufacturer", v: "Panini" },
      { f: "set", v: "Fade To Black" },
      { f: "collector_number", v: "FTB-12" }
    ],
    b: [],
    n: [],
    l: [{ f: "players", v: ["Victor Wembanyama"] }]
  },
  e: [
    { f: "year", s: "PRINTED_TEXT", i: "image_2", t: "2024" },
    { f: "manufacturer", s: "PRINTED_TEXT", i: "image_2", t: "PANINI" },
    { f: "set", s: "PRINTED_TEXT", i: "image_1", t: "FADE TO BLACK" },
    { f: "collector_number", s: "PRINTED_TEXT", i: "image_5", t: "FTB-12" },
    { f: "players", s: "PRINTED_TEXT", i: "image_4", t: "VICTOR WEMBANYAMA" }
  ],
  u: []
};
const parsed = expandTargetedVisualPacket(packet, routeTargets, { selectedImages: selected });
assert.equal(parsed.fields.set, "Fade To Black");
assert.deepEqual(parsed.fields.players, ["Victor Wembanyama"]);
assert.equal(Object.keys(parsed.field_evidence).length, 5);
assert.equal(parsed.field_evidence.year.source_image_id, "back");
assert.equal(parsed.field_evidence.year.source_region, "back");
assert.equal(parsed.field_evidence.year.source_type, "VISION_MODEL");
assert.equal(parsed.field_evidence.year.review_required, true);
assert.equal(parsed.field_evidence.year.direct_observation, false);
assert.equal(parsed.field_evidence.collector_number.source_image_id, "code");
assert.deepEqual(targetedVisualObservationSafety(parsed, routeTargets), {
  safe: true,
  reason: "TARGETED_OBSERVATION_SUFFICIENT",
  missing_requested_fields: [],
  subject_present: true,
  literal_identity_present: true
});

assert.throws(
  () => expandTargetedVisualPacket({
    ...packet,
    v: { ...packet.v, s: [...packet.v.s, { f: "product", v: "Prizm" }] }
  }, routeTargets, { selectedImages: selected }),
  /invalid or duplicate field product/
);
assert.throws(
  () => expandTargetedVisualPacket({ ...packet, e: packet.e.filter((row) => row.f !== "set") }, routeTargets, { selectedImages: selected }),
  /lack direct evidence: set/
);

const unsafe = expandTargetedVisualPacket({
  ...packet,
  v: { ...packet.v, l: [] },
  e: packet.e.filter((row) => row.f !== "players"),
  u: ["players"]
}, routeTargets, { selectedImages: selected });
assert.equal(targetedVisualObservationSafety(unsafe, routeTargets).safe, false);
assert.equal(targetedVisualObservationSafety(unsafe, routeTargets).reason, "TARGETED_SUBJECT_MISSING");
assert.equal(targetedVisualObservationSafety(unsafe, ["year", "manufacturer"], {
  knownFields: { players: ["Victor Wembanyama"], collector_number: "FTB-12" }
}).safe, true);

// Regression: a targeted route must not admit an unrequested title-bearing
// field, an invented image reference, unsupported literal text, or a
// VISIBLE_APPEARANCE identity assertion into parsed provider evidence.
const narrowTargets = ["year", "players"];
assert.throws(
  () => expandTargetedVisualPacket({
    r: "CONFIRMED",
    v: {
      s: [{ f: "year", v: "2024" }, { f: "set", v: "Injected Set" }],
      b: [],
      n: [],
      l: [{ f: "players", v: ["Correct Subject"] }]
    },
    e: [
      { f: "year", s: "PRINTED_TEXT", i: "image_2", t: "2024" },
      { f: "set", s: "VISIBLE_APPEARANCE", i: "image_1", t: "" },
      { f: "players", s: "PRINTED_TEXT", i: "image_4", t: "Correct Subject" }
    ],
    u: []
  }, narrowTargets, { selectedImages: selected }),
  /invalid or duplicate field set/
);
assert.throws(
  () => expandTargetedVisualPacket({
    r: "CONFIRMED",
    v: { s: [{ f: "year", v: "2024" }], b: [], n: [], l: [] },
    e: [{ f: "year", s: "PRINTED_TEXT", i: "image_2", t: "COPYRIGHT 1999" }],
    u: []
  }, ["year"], { selectedImages: selected }),
  /does not support value for year/
);
assert.throws(
  () => expandTargetedVisualPacket({
    r: "CONFIRMED",
    v: { s: [{ f: "year", v: "2024" }], b: [], n: [], l: [] },
    e: [{ f: "year", s: "PRINTED_TEXT", i: "attacker-controlled-id", t: "2024" }],
    u: []
  }, ["year"], { selectedImages: selected }),
  /invalid image ref for year/
);
assert.throws(
  () => expandTargetedVisualPacket({
    r: "CONFIRMED",
    v: { s: [{ f: "set", v: "Injected Set" }], b: [], n: [], l: [] },
    e: [{ f: "set", s: "VISIBLE_APPEARANCE", i: "image_1", t: "" }],
    u: []
  }, ["set"], { selectedImages: selected }),
  /VISIBLE_APPEARANCE is not allowed for set/
);

const appearanceParsed = expandTargetedVisualPacket({
  r: "CONFIRMED",
  v: {
    s: [{ f: "surface_color", v: "Gold" }],
    b: [{ f: "patch", v: true }],
    n: [],
    l: []
  },
  e: [
    { f: "surface_color", s: "VISIBLE_APPEARANCE", i: "image_1", t: "" },
    { f: "patch", s: "VISIBLE_APPEARANCE", i: "image_1", t: "" }
  ],
  u: []
}, ["surface_color", "patch"], { selectedImages: selected });
assert.equal(appearanceParsed.fields.surface_color, "Gold");
assert.equal(appearanceParsed.fields.patch, true);

// A model can make its invented value and invented `t` agree. That same-call
// agreement must remain review-only model evidence and cannot become direct
// printed-text evidence in the canonical document.
const selfAttested = expandTargetedVisualPacket({
  r: "CONFIRMED",
  v: { s: [{ f: "card_name", v: "Imaginary Superfractor" }], b: [], n: [], l: [] },
  e: [{ f: "card_name", s: "PRINTED_TEXT", i: "image_1", t: "Imaginary Superfractor" }],
  u: []
}, ["card_name"], { selectedImages: selected });
const selfAttestedEvidence = providerPayloadToEvidenceDocument(selfAttested);
assert.equal(selfAttested.field_evidence.card_name.source_type, "VISION_MODEL");
assert.equal(selfAttestedEvidence.evidence.card_name.status, "REVIEW");
assert.equal(selfAttestedEvidence.evidence.card_name.sources[0].source_type, "VISION_MODEL");
const selfAttestedGated = applyIdentityResolutionGate({
  provider: "openai_legacy",
  title: "",
  model_title_suggestion: "",
  resolved: selfAttestedEvidence.resolved,
  evidence: selfAttestedEvidence.evidence,
  unresolved: selfAttestedEvidence.unresolved
}, { providerId: "openai_legacy" });
assert.notEqual(
  selfAttestedGated.publication_gate.field_publication_states.card_name,
  "PUBLISHABLE_EXACT",
  "same-call model value plus model evidence text must never self-certify exact publication"
);

let requestBody = null;
const executed = await runTargetedVisualObservation({
  images,
  targetFields: expanded,
  requiredTargets: routeTargets,
  imagePolicy: "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
  env: { OPENAI_API_KEY: "sk-test-not-real", OPENAI_LISTING_MODEL: "gpt-5-mini" },
  fetchImpl: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_targeted",
        model: "gpt-5-mini",
        status: "completed",
        output_text: JSON.stringify(packet),
        usage: { input_tokens: 700, output_tokens: 70, total_tokens: 770 }
      })
    };
  }
});
assert.equal(executed.targeted_visual_observation.safety.safe, true);
assert.deepEqual(executed.targeted_visual_observation.required_targets, routeTargets);
assert.equal(executed.targeted_visual_observation.input_image_count, 5);
assert.equal(executed.usage.provider_calls, 1);
assert.equal(executed.usage.output_tokens, 70);
assert.equal(requestBody.store, false);
assert.equal("content" in executed, false);

console.log("targeted visual observation tests passed");
