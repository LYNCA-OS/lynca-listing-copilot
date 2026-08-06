#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  analyzeBoundedEvidenceV2Gate as analyzeGate,
  expectedRequestSha256,
  loadCohortSelection
} from "./analyze-bounded-evidence-v2-gate.mjs";

const EVIDENCE_ARM = "thin_canonical_bounded_evidence_v2_high";
const LIVE_ARM = "thin_canonical_high";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalBody = (ids) => `${JSON.stringify(ids, null, 2)}\n`;
const sourceHashes = Object.fromEntries([
  "harness", "thin_listing_path", "canonical_fields", "bounded_evidence_v2", "canonical_composer"
].map((name, index) => [name, String(index + 1).repeat(64)]));
const cohortRoles = {
  screen50: "development_screen",
  audited100: "audited_development",
  development150: "development_population",
  mechanism6: "mechanism_probe_known_wins",
  confirmatory50: "confirmatory_validation"
};

function sealCheckpoint(manifest, rows) {
  const body = `${rows.map(JSON.stringify).join("\n")}\n`;
  manifest.checkpoint_rows = rows.length;
  manifest.checkpoint_sha256 = sha256(body);
}

function analyzeBoundedEvidenceV2Gate(input) {
  sealCheckpoint(input.evidenceManifest, input.evidenceRows);
  if (input.liveControlManifest && input.liveControlRows?.length) {
    sealCheckpoint(input.liveControlManifest, input.liveControlRows);
  }
  return analyzeGate(input);
}

const storedCohortManifest = new URL(
  "../artifacts/bounded-evidence-v2/cohorts/cohort-manifest.json",
  import.meta.url
).pathname;
assert.equal((await loadCohortSelection(storedCohortManifest, "screen50")).assetIds.length, 50);
assert.equal((await loadCohortSelection(storedCohortManifest, "mechanism6")).assetIds.length, 6);
assert.equal((await loadCohortSelection(storedCohortManifest, "confirmatory50")).assetIds.length, 50);

function cohortFixture(name, ids) {
  const files = {
    screen50: "screen-50.asset-ids.json",
    audited100: "audited-100.asset-ids.json",
    development150: "development-150.asset-ids.json",
    mechanism6: "product-mechanism-6.asset-ids.json",
    confirmatory50: "confirmatory-50.asset-ids.json"
  };
  const body = canonicalBody(ids);
  return {
    cohortManifest: {
      schema_version: "bounded-evidence-v2-cohort-manifest-v2",
      cohorts: {
        [name]: {
          file: files[name],
          count: ids.length,
          asset_ids_sha256: sha256(body),
          selection_role: cohortRoles[name]
        }
      }
    },
    cohortName: name,
    cohortAssetIds: ids,
    cohortAssetIdsSha256: sha256(body)
  };
}

function runManifest(arm, ids, { selectionRole = "development_screen", ...overrides } = {}) {
  const evidence = arm === EVIDENCE_ARM;
  const requestTemplates = ["0".repeat(64),
    expectedRequestSha256({ arm, imageCount: 1 }),
    expectedRequestSha256({ arm, imageCount: 2 })];
  const finisherContract = {
    schema_version: "thin-path-eval-finisher-contract-v1",
    derivation_contract: "thin-path-eval-derived-metrics-v1",
    arms: [arm],
    source_sha256: sourceHashes
  };
  const contract = {
    schema_version: "thin-path-eval-run-contract-v2",
    model: "gpt-5.6-luna",
    effort: "none",
    image_detail: "high",
    execution: {
      concurrency: 120,
      request_timeout_ms: 120000,
      max_attempts: 3,
      retry_policy: "retry-policy-v1"
    },
    cohort: { selection_role: selectionRole },
    arms: [{
      key: arm,
      fixed_image_detail: "high",
      eval_version: evidence ? "bounded-evidence-v2" : null,
      response_schema_name: evidence ? "canonical_card_fields_bounded_evidence_v2" : "canonical_card_fields",
      response_schema_sha256: "a".repeat(64),
      prompt_sha256: "b".repeat(64),
      request_template_sha256: requestTemplates
    }],
    dataset_sha256: "c".repeat(64),
    asset_ids_sha256: sha256(canonicalBody(ids)),
    sealed_labels_sha256: "d".repeat(64),
    source_sha256: {
      provider_request_behavior: sha256(JSON.stringify([requestTemplates]))
    },
    ...overrides.contract
  };
  return {
    schema_version: "thin-path-eval-run-manifest-v2",
    fingerprint: sha256(JSON.stringify(contract)),
    contract,
    finisher: {
      fingerprint: sha256(JSON.stringify(finisherContract)),
      contract: finisherContract
    },
    max_requested_limit: ids.length,
    max_requested_asset_ids_sha256: sha256(JSON.stringify(ids)),
    ...overrides.manifest
  };
}

