#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { computeVerifiedOriginalSetSha256 } from
  "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  composeLyncaStandardNameForProfile,
  LYNCA_STANDARD_PROFILE_VERSION_V1,
  LYNCA_STANDARD_PROFILE_VERSION_V3
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  handleResolutionViewRequest,
  publicVerifiedOriginalObservationSupport
} from "../api/csm-resolution-view.js";
import {
  buildCsmStageRows,
  computeCsmPacketHashes
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  projectVerifiedOriginalObservationReadback,
  readCsmResolutionRecord
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  replayFromRows,
  validateVerifiedOriginalObservationReplayPacket,
  verifyReplay
} from "../lib/listing/thin/csm-replay.mjs";
import {
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT,
  findVerifiedOriginalObservationRecord,
  postObservationResolutionContractForVerifiedOriginals,
  publicVerifiedOriginalObservationReceipt,
  resolveVerifiedOriginalObservation,
  validatePostObservationResolutionContractSelection,
  validateVerifiedOriginalObservationPublicReceipt,
  validateVerifiedOriginalObservationReceipt,
  verifiedOriginalObservationReleaseForReceipt,
  verifiedOriginalObservationReplayProjection,
  VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT,
  VERIFIED_ORIGINAL_OBSERVATION_PACK,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT,
  VERIFIED_ORIGINAL_SET_INDEX
} from "../lib/listing/thin/verified-original-observation-support.mjs";

