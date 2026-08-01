import assert from "node:assert/strict";

import {
  CANONICAL_FIELDS_SCHEMA
} from "../lib/listing/thin/canonical-fields.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  BOUNDED_OPEN_EVIDENCE_MAX_ITEMS,
  BOUNDED_OPEN_EVIDENCE_MAX_LABEL_LENGTH,
  BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH,
  BOUNDED_OPEN_EVIDENCE_PROMPT,
  BOUNDED_OPEN_EVIDENCE_SCHEMA,
  buildBoundedOpenEvidenceRequest,
  finishBoundedOpenEvidenceTitle,
  parseBoundedOpenEvidence,
  resolveBoundedOpenEvidence
} from "../lib/listing/thin/bounded-open-evidence.mjs";

const canonical = (overrides = {}) => ({
  year: "2024",
  language: "",
  manufacturer: "Topps",
  product: "Chrome",
  set: "",
  subjects: ["Test Player"],
  team: "",
  card_name: "",
  release_variant: "",
  surface_color: "",
  parallel_family: "",
  parallel_exact: "",
  descriptive_rarity: "",
  card_number: "",
  serial: "",
  attributes: [],
  grade: "",
  grammar: "standard",
  lot_count: "",
  language: "",
  unreadable: [],
  low_confidence: [],
  ...overrides
});

// The production canonical contract is not mutated; the treatment has its own
// schema name and adds exactly one bounded property in the same response.
assert.equal(CANONICAL_FIELDS_SCHEMA.properties.open_evidence, undefined);
assert.equal(BOUNDED_OPEN_EVIDENCE_SCHEMA.properties.open_evidence.maxItems, BOUNDED_OPEN_EVIDENCE_MAX_ITEMS);
assert.equal(BOUNDED_OPEN_EVIDENCE_SCHEMA.properties.open_evidence.items.properties.span.maxLength,
  BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH);
assert.equal(BOUNDED_OPEN_EVIDENCE_SCHEMA.properties.open_evidence.items.properties.label.maxLength,
  BOUNDED_OPEN_EVIDENCE_MAX_LABEL_LENGTH);
assert.equal(BOUNDED_OPEN_EVIDENCE_SCHEMA.properties.open_evidence.items.properties.label.enum, undefined,
  "the evidence label stays open-set");
assert.ok(BOUNDED_OPEN_EVIDENCE_SCHEMA.required.includes("open_evidence"));
assert.deepEqual([...BOUNDED_OPEN_EVIDENCE_SCHEMA.required].sort(),
  Object.keys(BOUNDED_OPEN_EVIDENCE_SCHEMA.properties).sort(),
  "strict structured output requires every property to be required");

const request = buildBoundedOpenEvidenceRequest({
  imageUrls: ["https://example.invalid/front.jpg", "https://example.invalid/back.jpg"],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "high"
});
assert.equal(request.input.length, 1, "canonical and evidence must share one Luna call");
assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length, 2);
assert.equal(request.text.format.name, "canonical_card_fields_bounded_evidence_v1");
assert.match(BOUNDED_OPEN_EVIDENCE_PROMPT, /Evidence permission is copy-only/);
assert.match(BOUNDED_OPEN_EVIDENCE_PROMPT, /Do NOT enumerate statistics, career or biography text, copyright\/legal lines/);

const evidence = [
  { span: "027/150", region: "card_front", label: "stamped_number", confidence: "high" },
  { span: "1st", region: "card_front", label: "printed_mark", confidence: "high" },
  { span: "Jersey", region: "card_front", label: "component_mark", confidence: "high" },
  { span: "Redemption Card", region: "card_back", label: "card_type_mark", confidence: "high" },
  { span: "Topps Chrome Disney 100", region: "slab_label", label: "product_name", confidence: "high" }
];
const parsed = parseBoundedOpenEvidence({ ...canonical(), open_evidence: evidence });
assert.deepEqual(parsed.open_evidence, evidence,
  "every valid unpromoted row and exact span must survive parsing without normalization loss");
assert.equal(parsed.open_evidence[0].span, "027/150", "leading zeroes and slash are evidence");

const resolved = resolveBoundedOpenEvidence(parsed.fields, parsed.open_evidence);
assert.equal(resolved.fields.serial, "027/150");
assert.equal(resolved.fields.descriptive_rarity, "1st");
assert.ok(resolved.fields.attributes.includes("Jersey"));
assert.ok(resolved.fields.components.includes("Jersey"));
assert.equal(resolved.fields.card_name, "Redemption Card");
assert.equal(resolved.fields.product, "Chrome",
  "an open product phrase must not rewrite canonical product without an authoritative registry");
assert.equal(resolved.decisions.length, evidence.length, "each retained row needs an explicit disposition");
assert.equal(resolved.decisions.at(-1).disposition, "candidate_only");
assert.equal(resolved.decisions.at(-1).reason, "authoritative_registry_required");
assert.deepEqual(resolved.decisions.at(-1).evidence, evidence.at(-1),
  "candidate-only evidence must not disappear after resolution");