function evidenceRow({ id, manifest, serial = null, title = null, reference = null,
  spans = null, promotions = null, fields = null } = {}) {
  const control = "2024 Topps Alpha Player";
  const finalTitle = title ?? (serial ? `${control} ${serial}` : control);
  const finalReference = reference ?? finalTitle;
  const evidenceSpans = spans ?? (serial ? [{
    exact_text: serial,
    source: "printed_text",
    uncertainty: "none",
    disposition: "current_copy_renderer_evidence"
  }] : []);
  const evidencePromotions = promotions ?? (serial ? [{
    exact_text: serial,
    target: "current_copy_renderer",
    canonical_field_written: null,
    reason: "sem_serial_evidence_renderer_only"
  }] : []);
  return {
    arm: EVIDENCE_ARM,
    asset_id: id,
    reference: finalReference,
    canonical_control_title: control,
    canonical_control_length: control.length,
    title: finalTitle,
    length: finalTitle.length,
    fields: fields ?? { year: "2024", product: "Topps Alpha", serial: "" },
    raw_title: JSON.stringify({ year: "2024", product: "Topps Alpha", subject: "Player" }),
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    latency_ms: 900,
    evidence_spans: evidenceSpans,
    evidence_promotions: evidencePromotions,
    evidence_schema_version: "bounded-evidence-v2",
    arm_eval_version: "bounded-evidence-v2",
    production_promoted: false,
    model: "gpt-5.6-luna",
    requested_effort: "none",
    served_effort: "none",
    image_detail: "high",
    image_count: 2,
    image_set_sha256: sha256(`images:${id}`),
    request_sha256: expectedRequestSha256({ arm: EVIDENCE_ARM, imageCount: 2 }),
    run_fingerprint: manifest.fingerprint,
    finisher_fingerprint: manifest.finisher.fingerprint
  };
}

function liveRow(row, manifest) {
  return {
    arm: LIVE_ARM,
    asset_id: row.asset_id,
    reference: row.reference,
    title: row.canonical_control_title,
    length: row.canonical_control_title.length,
    fields: row.fields,
    raw_title: row.raw_title,
    model: "gpt-5.6-luna",
    requested_effort: "none",
    served_effort: "none",
    image_detail: "high",
    image_count: row.image_count,
    image_set_sha256: row.image_set_sha256,
    request_sha256: expectedRequestSha256({ arm: LIVE_ARM, imageCount: row.image_count }),
    run_fingerprint: manifest.fingerprint,
    finisher_fingerprint: manifest.finisher.fingerprint
  };
}

const promotionLabelsFor = (rows, verdict = "true") => rows.flatMap((row) =>
  row.evidence_promotions.filter(({ blocked }) => !blocked).map(({ exact_text, target }) => ({
    asset_id: row.asset_id, exact_text, target, verdict
  })));