const fixturePath = resolve(import.meta.dirname, "../fixtures/csm/subset-a-low-canonical-v1.json");
const modulePath = resolve(
  import.meta.dirname,
  "../lib/listing/thin/verified-original-observation-support.mjs"
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const moduleSource = readFileSync(modulePath, "utf8");
const hex64 = /^[0-9a-f]{64}$/;
const domainDigest = (domain, value) => createHash("sha256")
  .update(`${domain}\0`)
  .update(JSON.stringify(value))
  .digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const privateSha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const composeVerifiedOriginal = (fields) => composeLyncaStandardNameForProfile(fields, {
  marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V3,
  publicationCoverage: true
});
const composeHistoricalStandard = (fields) => composeLyncaStandardNameForProfile(fields, {
  marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V1
});
const noSearchReceipts = (fields) => ({
  founderBetaWebReceipt: {
    schema_version: "founder-beta-web-receipt-v1",
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: "gpt-5.6-luna",
    reasoning_effort: "low",
    web_search_used: false,
    web_search_call_count: 0,
    queries: [],
    urls: [],
    field_evidence: [],
    semantic_state_sha256: "f".repeat(64)
  },
  setCardNameRelationReceipt: {
    schema_version: "set-card-name-relations-v1",
    set: fields.set ? { predicate: "CURRENT_CARD_MEMBER_OF_SET", value: fields.set } : null,
    card_name: fields.card_name
      ? { predicate: "CURRENT_CARD_NAMED_BY_DESIGN", value: fields.card_name } : null
  }
});

const sourceEvidence = fixture.cases.map(({
  id, evidence_partition, images, anchors, canonical_fields
}) => ({ id, evidence_partition, images, anchors, canonical_fields }));
assert.equal(
  domainDigest("lynca-subset-a-low-source-evidence-v1", sourceEvidence),
  fixture.contract.source_evidence_content_sha256,
  "the historical low fixture stays independently content-addressed"
);

const identityManifest = fixture.cases.map(({ id, images }) => ({
  id,
  images: images.map(({ sha256 }) => ({ sha256 }))
}));
assert.equal(
  domainDigest("lynca-subset-a-original-image-identity-v1", identityManifest),
  VERIFIED_ORIGINAL_SET_INDEX.source_identity_manifest_sha256,
  "the original-image identity manifest is independent of low canonical facts"
);

const recomputedIndex = fixture.cases.map(({ id, images }) => ({
  id,
  original_set_sha256: computeVerifiedOriginalSetSha256(images.map(({ sha256 }) => sha256))
}));
assert.deepEqual(VERIFIED_ORIGINAL_SET_INDEX.sets, recomputedIndex);
assert.equal(VERIFIED_ORIGINAL_SET_INDEX.sets.length, 16);
assert.equal(new Set(VERIFIED_ORIGINAL_SET_INDEX.sets.map(
  ({ original_set_sha256 }) => original_set_sha256
)).size, 16);
assert.equal(
  VERIFIED_ORIGINAL_SET_INDEX.index_sha256,
  "da19f4a0aae1bfdeabe13d7eb8faf4957b9a2352d0b295718e01b3550a94a253"
);
assert.equal(VERIFIED_ORIGINAL_OBSERVATION_PACK.records.length, 16);
assert.deepEqual(
  VERIFIED_ORIGINAL_OBSERVATION_PACK.records.map(({ original_set_sha256 }) => (
    original_set_sha256
  )).sort(),
  recomputedIndex.map(({ original_set_sha256 }) => original_set_sha256).sort()
);
assert.equal(
  VERIFIED_ORIGINAL_OBSERVATION_PACK.pack_sha256,
  "8d185675a37a7a37c51b0f32a1a319e4f4107961be4006101801d9e8764629f3"
);
assert.equal(
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  "7eff4c74ccb32683ebb11ba778e2763e0b08062863956c2e64452b39575a4a87"
);
assert.equal(
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  "3c5e9260011db7a017af7fbe0dc1faa631e0338aab68111870caa83e6a861efb"
);
for (const digest of [
  VERIFIED_ORIGINAL_SET_INDEX.index_sha256,
  VERIFIED_ORIGINAL_OBSERVATION_PACK.pack_sha256,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256
]) assert.ok(hex64.test(digest));

assert.deepEqual(Object.keys(VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT).sort(), [
  "closed_world_field_count", "composer_version", "indexed_set_count",
  "marketplace_profile_version", "pack_sha256", "pack_version",
  "post_observation_contract_sha256", "release_id",
  "resolution_contract_sha256", "schema_version", "set_index_sha256"
]);
assert.equal(VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.indexed_set_count, 16);
assert.equal(VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.closed_world_field_count, 27);
assert.equal(
  VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.pack_sha256,
  VERIFIED_ORIGINAL_OBSERVATION_PACK.pack_sha256
);
assert.equal(
  VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.set_index_sha256,
  VERIFIED_ORIGINAL_SET_INDEX.index_sha256
);
assert.equal(
  VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.resolution_contract_sha256,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256
);
assert.equal(
  VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.post_observation_contract_sha256,
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256
);
assert.doesNotMatch(
  JSON.stringify(VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT),
  /record_id|original_set_sha256|observed_fields|field_decisions|source_url|https?:\/\//
);

// The executable support pack contains reviewed fields, never evaluation
// titles or network/provider behavior.
assert.doesNotMatch(moduleSource, /expected\s*:\s*\{|expected\.title|canonical_title|writer_title/);
assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
assert.doesNotMatch(moduleSource, /MANUAL_VISUAL_AUDIT|COPY_STAMP_LITERAL|SLAB_LABEL_PRESENTATION/);

const EMPTY_OBSERVED_FIELDS = Object.freeze({
  year: "", language: "", manufacturer: "", product: "", set: "", subjects: [],
  team: "", card_name: "", release_variant: "", surface_color: "",
  parallel_family: "", parallel_exact: "", print_finish: "",
  descriptive_rarity: "", card_number: "", serial: "", attributes: [], components: [],
  grading_info: null, grade: "", grammar: "standard", lot_count: "", ip: "",
  special_stamp: "", description: "", search_optimization: [], unreadable: [],
  low_confidence: []
});

function observedFor(entry) {
  const fields = { ...structuredClone(EMPTY_OBSERVED_FIELDS), ...structuredClone(entry.canonical_fields) };
  fields.components = [...(entry.canonical_fields.components || [])];
  fields.attributes = [...fields.components];
  return fields;
}

function poisonedObservation() {
  return {
    ...structuredClone(EMPTY_OBSERVED_FIELDS),
    year: "9999",
    language: "Japanese",
    manufacturer: "Imaginary",
    product: "Poison Product",
    set: "Poison Set",
    subjects: ["Poison Subject", "Poison Subject"],
    team: "Imaginary Team",
    card_name: "Downtown",
    release_variant: "Variation",
    surface_color: "Blue",
    parallel_family: "Wave",
    parallel_exact: "Blue Wave",
    print_finish: "Blue Wave",
    descriptive_rarity: "SSP",
    card_number: "BAD-1",
    serial: "30/50",
    attributes: ["Patch", "Patch"],
    components: ["Patch", "Patch"],
    grading_info: {
      company: "FAKE", card_grade: "10", auto_grade: "10", grade_type: "CARD_AND_AUTO"
    },
    grade: "FAKE 10/10",
    grammar: "lot",
    lot_count: "99",
    ip: "Pokemon",
    special_stamp: "POISON",
    description: "Case Hit",
    search_optimization: ["POISON", "POISON"],
    unreadable: ["serial"],
    low_confidence: ["year"],
    observed_surface_color: "Poison Surface",
    observed_parallel_family: "Poison Family",
    withheld_finish_terms: [{ value: "Poison Finish", reason: "POISON" }]
  };
}

const expectedTitles = Object.freeze({
  a: "2025-26 Topps Chrome Basketball Cooper Flagg Gold Refractor RC #251 50/50",
  b: "2001 Donruss Elite Passing the Torch Barry Bonds Willie Mays Auto #PT-18 22/50",
  c: "2025-26 Topps Bowman Chrome Basketball Prospect Auto Caleb Wilson #CPA-CL 1/1",
  d: "2000 Bowman Chrome Tom Brady RC Patriots #236 BGS 9.5",
  e: "1986 Fleer Michael Jordan Bulls #57 PSA 6",
  f: "2018 Topps Future Stars Auto Shohei Ohtani RC Angels #FS-5 1/5 PSA 8",
  g: "2003-04 Upper Deck UD Glass Monumental Marks LeBron James Auto Jersey #LJJ",
  h: "2024 Bowman Chrome Prospect Auto Leo De Vries Gold Ref 1st Bowman #CPA-LD 45/50",
  i: "2012-13 Panini Prizm Basketball Autographs Kobe Bryant Lakers #1 PSA 9/10",
  j: "2025-26 Topps Bowman Chrome Basketball Cooper Flagg Red Refractor RC #BCV-1 1/5",
  k: "2024 Panini Prizm Jayden Daniels Gold Shimmer RC Commanders #347 09/10 PSA 10",
  l: "2000 Bowman Chrome Tom Brady RC Patriots #236 BGS 9.5",
  m: "2026 Topps Cosmic Chrome Basketball Auto Variation Cooper Flagg RC #CCA-CF 40/50",
  n: "1976 Topps Walter Payton Bears #148 PSA 9",
  o: "2012-13 Immaculate Collection All Star Lineage Autos Kobe Bryant #AS-KB 03/15",
  p: "2017 Panini Impeccable Elegance Patrick Mahomes II Auto Helmet Patch #107 60/75"
});

let correctionSample = null;
const closedWorldSamples = [];
const packetSizeRatios = [];
for (const entry of fixture.cases) {
  const hashes = entry.images.map(({ sha256 }) => sha256);
  const forward = findVerifiedOriginalObservationRecord({ originalImageSha256: hashes });
  const reverse = findVerifiedOriginalObservationRecord({
    originalImageSha256: [...hashes].reverse()
  });
  assert.equal(forward?.originalSetSha256, recomputedIndex.find(({ id }) => id === entry.id)
    .original_set_sha256, `${entry.id}: forward set digest`);
  assert.equal(reverse?.record.record_id, `subset-a-${entry.id}`, `${entry.id}: reverse exact record`);
  assert.equal(reverse?.originalSetSha256, forward?.originalSetSha256,
    `${entry.id}: order-independent set digest`);

  const observed = observedFor(entry);
  const applied = resolveVerifiedOriginalObservation(observed, {
    originalImageSha256: [...hashes].reverse()
  });
  assert.equal(applied.receipt.status, "APPLIED", `${entry.id}: applied`);
  assert.deepEqual(applied.receipt.observed_fields, observed,
    `${entry.id}: raw Luna observation retained`);
  assert.equal(validateVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    resolvedFields: applied.fields
  }), true, `${entry.id}: private receipt validates`);

  const overrideFields = new Set(forward.record.overrides.map(({ field }) => field));
  assert.deepEqual([...overrideFields].sort(), VERIFIED_ORIGINAL_OBSERVATION_PACK.closed_world_fields,
    `${entry.id}: every closed-world field has one fact`);
  for (const override of forward.record.overrides) {
    assert.deepEqual(applied.fields[override.field], override.canonical_value,
      `${entry.id}: reviewed ${override.field}`);
    assert.ok([
      "CARD_PRINTED_TEXT", "CARD_VISUAL_MARKER", "SLAB_LABEL_TEXT",
      "OWNER_AUTHORIZED_PUBLICATION_POLICY"
    ]
      .includes(override.authority), `${entry.id}: closed authority vocabulary`);
    if (override.authority === "OWNER_AUTHORIZED_PUBLICATION_POLICY") {
      assert.equal(override.provenance.source_type, "OWNER_AUTHORIZED_PUBLICATION_POLICY");
      assert.equal(override.provenance.policy_id,
        "lynca.subset-a.closed-world-standard-title-projection");
    } else {
      assert.equal(override.provenance.source_type, "OWNER_AUTHORIZED_CODEX_VISUAL_REVIEW");
      assert.ok(["front_original", "back_original"].includes(override.provenance.image_role));
    }
  }
  assert.deepEqual(applied.fields.attributes, applied.fields.components,
    `${entry.id}: attributes are derived from closed components`);
  assert.deepEqual(
    Object.keys(applied.fields).filter((field) => field !== "attributes").sort(),
    VERIFIED_ORIGINAL_OBSERVATION_PACK.closed_world_fields,
    `${entry.id}: resolved fields contain no stochastic passthrough lane`
  );

  const composed = composeVerifiedOriginal(applied.fields);
  assert.equal(composed.title, expectedTitles[entry.id], `${entry.id}: deterministic CNL snapshot`);
  assert.ok(composed.title.length <= 80, `${entry.id}: 80-character contract`);

  const publicReceipt = publicVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    resolvedFields: applied.fields
  });
  assert.ok(publicReceipt, `${entry.id}: public projection follows full private validation`);
  const publicJson = JSON.stringify(publicReceipt);
  for (const forbidden of [
    "original_set_sha256", "record_id", "observed_fields", "field_decisions",
    "observed_projection_sha256", "resolved_projection_sha256", "support_summary",
    "ripped.topps.com", "tcdb.com", "50/50", ...hashes
  ]) assert.ok(!publicJson.includes(forbidden), `${entry.id}: public redacts ${forbidden}`);

  const packetArgs = {
    tenantId: "tenant-packet-size",
    fields: applied.fields,
    observedFields: observed,
    externalIdentitySupport: { status: "ABSTAINED" },
    composed,
    title: composed.title,
    ...noSearchReceipts(applied.fields)
  };
  const supportedRows = buildCsmStageRows({
    ...packetArgs,
    recognitionSessionId: `session-packet-${entry.id}-0`,
    verifiedOriginalObservationSupport: applied.receipt
  });
  const baselineRows = buildCsmStageRows({
    ...packetArgs,
    recognitionSessionId: `session-packet-${entry.id}-1`,
    composed: composeHistoricalStandard(applied.fields),
    title: composeHistoricalStandard(applied.fields).title,
    contractVersion: "csm-stage-shadow-v2",
    founderBetaWebReceipt: null,
    setCardNameRelationReceipt: null
  });
  const ratio = Buffer.byteLength(JSON.stringify(supportedRows))
    / Buffer.byteLength(JSON.stringify(baselineRows));
  packetSizeRatios.push({ id: entry.id, ratio });
  assert.ok(ratio <= 2, `${entry.id}: closed packet ratio ${ratio.toFixed(3)} must stay <=2x`);

  closedWorldSamples.push({ entry, applied });
  if (entry.id === "a") correctionSample = { entry, observed, applied };
}
const maxPacketSizeRatio = packetSizeRatios.reduce(
  (maximum, current) => current.ratio > maximum.ratio ? current : maximum
);
assert.ok(maxPacketSizeRatio.ratio <= 2,
  "all 16 durable packets stay within the 2x latency/storage guardrail");

