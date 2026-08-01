#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CANONICAL_FIELDS_SCHEMA } from "../lib/listing/thin/canonical-fields.mjs";
import {
  BOUNDED_EVIDENCE_V2_MAX_ITEMS,
  BOUNDED_EVIDENCE_V2_PROMPT,
  BOUNDED_EVIDENCE_V2_SCHEMA,
  BOUNDED_EVIDENCE_V2_SCHEMA_NAME,
  BOUNDED_EVIDENCE_V2_VERSION,
  buildBoundedEvidenceV2Request,
  finishBoundedEvidenceV2Title,
  parseBoundedEvidenceV2,
  resolveBoundedEvidenceV2ForEvaluation
} from "../lib/listing/thin/bounded-evidence-v2.mjs";
import { ARM_SPECS, buildRunManifest } from "./run-thin-path-eval.mjs";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/bounded-evidence-v2-response.json", import.meta.url),
  "utf8"
));

assert.equal(CANONICAL_FIELDS_SCHEMA.properties.evidence_spans, undefined,
  "the production canonical schema must remain untouched");
assert.equal(BOUNDED_EVIDENCE_V2_SCHEMA.properties.evidence_spans.maxItems,
  BOUNDED_EVIDENCE_V2_MAX_ITEMS);
assert.ok(BOUNDED_EVIDENCE_V2_SCHEMA.required.includes("evidence_spans"));
assert.deepEqual(
  [...BOUNDED_EVIDENCE_V2_SCHEMA.required].sort(),
  Object.keys(BOUNDED_EVIDENCE_V2_SCHEMA.properties).sort(),
  "strict output requires every top-level property"
);
const rowSchema = BOUNDED_EVIDENCE_V2_SCHEMA.properties.evidence_spans.items;
assert.deepEqual([...rowSchema.required].sort(), Object.keys(rowSchema.properties).sort());
assert.equal(rowSchema.properties.advisory_role.enum, undefined,
  "model-authored roles must stay advisory/open-set");

const request = buildBoundedEvidenceV2Request({
  imageUrls: ["https://example.invalid/front.jpg", "https://example.invalid/back.jpg"],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "high"
});
assert.equal(request.text.format.name, BOUNDED_EVIDENCE_V2_SCHEMA_NAME);
assert.equal(request.input[0].content.filter(({ type }) => type === "input_image").length, 2);
assert.match(BOUNDED_EVIDENCE_V2_PROMPT, /advisory_role is only your suggestion/);
assert.match(BOUNDED_EVIDENCE_V2_PROMPT, /do not use the ledger to set or overwrite fields\.serial/);
assert.match(BOUNDED_EVIDENCE_V2_PROMPT, /Copyright years, colours, patterns/);
assert.match(BOUNDED_EVIDENCE_V2_PROMPT, /Do not enumerate statistics/);

const parsed = parseBoundedEvidenceV2(fixture);
assert.equal(parsed.fields.serial, "",
  "current-copy evidence must never be written into canonical fields.serial");
assert.equal(parsed.evidence_spans.length, 4);
assert.equal(parsed.evidence_noise_dropped.length, 2);
const serial = parsed.evidence_spans.find(({ exact_text }) => exact_text === "027/150");
assert.deepEqual(serial, {
  exact_text: "027/150",
  image: "image_1",
  region: "card_front",
  source: "stamped_text",
  advisory_role: "serial",
  uncertainty: "none",
  disposition: "current_copy_renderer_evidence",
  candidate_field: "numerical_rarity",
  promotion_allowed: false,
  reason: "current-copy numbering evidence; not a canonical editable CSM field"
});
assert.equal(parsed.evidence_spans.find(({ exact_text }) => exact_text === "©2025").candidate_field, "year");
assert.equal(parsed.evidence_spans
  .find(({ exact_text }) => exact_text.includes("refractor-style")).candidate_field, "print_finish");
assert.ok(parsed.evidence_spans.every(({ promotion_allowed }) => promotion_allowed === false));
assert.deepEqual(parsed.evidence_noise_dropped.map(({ reason }) => reason).sort(), [
  "duplicate_exact_text", "statistics_or_biography"
]);

const copyrightDedupe = parseBoundedEvidenceV2({
  ...fixture,
  evidence_spans: [
    fixture.evidence_spans[2],
    { ...fixture.evidence_spans[2], exact_text: "Copyright 2024" }
  ]
});
assert.equal(copyrightDedupe.evidence_candidates.length, 1);
assert.equal(copyrightDedupe.evidence_noise_dropped[0].reason,
  "duplicate_copyright_year_candidate");