const labelTokens = (value) => new Set(String(value).toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const helpfulLabelsFor = (rows, verdict = "true") => rows.flatMap((row) => {
  const reference = labelTokens(row.reference);
  const control = labelTokens(row.canonical_control_title);
  return row.evidence_spans.filter(({ exact_text }) => [...labelTokens(exact_text)]
    .some((token) => reference.has(token) && !control.has(token))).map(({ exact_text }) => ({
    asset_id: row.asset_id, exact_text, verdict
  }));
});

function inputFixture(name = "screen50", ids = ["a", "b"]) {
  const evidenceManifest = runManifest(EVIDENCE_ARM, ids, { selectionRole: cohortRoles[name] });
  const evidenceRows = [
    evidenceRow({ id: ids[0], manifest: evidenceManifest, serial: "027/150" }),
    ...ids.slice(1).map((id) => evidenceRow({ id, manifest: evidenceManifest }))
  ];
  return {
    ...cohortFixture(name, ids),
    evidenceManifest,
    evidenceRows,
    promotionLabels: promotionLabelsFor(evidenceRows),
    helpfulEvidenceLabels: helpfulLabelsFor(evidenceRows)
  };
}

const development = inputFixture();
const developmentReport = analyzeBoundedEvidenceV2Gate(development);
assert.equal(developmentReport.gates.stage_a.decision, "DEVELOPMENT_SCREEN_PASS");
assert.equal(developmentReport.validated_contract.selection_role, "development_screen");
assert.equal(developmentReport.same_response.wins, 1);
assert.equal(developmentReport.evidence.manually_confirmed_helpful_occurrences, 1);
assert.equal(developmentReport.token_latency_cost.estimated_cost, null,
  "missing prices must never be described as zero cost");

const resolverMiss = structuredClone(development);
resolverMiss.evidenceRows[0].title = resolverMiss.evidenceRows[0].canonical_control_title;
resolverMiss.evidenceRows[0].length = resolverMiss.evidenceRows[0].title.length;
const resolverReport = analyzeBoundedEvidenceV2Gate(resolverMiss);
assert.equal(resolverReport.gates.stage_a.decision, "RESOLVER_WORK_REQUIRED",
  "confirmed novel evidence plus no resolver gain must only authorize offline resolver work");

assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...development, promotionLabels: []
}), /promotion_labels_missing/);
assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...development, helpfulEvidenceLabels: []
}), /helpful_evidence_labels_missing/);
assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...development,
  promotionLabels: [...development.promotionLabels, development.promotionLabels[0]]
}), /promotion_labels_duplicate/);
assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...development,
  promotionLabels: [{ ...development.promotionLabels[0], verdict: "yes" }]
}), /promotion_labels_verdict_invalid/);
assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...development,
  helpfulEvidenceLabels: [{ ...development.helpfulEvidenceLabels[0], target: "product" }]
}), /helpful_evidence_labels_must_not_contain_target/);

const falsePromotion = analyzeBoundedEvidenceV2Gate({
  ...development,
  promotionLabels: development.promotionLabels.map((label) => ({ ...label, verdict: "false" }))
});
assert.equal(falsePromotion.gates.stage_a.decision, "STOP");

const fingerprintAttack = structuredClone(development);
fingerprintAttack.evidenceRows[0].run_fingerprint = "f".repeat(64);
assert.throws(() => analyzeBoundedEvidenceV2Gate(fingerprintAttack), /row_fingerprint_mismatch/);

const legacyManifest = structuredClone(development);
legacyManifest.evidenceManifest.schema_version = "thin-path-eval-run-manifest-v1";
assert.throws(() => analyzeBoundedEvidenceV2Gate(legacyManifest), /evidence_manifest_schema_invalid/);

const roleAttack = structuredClone(development);
roleAttack.evidenceManifest.contract.cohort.selection_role = "confirmatory_validation";
roleAttack.evidenceManifest.fingerprint = sha256(JSON.stringify(roleAttack.evidenceManifest.contract));
roleAttack.evidenceRows.forEach((row) => { row.run_fingerprint = roleAttack.evidenceManifest.fingerprint; });
assert.throws(() => analyzeBoundedEvidenceV2Gate(roleAttack), /selection_role_invalid/);

const finisherAttack = structuredClone(development);
finisherAttack.evidenceRows[0].finisher_fingerprint = "f".repeat(64);
assert.throws(() => analyzeBoundedEvidenceV2Gate(finisherAttack), /row_finisher_fingerprint_mismatch/);

const checkpointAttack = structuredClone(development);
sealCheckpoint(checkpointAttack.evidenceManifest, checkpointAttack.evidenceRows);
checkpointAttack.evidenceManifest.checkpoint_sha256 = "f".repeat(64);
assert.throws(() => analyzeGate(checkpointAttack), /checkpoint_hash_mismatch/);