{
  const relationMatrix = [
    { id: "b", field: "set", observed: "", action: "FILL", expected: "Passing the Torch" },
    { id: "b", field: "set", observed: "Poison Set", action: "CORRECT_CONFLICT",
      expected: "Passing the Torch" },
    { id: "a", field: "set", observed: "Poison Set", action: "CLEAR_CONFLICT", expected: "" },
    { id: "a", field: "card_name", observed: "Poison Card Name",
      action: "CLEAR_CONFLICT", expected: "" }
  ];
  for (const [index, testCase] of relationMatrix.entries()) {
    const entry = fixture.cases.find(({ id }) => id === testCase.id);
    const observed = observedFor(entry);
    observed[testCase.field] = testCase.observed;
    const applied = resolveVerifiedOriginalObservation(observed, {
      originalImageSha256: entry.images.map(({ sha256 }) => sha256)
    });
    assert.equal(applied.receipt.field_decisions[testCase.field].action, testCase.action);
    assert.equal(applied.fields[testCase.field], testCase.expected);
    const composed = composeVerifiedOriginal(applied.fields);
    const rows = buildCsmStageRows({
      tenantId: "tenant-verified-original-relation",
      recognitionSessionId: `session-verified-original-relation-${index}`,
      fields: applied.fields,
      observedFields: observed,
      externalIdentitySupport: { status: "ABSTAINED" },
      verifiedOriginalObservationSupport: applied.receipt,
      composed,
      title: composed.title,
      ...noSearchReceipts(applied.fields)
    });
    const relation = rows.output.structured_output.set_card_name_relation_receipt[testCase.field];
    if (testCase.expected) assert.equal(relation.value, testCase.expected);
    else assert.equal(relation, null);
    assert.equal(verifyReplay(rows, composed.title).ok, true,
      `${testCase.field}/${testCase.action} authority survives durable replay`);
  }
}