// A malicious advisory role cannot turn an exact serial into Product, and no
// retained row changes the title until a later independently measured resolver.
const misleading = parseBoundedEvidenceV2({
  ...fixture,
  evidence_spans: [{
    exact_text: "04/25", image: "image_1", region: "card_front",
    source: "stamped_text", advisory_role: "product", uncertainty: "none"
  }]
});
assert.equal(misleading.evidence_spans[0].candidate_field, "numerical_rarity");
assert.equal(misleading.fields.product, fixture.product);
const finished = finishBoundedEvidenceV2Title(fixture);
assert.equal(finished.evidence_schema_version, BOUNDED_EVIDENCE_V2_VERSION);
assert.deepEqual(finished.evidence_promotions, [{
  exact_text: "027/150",
  target: "current_copy_renderer",
  canonical_field_written: null,
  reason: "sem_serial_evidence_renderer_only"
}]);
assert.equal(finished.production_promoted, false);
assert.match(finished.title, /027\/150/);
assert.doesNotMatch(finished.canonical_control_title, /027\/150/);
assert.equal(finished.fields.serial, "");

const exactSerialEvidence = parsed.evidence_spans.filter(({ exact_text }) => exact_text === "027/150");
const sameSerial = resolveBoundedEvidenceV2ForEvaluation({
  ...parsed.fields, serial: "27/150"
}, exactSerialEvidence);
assert.equal((sameSerial.title.match(/027\/150/g) || []).length, 1,
  "numerically identical serial evidence must replace the renderer overlay, not append");
assert.doesNotMatch(sameSerial.title, /(?:^|\s)27\/150(?:$|\s)/);
assert.equal(sameSerial.overlay_fields.serial, "027/150");

const emptySerial = resolveBoundedEvidenceV2ForEvaluation({
  ...parsed.fields, serial: ""
}, exactSerialEvidence);
assert.equal((emptySerial.title.match(/027\/150/g) || []).length, 1);
assert.equal(emptySerial.overlay_fields.serial, "027/150");

const conflictingSerial = resolveBoundedEvidenceV2ForEvaluation({
  ...parsed.fields, serial: "28/150"
}, exactSerialEvidence);
assert.equal(conflictingSerial.overlay_fields.serial, "28/150");
assert.doesNotMatch(conflictingSerial.title, /027\/150/);
assert.deepEqual(conflictingSerial.promotions, [{
  exact_text: "027/150",
  target: "current_copy_renderer",
  canonical_field_written: null,
  reason: "sem_serial_evidence_renderer_only",
  blocked: "conflict",
  canonical_serial: "28/150"
}]);

const spacedSameSerial = resolveBoundedEvidenceV2ForEvaluation({
  ...parsed.fields, serial: "27 / 150"
}, exactSerialEvidence);
assert.equal(spacedSameSerial.overlay_fields.serial, "027/150",
  "slash spacing must not turn the same numerical serial into a conflict");
assert.equal(spacedSameSerial.promotions[0].blocked, undefined);

const spacedEvidenceParsed = parseBoundedEvidenceV2({
  ...fixture,
  serial: "27/150",
  evidence_spans: [{
    exact_text: "027 / 150",
    image: "image_1",
    region: "card_front",
    source: "stamped_text",
    advisory_role: "serial",
    uncertainty: "none"
  }]
});
const spacedEvidence = resolveBoundedEvidenceV2ForEvaluation(
  spacedEvidenceParsed.fields, spacedEvidenceParsed.evidence_spans
);
assert.equal(spacedEvidence.overlay_fields.serial, "027/150");
assert.equal((spacedEvidence.title.match(/027\/150/g) || []).length, 1);
assert.doesNotMatch(spacedEvidence.title, /027\s+\/\s+150/);
assert.equal(spacedEvidenceParsed.evidence_spans[0].exact_text, "027 / 150",
  "the ledger keeps raw exact text even though renderer spacing is normalized");

for (const invalid of ["0/0", "000/150", "999/10"]) {
  const invalidParsed = parseBoundedEvidenceV2({
    ...fixture,
    serial: "",
    evidence_spans: [{
      exact_text: invalid,
      image: "image_1",
      region: "card_front",
      source: "stamped_text",
      advisory_role: "serial",
      uncertainty: "none"
    }]
  });
  assert.notEqual(invalidParsed.evidence_spans[0].disposition, "current_copy_renderer_evidence",
    `${invalid} is not a valid current-copy print-run fraction`);
  assert.equal(resolveBoundedEvidenceV2ForEvaluation(
    invalidParsed.fields, invalidParsed.evidence_spans
  ).promotions.length, 0);
}