const armAttack = structuredClone(development);
armAttack.evidenceManifest.contract.arms.push(structuredClone(armAttack.evidenceManifest.contract.arms[0]));
armAttack.evidenceManifest.fingerprint = sha256(JSON.stringify(armAttack.evidenceManifest.contract));
armAttack.evidenceRows.forEach((row) => { row.run_fingerprint = armAttack.evidenceManifest.fingerprint; });
assert.throws(() => analyzeBoundedEvidenceV2Gate(armAttack), /not_single_arm/);

const requestAttack = structuredClone(development);
requestAttack.evidenceRows[0].request_sha256 = "e".repeat(64);
assert.throws(() => analyzeBoundedEvidenceV2Gate(requestAttack), /request_shape_mismatch/);

const assetAttack = structuredClone(development);
assetAttack.evidenceRows[1].asset_id = "wrong";
assert.throws(() => analyzeBoundedEvidenceV2Gate(assetAttack), /asset_set_mismatch/);

const referenceShapeAttack = structuredClone(development);
referenceShapeAttack.evidenceRows[0].reference = " 2024 Topps Alpha Player 027/150";
assert.throws(() => analyzeBoundedEvidenceV2Gate(referenceShapeAttack), /reference_invalid/);

const replayWithoutReceipt = structuredClone(development);
replayWithoutReceipt.evidenceRows.forEach((row) => { row.replay_fingerprint = "a".repeat(64); });
assert.throws(() => analyzeBoundedEvidenceV2Gate(replayWithoutReceipt), /replay_receipt_required/);

// Product is not globally forbidden: a source-anchored, suffix-only token
// extension may exist in the evaluation overlay, but still needs a true manual
// verdict and can never write a production/canonical field.
const product = inputFixture("screen50", ["product", "tie"]);
const productRow = product.evidenceRows[0];
productRow.reference = "2024 Topps Alpha Chrome Player";
productRow.title = "2024 Topps Alpha Chrome Player";
productRow.length = productRow.title.length;
productRow.evidence_spans = [{
  exact_text: "Topps Alpha Chrome", source: "printed_text", uncertainty: "none",
  advisory_role: "product_name", disposition: "append_only_evidence"
}];
productRow.evidence_promotions = [{
  exact_text: "Topps Alpha Chrome", target: "product",
  canonical_field_written: "evaluation_overlay_only", reason: "strict_product_token_extension"
}];
product.promotionLabels = promotionLabelsFor(product.evidenceRows);
product.helpfulEvidenceLabels = helpfulLabelsFor(product.evidenceRows);
const legalProduct = analyzeBoundedEvidenceV2Gate(product);
assert.equal(legalProduct.gates.stage_a.decision, "DEVELOPMENT_SCREEN_PASS");

const visualProduct = structuredClone(product);
visualProduct.evidenceRows[0].evidence_spans[0].source = "visual_property";
const visualProductReport = analyzeBoundedEvidenceV2Gate(visualProduct);
assert.equal(visualProductReport.gates.stage_a.decision, "STOP");
assert.equal(visualProductReport.evidence.illegal_promotions[0].legality_error, "not_source_anchored");

const emptyBaseProduct = structuredClone(product);
emptyBaseProduct.evidenceRows[0].fields.product = "";
emptyBaseProduct.evidenceRows[0].reference = "2024 Upper Deck MJx Player";
emptyBaseProduct.evidenceRows[0].title = "2024 Upper Deck MJx Player";
emptyBaseProduct.evidenceRows[0].length = emptyBaseProduct.evidenceRows[0].title.length;
emptyBaseProduct.evidenceRows[0].evidence_spans[0].exact_text = "Upper Deck MJx";
emptyBaseProduct.evidenceRows[0].evidence_promotions[0].exact_text = "Upper Deck MJx";
emptyBaseProduct.promotionLabels = promotionLabelsFor(emptyBaseProduct.evidenceRows);
emptyBaseProduct.helpfulEvidenceLabels = helpfulLabelsFor(emptyBaseProduct.evidenceRows);
assert.equal(analyzeBoundedEvidenceV2Gate(emptyBaseProduct).gates.stage_a.decision, "STOP",
  "empty canonical product needs a stronger attributable audit");