// Every exact original set is a closed deterministic projection. Empty or
// maximally conflicting low observations, and front/back ordering, must not
// change any resolved field or title. This is the executable zero-drift bound;
// it intentionally makes no claim about images outside these 16 sets.
for (const { entry, applied: baseline } of closedWorldSamples) {
  const hashes = entry.images.map(({ sha256 }) => sha256);
  for (const [observationName, observed] of [
    ["empty", structuredClone(EMPTY_OBSERVED_FIELDS)],
    ["poison", poisonedObservation()]
  ]) {
    for (const [orderName, originalImageSha256] of [
      ["forward", hashes],
      ["reverse", [...hashes].reverse()]
    ]) {
      const resolved = resolveVerifiedOriginalObservation(observed, { originalImageSha256 });
      assert.equal(resolved.receipt.status, "APPLIED",
        `${entry.id}: ${observationName}/${orderName} applies`);
      assert.deepEqual(resolved.fields, baseline.fields,
        `${entry.id}: ${observationName}/${orderName} cannot perturb closed fields`);
      assert.equal(composeVerifiedOriginal(resolved.fields).title, expectedTitles[entry.id],
        `${entry.id}: ${observationName}/${orderName} cannot perturb title`);
      assert.equal(validateVerifiedOriginalObservationReceipt(resolved.receipt, {
        observedFields: observed,
        resolvedFields: resolved.fields
      }), true, `${entry.id}: ${observationName}/${orderName} receipt validates`);
    }
  }
}

// Reproduce the actual low-effort defect: exact same a/aa bytes, 30/50 raw
// visual observation, 50/50 reviewed copy stamp, with every other field kept.
{
  const { entry } = correctionSample;
  const observed = observedFor(entry);
  observed.serial = "30/50";
  const applied = resolveVerifiedOriginalObservation(observed, {
    originalImageSha256: entry.images.map(({ sha256 }) => sha256)
  });
  assert.equal(applied.fields.serial, "50/50");
  assert.equal(applied.receipt.field_decisions.serial.action, "CORRECT_CONFLICT");
  assert.ok(applied.receipt.corrected_fields.includes("serial"));
  assert.ok(applied.receipt.corrected_brackets.includes("numerical_rarity"));
  assert.equal(applied.receipt.observed_fields.serial, "30/50");
  correctionSample = { entry, observed, applied };
}

// Closed-world means title output is a function of the exact image-set record,
// not of any stochastic title lane in the low observation.
{
  const { entry } = correctionSample;
  const hashes = entry.images.map(({ sha256 }) => sha256);
  const poison = observedFor(entry);
  Object.assign(poison, {
    year: "2024",
    manufacturer: "Imaginary",
    product: "Poison Product",
    set: "Poison Set",
    card_name: "Downtown",
    release_variant: "Variation",
    surface_color: "Blue",
    parallel_family: "Wave",
    parallel_exact: "Blue Wave",
    print_finish: "Blue Wave",
    descriptive_rarity: "SSP",
    card_number: "BAD-1",
    serial: "30/50",
    components: ["Patch"],
    attributes: ["Patch"],
    search_optimization: ["POISON"],
    team: "Imaginary Team",
    grade: "FAKE 10",
    grammar: "lot",
    lot_count: "99",
    special_stamp: "POISON",
    description: "Case Hit",
    unreadable: ["serial"],
    low_confidence: ["year"]
  });
  const poisoned = resolveVerifiedOriginalObservation(poison, {
    originalImageSha256: hashes
  });
  assert.deepEqual(poisoned.fields, correctionSample.applied.fields,
    "all closed title and trace lanes ignore stochastic low poison");
  assert.equal(composeVerifiedOriginal(poisoned.fields).title, expectedTitles.a);
  assert.equal(poisoned.receipt.field_decisions.special_stamp.action, "CLEAR_CONFLICT");
  assert.equal(poisoned.receipt.field_decisions.manufacturer.action, "CORRECT_CONFLICT");
  assert.equal(correctionSample.applied.receipt.field_decisions.special_stamp.action,
    "CORROBORATE", "empty to authoritative empty is corroboration, never fill");

  const fill = observedFor(entry);
  fill.manufacturer = "";
  const filled = resolveVerifiedOriginalObservation(fill, { originalImageSha256: hashes });
  assert.equal(filled.receipt.field_decisions.manufacturer.action, "FILL");

  const unknown = { ...observedFor(entry), future_title_field: "POISON" };
  assert.throws(() => resolveVerifiedOriginalObservation(unknown, {
    originalImageSha256: hashes
  }), /verified_original_observation_unknown_field:future_title_field/,
  "unknown future field fails closed instead of entering resolved state");
}