const registryEvidence = {
  span: "Donruss Optic", region: "slab_label", label: "product_name", confidence: "high"
};
const registryResolved = resolveBoundedOpenEvidence(
  parseBoundedOpenEvidence(canonical({ product: "" })).fields,
  [registryEvidence],
  {
    authoritativeRegistry: [{
      ...registryEvidence,
      field: "product",
      value: "Donruss Optic",
      source_type: "OFFICIAL_CHECKLIST",
      anchor_agreement: { exact_code_match: true }
    }]
  }
);
assert.equal(registryResolved.fields.product, "Donruss Optic");
assert.equal(registryResolved.decisions[0].reason, "authoritative_registry_exact_anchor");

const weakRegistry = resolveBoundedOpenEvidence(
  parseBoundedOpenEvidence(canonical({ product: "" })).fields,
  [registryEvidence],
  {
    authoritativeRegistry: [{
      ...registryEvidence,
      field: "product",
      source_type: "MARKETPLACE",
      anchor_agreement: { exact_code_match: true }
    }]
  }
);
assert.equal(weakRegistry.fields.product, "");
assert.match(weakRegistry.decisions[0].reason, /^authoritative_registry_rejected:/);

// Wrong-role collisions from the real audit: a uniform colour, a biography
// Rookie phrase and a statistics fraction cannot enter any canonical field.
const wrongRoles = [
  { span: "Red", region: "card_front", label: "uniform_color", confidence: "high" },
  { span: "rookie season", region: "card_back", label: "career_biography", confidence: "high" },
  { span: "2/3", region: "card_back", label: "statistics_table", confidence: "high" }
];
const rejected = resolveBoundedOpenEvidence(parseBoundedOpenEvidence({
  ...canonical(), open_evidence: wrongRoles
}).fields, wrongRoles);
assert.equal(rejected.fields.surface_color, "");
assert.equal(rejected.fields.serial, "");
assert.deepEqual(rejected.fields.attributes, []);
assert.ok(rejected.decisions.every((row) => row.disposition === "excluded"));

// A serial-looking span is not enough: the label and confidence are part of
// the anchor, and an existing conflicting canonical value is never overwritten.
const unsafeSerials = resolveBoundedOpenEvidence(parseBoundedOpenEvidence(canonical({ serial: "04/25" })).fields, [
  { span: "038/220", region: "card_front", label: "stamped_number", confidence: "high" },
  { span: "5/5", region: "card_front", label: "stamped_number", confidence: "high" },
  { span: "01/10", region: "card_front", label: "stamped_number", confidence: "medium" }
]);
assert.equal(unsafeSerials.fields.serial, "04/25");
assert.deepEqual(unsafeSerials.decisions.map((row) => row.reason), [
  "canonical_serial_conflict", "exact_leading_zero_stamped_serial_required", "high_confidence_required"
]);

// Bounds fail visibly. No overlong exact span is truncated into false evidence,
// and overflow is counted rather than silently sliced.
const tooLong = "X".repeat(BOUNDED_OPEN_EVIDENCE_MAX_SPAN_LENGTH + 1);
const overBound = parseBoundedOpenEvidence({
  ...canonical(),
  open_evidence: [
    { span: tooLong, region: "card_front", label: "unknown", confidence: "high" },
    ...Array.from({ length: BOUNDED_OPEN_EVIDENCE_MAX_ITEMS }, (_, index) => ({
      span: `Candidate ${index}`,
      region: "card_back",
      label: "unknown",
      confidence: "medium"
    }))
  ]
});
assert.ok(overBound.open_evidence.length <= BOUNDED_OPEN_EVIDENCE_MAX_ITEMS);
assert.ok(!overBound.open_evidence.some((row) => row.span === tooLong.slice(0, -1)),
  "an exact span must be rejected whole, never silently shortened");
assert.ok(overBound.evidence_defects.some((value) => value.startsWith("open_evidence_span_too_long:0:")));
assert.ok(overBound.evidence_defects.includes("open_evidence_overflow:1"));

// Absent lane is a byte-for-byte canonical behavior control for all commercial
// outputs. The treatment adds only its empty evaluation metadata.
const baseFinished = finishCanonicalTitle(canonical());
const absentFinished = finishBoundedOpenEvidenceTitle(canonical());
for (const key of [
  "title", "fields", "field_defects", "sanitised", "truncated", "grammar",
  "brackets", "dropped_brackets", "suppressed_brackets", "restored_brackets",
  "empty_fields", "unreadable_fields", "low_confidence_fields", "inferred_parent", "length"
]) {
  assert.deepEqual(absentFinished[key], baseFinished[key], `canonical behavior changed without lane: ${key}`);
}
assert.deepEqual(absentFinished.open_evidence, []);
assert.deepEqual(absentFinished.evidence_resolution, []);
assert.equal(absentFinished.production_promoted, false);

const treatmentFinished = finishBoundedOpenEvidenceTitle({ ...canonical(), open_evidence: evidence });
assert.match(treatmentFinished.title, /027\/150/);
assert.match(treatmentFinished.title, /Jersey/);
assert.equal(treatmentFinished.open_evidence.length, evidence.length,
  "all bounded evidence remains available even when only some rows are promoted");

console.log("bounded open evidence tests passed");