emptyBaseProduct.promotionLabels[0].empty_base_product_tokens_verified = true;
emptyBaseProduct.promotionLabels[0].reviewer = "reviewer-1";
assert.equal(analyzeBoundedEvidenceV2Gate(emptyBaseProduct).gates.stage_a.decision,
  "DEVELOPMENT_SCREEN_PASS");

const repeatedTokenProduct = structuredClone(product);
repeatedTokenProduct.evidenceRows[0].fields.product = "Topps Chrome Topps";
repeatedTokenProduct.evidenceRows[0].reference = "2024 Topps Chrome X Topps Player";
repeatedTokenProduct.evidenceRows[0].title = "2024 Topps Chrome X Topps Player";
repeatedTokenProduct.evidenceRows[0].length = repeatedTokenProduct.evidenceRows[0].title.length;
repeatedTokenProduct.evidenceRows[0].evidence_spans[0].exact_text = "Topps Chrome X Topps";
repeatedTokenProduct.evidenceRows[0].evidence_promotions[0].exact_text = "Topps Chrome X Topps";
repeatedTokenProduct.promotionLabels = promotionLabelsFor(repeatedTokenProduct.evidenceRows);
repeatedTokenProduct.helpfulEvidenceLabels = helpfulLabelsFor(repeatedTokenProduct.evidenceRows);
assert.equal(analyzeBoundedEvidenceV2Gate(repeatedTokenProduct).gates.stage_a.decision, "STOP",
  "contiguous product extension must preserve repeated token order rather than Set-deduping it");

const yearPromotion = structuredClone(product);
yearPromotion.evidenceRows[0].evidence_promotions[0].target = "year";
yearPromotion.promotionLabels = promotionLabelsFor(yearPromotion.evidenceRows);
assert.equal(analyzeBoundedEvidenceV2Gate(yearPromotion).gates.stage_a.decision, "STOP");

const confirmatory = inputFixture("confirmatory50", ["c", "d"]);
const liveManifest = runManifest(LIVE_ARM, confirmatory.cohortAssetIds, {
  selectionRole: "confirmatory_validation"
});
const liveControlRows = confirmatory.evidenceRows.map((row) => liveRow(row, liveManifest));
const stageB = analyzeBoundedEvidenceV2Gate({
  ...confirmatory, liveControlManifest: liveManifest, liveControlRows
});
assert.equal(stageB.gates.stage_a.decision, "ADVANCE_TO_STAGE_B_LIVE_CONTROL");
assert.equal(stageB.gates.stage_b.decision, "CONFIRMATORY_PASS_FINAL_VALIDATION_REQUIRED");

const imageMismatch = structuredClone(liveControlRows);
imageMismatch[0].image_set_sha256 = "9".repeat(64);
assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...confirmatory, liveControlManifest: liveManifest, liveControlRows: imageMismatch
}), /image_set_mismatch/);

const referenceMismatch = structuredClone(liveControlRows);
referenceMismatch[0].reference += " changed";
assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...confirmatory, liveControlManifest: liveManifest, liveControlRows: referenceMismatch
}), /reference_mismatch/);

assert.throws(() => analyzeBoundedEvidenceV2Gate({
  ...development, liveControlManifest: runManifest(LIVE_ARM, development.cohortAssetIds),
  liveControlRows: development.evidenceRows.map((row) => liveRow(
    row, runManifest(LIVE_ARM, development.cohortAssetIds)
  ))
}), /live_control_only_allowed_for_mechanism6_or_confirmatory50/);

const stageC = inputFixture("audited100", ["stage-c-a", "stage-c-b"]);
assert.equal(analyzeBoundedEvidenceV2Gate(stageC).gates.stage_a.decision,
  "DEVELOPMENT_EXTENSION_PASS", "Stage C must itself be exact-cohort and fully labelled before merge");