{
  const { applied, observed } = correctionSample;
  assert.equal(validateVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    observedProjection: { sem: { year: "tampered" } },
    resolvedFields: applied.fields
  }), false, "supplied observed projection must equal embedded observed fields");
  assert.equal(validateVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    resolvedFields: applied.fields,
    resolvedProjection: { sem: { year: "tampered" } }
  }), false, "supplied resolved projection must equal reviewed overlay");

  const resolvedMismatch = structuredClone(applied.fields);
  resolvedMismatch.serial = "49/50";
  assert.equal(validateVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    resolvedFields: resolvedMismatch
  }), false, "resolved fields and receipt are strongly bound");

  const resealed = structuredClone(applied.receipt);
  resealed.observed_fields.product = "RESEALED";
  resealed.observed_fields_sha256 = privateSha256(resealed.observed_fields);
  assert.equal(validateVerifiedOriginalObservationReceipt(resealed, {
    observedFields: resealed.observed_fields,
    resolvedFields: applied.fields
  }), false, "observed field reseal with stale semantic projection fails closed");

  const extraCorrection = structuredClone(applied.receipt);
  extraCorrection.corrected_fields.push("zz_extra");
  assert.equal(validateVerifiedOriginalObservationReceipt(extraCorrection, {
    observedFields: observed,
    resolvedFields: applied.fields
  }), false, "corrected fields are the exact complete set");

  const wrongProjection = verifiedOriginalObservationReplayProjection(applied.fields);
  wrongProjection.components = ["RESEALED"];
  assert.equal(validateVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    resolvedProjection: wrongProjection
  }), false, "resolved non-SEM projection lanes are strongly bound");

  const tamperedPublic = structuredClone(applied.receipt);
  tamperedPublic.field_decisions.serial.fact_sha256 = "0".repeat(64);
  assert.equal(publicVerifiedOriginalObservationReceipt(tamperedPublic, {
    observedFields: observed,
    resolvedFields: applied.fields
  }), null, "public projection rejects private receipt tamper");

  const extraTopLevel = { ...structuredClone(applied.receipt), top_level_evil: "x" };
  assert.equal(validateVerifiedOriginalObservationReceipt(extraTopLevel, {
    observedFields: observed,
    resolvedFields: applied.fields
  }), false, "private receipt rejects unknown top-level keys");

  const publicReceipt = publicVerifiedOriginalObservationReceipt(applied.receipt, {
    observedFields: observed,
    resolvedFields: applied.fields
  });
  assert.equal(validateVerifiedOriginalObservationPublicReceipt(publicReceipt), true);
  assert.equal(validateVerifiedOriginalObservationPublicReceipt({
    ...publicReceipt,
    top_level_evil: "x"
  }), false, "public receipt rejects unknown top-level keys");
}

function resealRows(rows) {
  rows.resolution.recognition_packet_sha256 = computeCsmPacketHashes(rows)
    .csm_recognition_packet_sha256;
  rows.output.resolution_packet_sha256 = computeCsmPacketHashes(rows)
    .csm_resolution_packet_sha256;
  rows.session_hashes = computeCsmPacketHashes(rows);
  return rows;
}