const tcgChecklist = parseBoundedEvidenceV2({
  ...fixture,
  manufacturer: "Pokemon",
  product: "Pokemon Twilight Masquerade",
  set: "Twilight Masquerade",
  grammar: "tcg",
  serial: "",
  card_number: "",
  evidence_spans: [{
    exact_text: "089/063",
    image: "image_2",
    region: "card_back",
    source: "printed_text",
    advisory_role: "checklist number",
    uncertainty: "none"
  }]
});
assert.equal(tcgChecklist.fields.grammar, "tcg");
assert.notEqual(tcgChecklist.evidence_spans[0].disposition, "current_copy_renderer_evidence");
assert.equal(resolveBoundedEvidenceV2ForEvaluation(
  tcgChecklist.fields, tcgChecklist.evidence_spans
).promotions.length, 0, "a printed TCG checklist code must never become a serial overlay");

const budgeted = finishBoundedEvidenceV2Title({
  ...fixture,
  product: "Topps Chrome The Complete Series Volume 2025 Premium Collection",
  card_name: "Superfractor Rookie Autograph Commemorative Patch Variation",
  subjects: ["George Raymond Kittle III"],
  evidence_spans: [
    fixture.evidence_spans[0],
    { exact_text: "1st Bowman", image: "image_1", region: "card_front",
      source: "printed_text", advisory_role: "rarity mark", uncertainty: "none" },
    { exact_text: "Jersey", image: "image_1", region: "card_front",
      source: "printed_text", advisory_role: "component mark", uncertainty: "none" }
  ]
});
assert.ok(budgeted.title.length <= 80 && budgeted.canonical_control_title.length <= 80,
  "both same-response titles must obey the marketplace budget");
assert.equal(budgeted.overlay_fields.serial, "027/150");
assert.equal(budgeted.overlay_fields.descriptive_rarity, "1st Bowman");
assert.ok(budgeted.overlay_fields.components.includes("Jersey"));
assert.equal(budgeted.fields.serial, "");
assert.notEqual(budgeted.fields.descriptive_rarity, "1st Bowman");
assert.ok(!budgeted.fields.components.includes("Jersey"),
  "evaluation overlays must not mutate returned canonical fields");

// The resume fingerprint binds the paired arm, exact response schema, prompt,
// detail and dataset bytes. Any one changing requires a fresh out-dir.
const scratch = await mkdtemp(join(tmpdir(), "bounded-evidence-v2-manifest-"));
try {
  const dataset = join(scratch, "dataset.json");
  const labels = join(scratch, "labels.jsonl");
  await writeFile(dataset, '{"items":[]}\n');
  await writeFile(labels, "");
  const arms = [
    { key: "thin_canonical_high", ...ARM_SPECS.thin_canonical_high },
    { key: "thin_canonical_bounded_evidence_v2_high", ...ARM_SPECS.thin_canonical_bounded_evidence_v2_high }
  ];
  const input = {
    arms, model: "gpt-5.6-luna", effort: "none", imageDetail: "high",
    limit: 100, dataset, sealedLabels: labels
  };
  const baseline = await buildRunManifest(input);
  const treatment = baseline.contract.arms[1];
  assert.equal(treatment.eval_version, BOUNDED_EVIDENCE_V2_VERSION);
  assert.equal(treatment.response_schema_name, BOUNDED_EVIDENCE_V2_SCHEMA_NAME);
  assert.match(treatment.response_schema_sha256, /^[0-9a-f]{64}$/);
  assert.match(treatment.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.notEqual((await buildRunManifest({
    ...input,
    arms: [arms[0], { ...arms[1], prompt: `${arms[1].prompt} changed` }]
  })).fingerprint, baseline.fingerprint);
  assert.notEqual((await buildRunManifest({
    ...input,
    arms: [arms[0], { ...arms[1], imageDetail: "original" }]
  })).fingerprint, baseline.fingerprint);
  await writeFile(dataset, '{"items":[{"asset_id":"changed"}]}\n');
  assert.notEqual((await buildRunManifest(input)).fingerprint, baseline.fingerprint);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log("bounded evidence v2 tests passed");