const mechanismIds = [
  "reviewed_blind_8945fde9c65cb1b9f3a8",
  "reviewed_blind_7059d3b39d01402f0e61",
  "reviewed_blind_7c93444e09007eaec82f",
  "reviewed_blind_7815e1aeda1f8e00dd4e",
  "reviewed_blind_a4051a222e9be2cf8149",
  "reviewed_blind_a8a73b44f77bf6e823e2"
];
const mechanism = inputFixture("mechanism6", mechanismIds);
const knownProductExtensions = [
  ["Metal", "Leaf Metal Draft"],
  ["Topps Chrome", "Topps Chrome VeeFriends"],
  ["", "Upper Deck MJx"],
  ["Topps Chrome", "Topps Chrome VeeFriends"],
  ["Chrome Black", "Topps Star Wars Chrome Black"],
  ["Chrome", "Topps Chrome UFC"]
];
for (const [index, row] of mechanism.evidenceRows.entries()) {
  const [baseProduct, exactProduct] = knownProductExtensions[index];
  const canonicalDirect = index < 4;
  row.fields.product = canonicalDirect ? exactProduct : baseProduct;
  row.reference = `2024 ${exactProduct} Player`;
  row.title = row.canonical_control_title;
  row.length = row.title.length;
  row.evidence_spans = canonicalDirect ? [] : [{
    exact_text: exactProduct, source: index === 4 ? "slab_label_text" : "printed_text",
    uncertainty: "none", advisory_role: "product_name", disposition: "append_only_evidence"
  }];
  row.evidence_promotions = [];
}
mechanism.promotionLabels = [];
mechanism.helpfulEvidenceLabels = helpfulLabelsFor(mechanism.evidenceRows);
const mechanismReport = analyzeBoundedEvidenceV2Gate(mechanism);
assert.equal(mechanismReport.gates.stage_a.decision, "MECHANISM_CANONICAL_CONTROL_REQUIRED");
assert.equal(mechanismReport.gates.stage_a.mechanism_canonical_product_rows, 4);
assert.equal(mechanismReport.gates.stage_a.mechanism_evidence_span_rows, 2);
assert.equal(mechanismReport.gates.stage_a.mechanism_channels[0].channel, "canonical_only",
  "complete target tokens in bounded canonical product are a valid direct-capture channel");
assert.equal(mechanismReport.gates.stage_a.resolver_positive_net_gain, false,
  "mechanism F1 may be reported but must not define its decision");

const mechanismMiss = structuredClone(mechanism);
mechanismMiss.evidenceRows[5].evidence_spans = [];
mechanismMiss.helpfulEvidenceLabels = helpfulLabelsFor(mechanismMiss.evidenceRows);
assert.equal(analyzeBoundedEvidenceV2Gate(mechanismMiss).gates.stage_a.decision, "STOP");

const evidenceMechanism = structuredClone(mechanism);
for (const index of [0, 1, 2, 3]) {
  const [baseProduct, exactProduct] = knownProductExtensions[index];
  if (index >= 2) evidenceMechanism.evidenceRows[index].fields.product = baseProduct;
  evidenceMechanism.evidenceRows[index].evidence_spans = [{
    exact_text: exactProduct, source: "printed_text", uncertainty: "none",
    advisory_role: "product_name", disposition: "append_only_evidence"
  }];
}
evidenceMechanism.helpfulEvidenceLabels = helpfulLabelsFor(evidenceMechanism.evidenceRows);
assert.equal(analyzeBoundedEvidenceV2Gate(evidenceMechanism).gates.stage_a.decision,
  "MECHANISM_EVIDENCE_CONFIRMED");

const mechanismLiveManifest = runManifest(LIVE_ARM, mechanismIds, {
  selectionRole: "mechanism_probe_known_wins"
});
const mechanismLiveRows = mechanism.evidenceRows.map((row) => liveRow(row, mechanismLiveManifest));
const measuredMechanism = analyzeBoundedEvidenceV2Gate({
  ...mechanism,
  liveControlManifest: mechanismLiveManifest,
  liveControlRows: mechanismLiveRows
});
assert.equal(measuredMechanism.gates.stage_b.decision, "MECHANISM_CANONICAL_CONTROL_COMPLETE");
assert.equal(measuredMechanism.gates.stage_b.live_canonical_target_rows, 4);

console.log("bounded evidence v2 gate hardening tests passed");