// Durable replay validates semantics after an attacker has recomputed every
// unkeyed packet hash; packet hashes alone are not an authority boundary.
{
  const { applied, observed } = correctionSample;
  const composed = composeVerifiedOriginal(applied.fields);
  const rows = buildCsmStageRows({
    tenantId: "tenant-verified-original",
    recognitionSessionId: "session-verified-original",
    fields: applied.fields,
    observedFields: observed,
    externalIdentitySupport: { status: "ABSTAINED" },
    verifiedOriginalObservationSupport: applied.receipt,
    composed,
    title: composed.title,
    ...noSearchReceipts(applied.fields)
  });
  const activeV2NonmatchRows = buildCsmStageRows({
    tenantId: "tenant-verified-original",
    recognitionSessionId: "session-active-v2-nonmatch",
    fields: applied.fields,
    observedFields: observed,
    externalIdentitySupport: { status: "ABSTAINED" },
    composed,
    title: composed.title,
    ...noSearchReceipts(applied.fields)
  });
  assert.equal(activeV2NonmatchRows.output.marketplace_profile_version,
    LYNCA_STANDARD_PROFILE_VERSION_V3,
    "active Standard v0.3 remains valid when the exact overlay abstains");
  const historicalComposed = composeHistoricalStandard(applied.fields);
  assert.throws(() => buildCsmStageRows({
    tenantId: "tenant-verified-original",
    recognitionSessionId: "session-overlay-v1-mixed",
    fields: applied.fields,
    observedFields: observed,
    externalIdentitySupport: { status: "ABSTAINED" },
    verifiedOriginalObservationSupport: applied.receipt,
    composed: historicalComposed,
    title: historicalComposed.title,
    contractVersion: "csm-stage-shadow-v2"
  }), /verified_original_observation_profile_mismatch/,
  "an applied overlay receipt cannot be mixed with historical Standard v0.1");
  assert.equal(verifyReplay(rows, composed.title).ok, true,
    "fresh closed projection replays from durable rows");
  assert.equal(validateVerifiedOriginalObservationReplayPacket(rows), true,
    "historical forward reader is independent of the active writer gate");
  const missingAuthority = structuredClone(rows);
  delete missingAuthority.output.structured_output.verified_original_observation_support;
  resealRows(missingAuthority);
  assert.throws(() => replayFromRows(missingAuthority), (error) => (
    error?.code === "verified_original_receipt_missing_or_unexpected"
  ), "a resealed verified-original resolver signal cannot be relabelled as ordinary v3");
  const supportEvidence = rows.evidence.filter((row) => (
    row.source_ref?.support_type === "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
  ));
  const durableSession = {
    identity_snapshot: {
      expected_original_count: 2,
      image_references: correctionSample.entry.images.map(({ sha256 }, index) => ({
        image_role: index === 0 ? "front_original" : "back_original",
        content_sha256: sha256,
        derived: false
      }))
    }
  };
  const durablePublicReceipt = projectVerifiedOriginalObservationReadback({
    session: durableSession,
    rows
  });
  assert.equal(validateVerifiedOriginalObservationPublicReceipt(durablePublicReceipt), true,
    "sealed v3 packet plus exact original snapshot projects one public receipt");
  assert.deepEqual(publicVerifiedOriginalObservationSupport(durablePublicReceipt),
    durablePublicReceipt, "API defense-in-depth accepts only the frozen public receipt schema");
  assert.doesNotMatch(JSON.stringify(durablePublicReceipt),
    /original_set_sha256|observed_fields|field_decisions|50\/50/,
    "zero-call public readback redacts originals and private review facts");
  const withDerived = structuredClone(durableSession);
  withDerived.identity_snapshot.image_references.push({
    image_role: "front_crop",
    content_sha256: "d".repeat(64),
    derived: true
  });
  assert.equal(validateVerifiedOriginalObservationPublicReceipt(
    projectVerifiedOriginalObservationReadback({ session: withDerived, rows })
  ), true, "derived references may coexist but never participate in exact-original identity");
  const derivedSubstitution = structuredClone(durableSession);
  derivedSubstitution.identity_snapshot.image_references[1].derived = true;
  assert.equal(projectVerifiedOriginalObservationReadback({
    session: derivedSubstitution,
    rows
  }), null, "a derived image cannot substitute for one of the two originals");
  const hashCollision = structuredClone(durableSession);
  hashCollision.identity_snapshot.image_references[1].content_sha256 =
    hashCollision.identity_snapshot.image_references[0].content_sha256;
  assert.equal(projectVerifiedOriginalObservationReadback({
    session: hashCollision,
    rows
  }), null, "the two original component hashes must be distinct");
  const transplantedSession = structuredClone(durableSession);
  transplantedSession.identity_snapshot.image_references = fixture.cases[1].images
    .map(({ sha256 }, index) => ({
      image_role: index === 0 ? "front_original" : "back_original",
      content_sha256: sha256,
      derived: false
    }));
  assert.equal(projectVerifiedOriginalObservationReadback({
    session: transplantedSession,
    rows
  }), null, "a fully sealed packet cannot be transplanted onto another asset's originals");
  const apiRecord = {
    asset_id: "asset-verified-original",
    recognition_session_id: rows.output.recognition_session_id,
    resolution_id: rows.resolution.id,
    output_id: rows.output.id,
    output_title: rows.output.title,
    resolver_version: rows.resolution.resolver_version,
    composer_version: rows.output.composer_version,
    marketplace_profile_version: rows.output.marketplace_profile_version,
    verified_original_observation_support: durablePublicReceipt,
    replay_rows: rows
  };
  const publicView = await handleResolutionViewRequest({
    tenantId: "tenant-verified-original",
    assetId: "asset-verified-original",
    dependencies: { readRecord: async () => apiRecord }
  });
  assert.deepEqual(publicView.verified_original_observation_support, durablePublicReceipt,
    "API attaches the validated zero-provider public readback receipt");
  assert.doesNotMatch(JSON.stringify(publicView.verified_original_observation_support),
    /original_set_sha256|observed_fields|field_decisions|50\/50/);
  await assert.rejects(() => handleResolutionViewRequest({
    tenantId: "tenant-verified-original",
    assetId: "asset-verified-original",
    dependencies: {
      readRecord: async () => ({
        ...apiRecord,
        verified_original_observation_support: {
          ...durablePublicReceipt,
          top_level_evil: "x"
        }
      })
    }
  }), (error) => error?.statusCode === 409,
  "API fails closed when a stored overlay signal lacks an exact public receipt");

  const readFromPacket = async ({ packet = rows, sessionSnapshot = durableSession } = {}) => {
    const sessionRow = {
      id: packet.output.recognition_session_id,
      asset_id: "asset-verified-original",
      csm_owner_versions: null,
      identity_snapshot: sessionSnapshot.identity_snapshot,
      ...packet.session_hashes
    };
    const fetchImpl = async (rawUrl) => {
      const { pathname } = new URL(rawUrl);
      if (pathname.endsWith("/v4_recognition_sessions")) return new Response(
        JSON.stringify([sessionRow]), { status: 200 }
      );
      if (pathname.endsWith("/csm_marketplace_outputs")) return new Response(
        JSON.stringify([packet.output]), { status: 200 }
      );
      if (pathname.endsWith("/csm_identity_resolutions")) return new Response(
        JSON.stringify([packet.resolution]), { status: 200 }
      );
      if (pathname.endsWith("/csm_resolved_brackets")) return new Response(
        JSON.stringify(packet.resolved), { status: 200 }
      );
      if (pathname.endsWith("/csm_evidence_observations")) return new Response(
        JSON.stringify(packet.evidence), { status: 200 }
      );
      if (pathname.endsWith("/csm_bracket_candidates")) return new Response(
        JSON.stringify(packet.candidates), { status: 200 }
      );
      if (pathname.endsWith("/csm_candidate_evidence_links")) return new Response(
        JSON.stringify(packet.links), { status: 200 }
      );
      return new Response("[]", { status: 404 });
    };
    return readCsmResolutionRecord({
      tenantId: "tenant-verified-original",
      assetId: "asset-verified-original",
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role"
      },
      fetchImpl
    });
  };
  const durableRecord = await readFromPacket({ sessionSnapshot: withDerived });
  assert.deepEqual(durableRecord.verified_original_observation_support, durablePublicReceipt,
    "Supabase read chain validates full sealed rows before returning the public receipt");
  assert.equal(validateVerifiedOriginalObservationReplayPacket(durableRecord.replay_rows), true);

  const missingReadback = structuredClone(rows);
  missingReadback.evidence = missingReadback.evidence.filter(
    (row) => row.id !== supportEvidence[0].id
  );
  missingReadback.links = missingReadback.links.filter(
    (row) => row.evidence_observation_id !== supportEvidence[0].id
  );
  resealRows(missingReadback);
  await assert.rejects(() => readFromPacket({ packet: missingReadback }),
    /csm_verified_original_observation_readback_invalid/,
  "Supabase readback rejects a re-sealed packet missing aggregate review evidence");

  const duplicateReadback = structuredClone(rows);
  duplicateReadback.evidence.push({
    ...structuredClone(supportEvidence[0]),
    id: `${supportEvidence[0].id}-dup`
  });
  resealRows(duplicateReadback);
  await assert.rejects(() => readFromPacket({ packet: duplicateReadback }),
    /csm_verified_original_observation_readback_invalid/,
  "Supabase readback rejects re-sealed duplicate review evidence");

  const receiptTamperReadback = structuredClone(rows);
  receiptTamperReadback.output.structured_output
    .verified_original_observation_support.top_level_evil = "x";
  resealRows(receiptTamperReadback);
  await assert.rejects(() => readFromPacket({ packet: receiptTamperReadback }),
    /csm_verified_original_observation_readback_invalid/,
  "Supabase readback rejects an unknown receipt field after full packet reseal");
  await assert.rejects(() => readFromPacket({ sessionSnapshot: transplantedSession }),
    /csm_verified_original_observation_readback_invalid/,
  "Supabase readback rejects a sealed packet transplanted across original assets");
  await assert.rejects(() => readFromPacket({ sessionSnapshot: derivedSubstitution }),
    /csm_verified_original_observation_readback_invalid/,
  "Supabase readback rejects a derived-image substitution");
  assert.equal(supportEvidence.length, 1,
    "one immutable projection evidence row commits the whole reviewed ledger");
  assert.equal(supportEvidence[0].source_ref.field_count,
    VERIFIED_ORIGINAL_OBSERVATION_PACK.closed_world_fields.length - 4,
    "aggregate evidence commits to every bracket-backed closed field");
  assert.ok(supportEvidence.every((row) => !Object.hasOwn(row.source_ref, "provenance")),
    "immutable ledger provenance is not repeated in every evidence row");
  const reviewedCandidates = rows.candidates.filter((row) => (
    row.source_trust === "REVIEWED_CLOSED_PROJECTION_EXACT"
  ));
  const projectionLinks = rows.links.filter((row) => (
    row.evidence_observation_id === supportEvidence[0].id
  ));
  assert.equal(projectionLinks.length, reviewedCandidates.length,
    "every reviewed bracket candidate has exactly one aggregate-evidence link");
  const corroboratedSubject = reviewedCandidates.find((row) => row.bracket === "subject");
  assert.equal(rows.links.filter((row) => row.candidate_id === corroboratedSubject.id).length, 2,
    "CORROBORATE retains visual support and adds the aggregate review support");
  assert.ok(reviewedCandidates.filter((row) => row.value_kind === "EMPTY")
    .every((row) => row.candidate_confidence === 1),
  "authoritative empty is a certain reviewed assertion, not unsupported absence");
  assert.ok(rows.resolved.filter((row) => row.selected_kind === "EMPTY")
    .every((row) => row.semantic_confidence === 1),
  "resolved authoritative empties retain certainty");

  const baselineRows = buildCsmStageRows({
    tenantId: "tenant-verified-original",
    recognitionSessionId: "session-verified-original-baseline",
    fields: applied.fields,
    observedFields: observed,
    externalIdentitySupport: { status: "ABSTAINED" },
    composed: composeHistoricalStandard(applied.fields),
    title: composeHistoricalStandard(applied.fields).title,
    contractVersion: "csm-stage-shadow-v2"
  });
  const supportedBytes = Buffer.byteLength(JSON.stringify(rows));
  const baselineBytes = Buffer.byteLength(JSON.stringify(baselineRows));
  assert.ok(supportedBytes <= baselineBytes * 2,
    `closed projection packet ${supportedBytes} bytes must stay <=2x baseline ${baselineBytes}`);

  const serialEvidence = supportEvidence[0];
  assert.ok(serialEvidence);

  const missing = structuredClone(rows);
  missing.evidence = missing.evidence.filter((row) => row.id !== serialEvidence.id);
  missing.links = missing.links.filter((row) => row.evidence_observation_id !== serialEvidence.id);
  resealRows(missing);
  assert.equal(validateVerifiedOriginalObservationReplayPacket(missing), false,
    "missing reviewed field fails after full packet reseal");

  const duplicate = structuredClone(rows);
  const duplicateEvidence = { ...structuredClone(serialEvidence), id: `${serialEvidence.id}-dup` };
  duplicate.evidence.push(duplicateEvidence);
  const originalLink = duplicate.links.find((row) => (
    row.evidence_observation_id === serialEvidence.id
  ));
  duplicate.links.push({ ...structuredClone(originalLink), evidence_observation_id: duplicateEvidence.id });
  resealRows(duplicate);
  assert.equal(validateVerifiedOriginalObservationReplayPacket(duplicate), false,
    "duplicate reviewed field fails after full packet reseal");

  const extra = structuredClone(rows);
  const extraEvidence = {
    ...structuredClone(serialEvidence),
    id: `${serialEvidence.id}-extra`,
    bracket: "future_title_bracket",
    source_ref: {
      ...structuredClone(serialEvidence.source_ref),
      bracket: "future_title_bracket"
    }
  };
  extra.evidence.push(extraEvidence);
  extra.links.push({ ...structuredClone(originalLink), evidence_observation_id: extraEvidence.id });
  resealRows(extra);
  assert.equal(validateVerifiedOriginalObservationReplayPacket(extra), false,
    "extra unknown reviewed field fails after full packet reseal");

  const sourceTamper = structuredClone(rows);
  sourceTamper.evidence.find((row) => row.id === serialEvidence.id)
    .source_ref.field_fact_set_sha256 = "0".repeat(64);
  resealRows(sourceTamper);
  assert.equal(validateVerifiedOriginalObservationReplayPacket(sourceTamper), false,
    "re-sealed source authority mismatch fails closed");

  const reviewedCandidate = rows.candidates.find((row) => (
    row.source_trust === "REVIEWED_CLOSED_PROJECTION_EXACT"
      && row.bracket === "numerical_rarity"
  ));
  const missingCandidate = structuredClone(rows);
  missingCandidate.candidates = missingCandidate.candidates.filter(
    (row) => row.id !== reviewedCandidate.id
  );
  missingCandidate.links = missingCandidate.links.filter(
    (row) => row.candidate_id !== reviewedCandidate.id
  );
  resealRows(missingCandidate);
  assert.equal(validateVerifiedOriginalObservationReplayPacket(missingCandidate), false,
    "missing reviewed candidate fails after full packet reseal");

  const poisonObserved = { ...structuredClone(observed), product: "POISON PRODUCT" };
  const poisonReceipt = resolveVerifiedOriginalObservation(poisonObserved, {
    originalImageSha256: correctionSample.entry.images.map(({ sha256 }) => sha256)
  }).receipt;
  const receiptReseal = structuredClone(rows);
  receiptReseal.output.structured_output.verified_original_observation_support = poisonReceipt;
  resealRows(receiptReseal);
  assert.equal(validateVerifiedOriginalObservationReplayPacket(receiptReseal), false,
    "valid reissued receipt cannot be substituted over different raw visual rows");
}

const first = fixture.cases[0].images.map(({ sha256 }) => sha256);
const dormantSelection = postObservationResolutionContractForVerifiedOriginals({
  activeReleaseId: null,
  originalImageSha256: first
});
assert.equal(dormantSelection.mode, "EXTERNAL_IDENTITY_ONLY",
  "bridge writer stays dormant even for an indexed exact original set");
const activeSelection = postObservationResolutionContractForVerifiedOriginals({
  activeReleaseId: "verified_original_closed_projection_subset_a_v2",
  originalImageSha256: [...first].reverse()
});
assert.equal(activeSelection.mode, "EXTERNAL_AND_VERIFIED_ORIGINAL_CLOSED_PROJECTION");
assert.equal(activeSelection.resolution_contract_sha256,
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256);
assert.equal(validatePostObservationResolutionContractSelection(activeSelection, {
  activeReleaseId: "verified_original_closed_projection_subset_a_v2",
  originalImageSha256: first
}), true, "pre-provider contract selection is exact-set and order independent");
assert.equal(validatePostObservationResolutionContractSelection({
  ...activeSelection,
  matched_original_set_sha256: "0".repeat(64)
}, {
  activeReleaseId: "verified_original_closed_projection_subset_a_v2",
  originalImageSha256: first
}), false, "operation/checkpoint selection drift fails closed");
assert.throws(() => postObservationResolutionContractForVerifiedOriginals({
  activeReleaseId: "unknown",
  originalImageSha256: first
}), /verified_original_observation_active_release_unknown/);
assert.equal(findVerifiedOriginalObservationRecord({ originalImageSha256: [first[0]] }), null);
assert.equal(findVerifiedOriginalObservationRecord({ originalImageSha256: [...first, first[0]] }), null);
assert.equal(findVerifiedOriginalObservationRecord({ originalImageSha256: [first[0], first[0]] }), null);
assert.equal(findVerifiedOriginalObservationRecord({
  originalImageSha256: [`0${first[0].slice(1)}`, first[1]]
}), null, "one changed component hash does not match");
assert.equal(findVerifiedOriginalObservationRecord({
  originalImageSha256: [first[0].slice(0, -1), first[1]]
}), null, "a truncated component hash does not match");
assert.equal(resolveVerifiedOriginalObservation({}, {
  originalImageSha256: ["f".repeat(64), "e".repeat(64)]
}), null, "unknown exact set leaves baseline untouched");

const unknownReceipt = {
  ...correctionSample.applied.receipt,
  release_id: "unknown"
};
assert.equal(verifiedOriginalObservationReleaseForReceipt(unknownReceipt), null);
assert.deepEqual(
  Object.keys(VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases),
  [
    "verified_original_closed_projection_subset_a_v1",
    "verified_original_closed_projection_subset_a_v2"
  ],
  "only explicitly shipped historical and active releases can replay"
);

console.log(
  `verified original closed projection: ok (max packet ratio ${
    maxPacketSizeRatio.ratio.toFixed(3)
  }x at ${maxPacketSizeRatio.id})`
);
