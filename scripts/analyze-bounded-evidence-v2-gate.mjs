#!/usr/bin/env node

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import {
  BOUNDED_EVIDENCE_V2_SCHEMA_NAME,
  BOUNDED_EVIDENCE_V2_VERSION,
  buildBoundedEvidenceV2Request
} from "../lib/listing/thin/bounded-evidence-v2.mjs";
import { buildCanonicalFieldsRequest } from "../lib/listing/thin/canonical-fields.mjs";
import {
  currentReplaySourceHashes,
  validateReplayArtifacts
} from "./replay-bounded-evidence-v2-checkpoint.mjs";

const EVIDENCE_ARM = "thin_canonical_bounded_evidence_v2_high";
const LIVE_CONTROL_ARM = "thin_canonical_high";
const REQUIRED_MODEL = "gpt-5.6-luna";
const REQUIRED_EFFORT = "none";
const REQUIRED_DETAIL = "high";
const VERDICTS = new Set(["true", "false", "critical_wrong"]);
const HEX_256 = /^[0-9a-f]{64}$/;
const COHORT_SPECS = Object.freeze({
  // The old "holdout" has been used for resolver/product development. The
  // analyzer deliberately renames it at its boundary so it cannot be cited as
  // confirmatory evidence.
  screen50: Object.freeze({ entry: "screen50", file: "screen-50.asset-ids.json", role: "development_screen" }),
  audited100: Object.freeze({ entry: "audited100", file: "audited-100.asset-ids.json", role: "audited_development" }),
  development150: Object.freeze({ entry: "development150", file: "development-150.asset-ids.json", role: "development_population" }),
  mechanism6: Object.freeze({ entry: "mechanism6", file: "product-mechanism-6.asset-ids.json", role: "mechanism_probe_known_wins" }),
  confirmatory50: Object.freeze({ entry: "confirmatory50", file: "confirmatory-50.asset-ids.json", role: "confirmatory_validation" })
});
const MECHANISM_TARGET_TOKENS = Object.freeze({
  reviewed_blind_8945fde9c65cb1b9f3a8: Object.freeze(["draft"]),
  reviewed_blind_7059d3b39d01402f0e61: Object.freeze(["veefriends"]),
  reviewed_blind_7c93444e09007eaec82f: Object.freeze(["mjx"]),
  reviewed_blind_7815e1aeda1f8e00dd4e: Object.freeze(["veefriends"]),
  reviewed_blind_a4051a222e9be2cf8149: Object.freeze(["star", "wars"]),
  reviewed_blind_a8a73b44f77bf6e823e2: Object.freeze(["ufc"])
});

const valueFor = (argv, name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizedTokens = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const tokenise = (value) => new Set(normalizedTokens(value));
const orderedTokens = (value) => normalizedTokens(value);
const score = (reference, candidate) => {
  const wanted = tokenise(reference);
  const got = tokenise(candidate);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
const fieldText = (value) => Array.isArray(value) ? value.join(" ") : String(value ?? "");
const sameSet = (left, right) => left.length === right.length
  && left.every((value) => new Set(right).has(value));

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function rowsFrom(body, name = "jsonl") {
  return String(body).split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      invariant(row && typeof row === "object" && !Array.isArray(row), `${name}_row_not_object:${index + 1}`);
      return [row];
    } catch (error) {
      if (String(error?.message || "").startsWith(`${name}_`)) throw error;
      throw new Error(`${name}_invalid_json:${index + 1}`);
    }
  });
}

function pairedStats(pairs, leftTitle, rightTitle) {
  const rows = pairs.map((pair) => {
    const left = score(pair.reference, leftTitle(pair));
    const right = score(pair.reference, rightTitle(pair));
    return { asset_id: pair.asset_id, left, right, delta_f1: right.f1 - left.f1 };
  });
  return {
    n: rows.length,
    left_f1: mean(rows.map(({ left }) => left.f1)),
    right_f1: mean(rows.map(({ right }) => right.f1)),
    delta_f1: mean(rows.map(({ delta_f1 }) => delta_f1)),
    wins: rows.filter(({ delta_f1 }) => delta_f1 > 1e-12).length,
    losses: rows.filter(({ delta_f1 }) => delta_f1 < -1e-12).length,
    ties: rows.filter(({ delta_f1 }) => Math.abs(delta_f1) <= 1e-12).length,
    rows
  };
}

function requestFingerprint(request) {
  let imageIndex = 0;
  const normalized = JSON.parse(JSON.stringify(request, (key, value) => {
    if (key === "image_url" && typeof value === "string") {
      imageIndex += 1;
      return `signed-image-${imageIndex}`;
    }
    return value;
  }));
  return sha256(JSON.stringify(normalized));
}

export function expectedRequestSha256({ arm, imageCount, model = REQUIRED_MODEL,
  effort = REQUIRED_EFFORT, imageDetail = REQUIRED_DETAIL }) {
  invariant(Number.isInteger(imageCount) && imageCount >= 1 && imageCount <= 2,
    "request_image_count_invalid");
  const imageUrls = Array.from({ length: imageCount }, (_, index) => `https://signed.invalid/${index + 1}`);
  const context = { imageUrls, model, effort, imageDetail };
  if (arm === EVIDENCE_ARM) return requestFingerprint(buildBoundedEvidenceV2Request(context));
  if (arm === LIVE_CONTROL_ARM) return requestFingerprint(buildCanonicalFieldsRequest(context));
  throw new Error(`unsupported_gate_arm:${arm}`);
}

function promotionKey(value) {
  return `${value.asset_id}\u0000${value.exact_text}\u0000${value.target}`;
}
function helpfulKey(value) {
  return `${value.asset_id}\u0000${value.exact_text}`;
}

function validateLabelSet(labels, expected, keyFor, name, { targetRequired = false } = {}) {
  invariant(Array.isArray(labels), `${name}_not_array`);
  const expectedKeys = new Set(expected.map(keyFor));
  invariant(expectedKeys.size === expected.length, `${name}_expected_keys_ambiguous`);
  const seen = new Set();
  const map = new Map();
  for (const [index, label] of labels.entries()) {
    invariant(label && typeof label === "object" && !Array.isArray(label), `${name}_row_not_object:${index + 1}`);
    invariant(typeof label.asset_id === "string" && label.asset_id.length > 0,
      `${name}_asset_id_invalid:${index + 1}`);
    invariant(typeof label.exact_text === "string" && label.exact_text.length > 0,
      `${name}_exact_text_invalid:${index + 1}`);
    invariant(!targetRequired || (typeof label.target === "string" && label.target.length > 0),
      `${name}_target_invalid:${index + 1}`);
    invariant(targetRequired || label.target === undefined, `${name}_must_not_contain_target:${index + 1}`);
    invariant(typeof label.verdict === "string" && VERDICTS.has(label.verdict),
      `${name}_verdict_invalid:${index + 1}`);
    const key = keyFor(label);
    invariant(!seen.has(key), `${name}_duplicate:${index + 1}`);
    invariant(expectedKeys.has(key), `${name}_extra:${index + 1}`);
    seen.add(key);
    map.set(key, label);
  }
  const missing = [...expectedKeys].filter((key) => !seen.has(key));
  invariant(missing.length === 0, `${name}_missing:${missing.length}`);
  return map;
}

function validateHash(value, code) {
  invariant(typeof value === "string" && HEX_256.test(value), code);
}

function validateRunManifest(manifest, {
  arm, assetIdsSha256, assetIds, selectionRole, expectedCount, checkpointSha256, name
}) {
  invariant(manifest?.schema_version === "thin-path-eval-run-manifest-v2", `${name}_schema_invalid`);
  invariant(manifest?.contract?.schema_version === "thin-path-eval-run-contract-v2", `${name}_contract_schema_invalid`);
  validateHash(manifest.fingerprint, `${name}_fingerprint_invalid`);
  invariant(manifest.fingerprint === sha256(JSON.stringify(manifest.contract)), `${name}_fingerprint_not_contract_hash`);
  const contract = manifest.contract;
  invariant(contract.model === REQUIRED_MODEL, `${name}_model_invalid`);
  invariant(contract.effort === REQUIRED_EFFORT, `${name}_effort_invalid`);
  invariant(contract.image_detail === REQUIRED_DETAIL, `${name}_detail_invalid`);
  invariant(contract.cohort?.selection_role === selectionRole, `${name}_selection_role_invalid`);
  invariant(Number.isInteger(contract.execution?.concurrency) && contract.execution.concurrency >= 1,
    `${name}_concurrency_invalid`);
  invariant(Number.isInteger(contract.execution?.request_timeout_ms)
      && contract.execution.request_timeout_ms >= 10_000, `${name}_timeout_invalid`);
  invariant(Number.isInteger(contract.execution?.max_attempts) && contract.execution.max_attempts >= 1,
    `${name}_max_attempts_invalid`);
  invariant(typeof contract.execution?.retry_policy === "string" && contract.execution.retry_policy.length > 0,
    `${name}_retry_policy_invalid`);
  invariant(Array.isArray(contract.arms) && contract.arms.length === 1, `${name}_not_single_arm`);
  const armContract = contract.arms[0];
  invariant(armContract.key === arm, `${name}_arm_invalid`);
  invariant(armContract.fixed_image_detail === REQUIRED_DETAIL, `${name}_arm_detail_invalid`);
  if (arm === EVIDENCE_ARM) {
    invariant(armContract.eval_version === BOUNDED_EVIDENCE_V2_VERSION, `${name}_eval_version_invalid`);
    invariant(armContract.response_schema_name === BOUNDED_EVIDENCE_V2_SCHEMA_NAME,
      `${name}_response_schema_name_invalid`);
  } else {
    invariant(armContract.eval_version === null, `${name}_unexpected_eval_version`);
    invariant(armContract.response_schema_name === "canonical_card_fields", `${name}_response_schema_name_invalid`);
  }
  validateHash(armContract.response_schema_sha256, `${name}_response_schema_hash_invalid`);
  validateHash(armContract.prompt_sha256, `${name}_prompt_hash_invalid`);
  invariant(Array.isArray(armContract.request_template_sha256)
      && armContract.request_template_sha256.length === 3,
  `${name}_request_templates_invalid`);
  armContract.request_template_sha256.forEach((hash, index) => validateHash(
    hash, `${name}_request_template_hash_invalid:${index}`
  ));
  for (const imageCount of [1, 2]) {
    invariant(armContract.request_template_sha256[imageCount]
      === expectedRequestSha256({ arm, imageCount }), `${name}_request_template_mismatch:${imageCount}`);
  }
  validateHash(contract.dataset_sha256, `${name}_dataset_hash_invalid`);
  validateHash(contract.sealed_labels_sha256, `${name}_labels_hash_invalid`);
  validateHash(contract.asset_ids_sha256, `${name}_asset_ids_hash_invalid`);
  invariant(contract.asset_ids_sha256 === assetIdsSha256, `${name}_asset_ids_hash_mismatch`);
  invariant(manifest.max_requested_limit === expectedCount, `${name}_limit_mismatch`);
  invariant(manifest.max_requested_asset_ids_sha256 === sha256(JSON.stringify(assetIds)),
    `${name}_selected_asset_ids_hash_mismatch`);
  validateHash(manifest.checkpoint_sha256, `${name}_checkpoint_hash_invalid`);
  invariant(manifest.checkpoint_sha256 === checkpointSha256, `${name}_checkpoint_hash_mismatch`);
  invariant(manifest.checkpoint_rows === expectedCount, `${name}_checkpoint_rows_mismatch`);
  const providerBehavior = contract.source_sha256?.provider_request_behavior;
  validateHash(providerBehavior, `${name}_provider_behavior_hash_invalid`);
  invariant(providerBehavior === sha256(JSON.stringify(contract.arms.map(
    ({ request_template_sha256 }) => request_template_sha256
  ))), `${name}_provider_behavior_hash_mismatch`);
  invariant(manifest.finisher?.contract?.schema_version === "thin-path-eval-finisher-contract-v1",
    `${name}_finisher_contract_schema_invalid`);
  invariant(manifest.finisher.contract.derivation_contract === "thin-path-eval-derived-metrics-v1",
    `${name}_finisher_derivation_contract_invalid`);
  invariant(JSON.stringify(manifest.finisher.contract.arms) === JSON.stringify([arm]),
    `${name}_finisher_arms_invalid`);
  validateHash(manifest.finisher.fingerprint, `${name}_finisher_fingerprint_invalid`);
  invariant(manifest.finisher.fingerprint === sha256(JSON.stringify(manifest.finisher.contract)),
    `${name}_finisher_fingerprint_mismatch`);
  const finisherSources = manifest.finisher.contract.source_sha256;
  invariant(finisherSources && typeof finisherSources === "object" && !Array.isArray(finisherSources)
      && Object.keys(finisherSources).length > 0, `${name}_finisher_sources_invalid`);
  Object.entries(finisherSources).forEach(([source, hash]) => validateHash(
    hash, `${name}_finisher_source_hash_invalid:${source}`
  ));
  return contract;
}

function validateCohortSelection({ cohortManifest, cohortName, cohortAssetIds, cohortAssetIdsSha256 }) {
  invariant(cohortManifest?.schema_version === "bounded-evidence-v2-cohort-manifest-v2",
    "cohort_manifest_schema_invalid");
  invariant(Object.hasOwn(COHORT_SPECS, cohortName), `cohort_name_invalid:${cohortName}`);
  const spec = COHORT_SPECS[cohortName];
  const entry = cohortManifest?.cohorts?.[spec.entry];
  invariant(entry && typeof entry === "object", `cohort_missing:${cohortName}`);
  invariant(entry.file === spec.file, `cohort_file_name_invalid:${cohortName}`);
  invariant(entry.selection_role === spec.role, `${cohortName}_cohort_role_invalid`);
  invariant(Array.isArray(cohortAssetIds), "cohort_asset_ids_not_array");
  invariant(cohortAssetIds.every((id) => typeof id === "string" && id.trim() === id && id.length > 0),
    "cohort_asset_id_invalid");
  invariant(new Set(cohortAssetIds).size === cohortAssetIds.length, "cohort_asset_ids_duplicate");
  invariant(entry.count === cohortAssetIds.length, "cohort_count_mismatch");
  validateHash(entry.asset_ids_sha256, "cohort_asset_ids_manifest_hash_invalid");
  invariant(entry.asset_ids_sha256 === cohortAssetIdsSha256, "cohort_asset_ids_file_hash_mismatch");
  return { entry, spec };
}

function validateRowShape(row, { arm, manifest, name }) {
  invariant(typeof row.asset_id === "string" && row.asset_id.length > 0, `${name}_asset_id_invalid`);
  invariant(row.arm === arm, `${name}_row_arm_invalid:${row.asset_id}`);
  invariant(row.run_fingerprint === manifest.fingerprint, `${name}_row_fingerprint_mismatch:${row.asset_id}`);
  invariant(row.finisher_fingerprint === manifest.finisher.fingerprint,
    `${name}_row_finisher_fingerprint_mismatch:${row.asset_id}`);
  invariant(row.model === REQUIRED_MODEL, `${name}_row_model_invalid:${row.asset_id}`);
  invariant(row.requested_effort === REQUIRED_EFFORT && row.served_effort === REQUIRED_EFFORT,
    `${name}_row_effort_invalid:${row.asset_id}`);
  invariant(row.image_detail === REQUIRED_DETAIL, `${name}_row_detail_invalid:${row.asset_id}`);
  invariant(typeof row.reference === "string" && row.reference.trim() === row.reference && row.reference.length > 0,
    `${name}_row_reference_invalid:${row.asset_id}`);
  invariant(typeof row.title === "string" && row.title.length > 0, `${name}_row_title_invalid:${row.asset_id}`);
  invariant(Number.isInteger(row.length) && row.length === row.title.length, `${name}_row_length_invalid:${row.asset_id}`);
  invariant(row.fields && typeof row.fields === "object" && !Array.isArray(row.fields),
    `${name}_row_fields_invalid:${row.asset_id}`);
  invariant((typeof row.raw_title === "string" && row.raw_title.trim().length > 0)
      || (row.raw_title && typeof row.raw_title === "object" && !Array.isArray(row.raw_title)),
    `${name}_row_raw_response_invalid:${row.asset_id}`);
  invariant(Number.isInteger(row.image_count) && row.image_count >= 1 && row.image_count <= 2,
    `${name}_row_image_count_invalid:${row.asset_id}`);
  validateHash(row.image_set_sha256, `${name}_row_image_set_hash_invalid:${row.asset_id}`);
  validateHash(row.request_sha256, `${name}_row_request_hash_invalid:${row.asset_id}`);
  const expectedRequest = expectedRequestSha256({ arm, imageCount: row.image_count });
  invariant(row.request_sha256 === expectedRequest, `${name}_row_request_shape_mismatch:${row.asset_id}`);
  if (arm === EVIDENCE_ARM) {
    invariant(row.arm_eval_version === BOUNDED_EVIDENCE_V2_VERSION,
      `${name}_row_eval_version_invalid:${row.asset_id}`);
    invariant(row.evidence_schema_version === BOUNDED_EVIDENCE_V2_VERSION,
      `${name}_row_evidence_schema_invalid:${row.asset_id}`);
    invariant(row.production_promoted === false, `${name}_row_production_promotion_invalid:${row.asset_id}`);
    invariant(typeof row.canonical_control_title === "string" && row.canonical_control_title.length > 0,
      `${name}_row_control_title_invalid:${row.asset_id}`);
    invariant(Number.isInteger(row.canonical_control_length)
      && row.canonical_control_length === row.canonical_control_title.length,
    `${name}_row_control_length_invalid:${row.asset_id}`);
    invariant(Array.isArray(row.evidence_spans), `${name}_row_evidence_spans_invalid:${row.asset_id}`);
    invariant(Array.isArray(row.evidence_promotions), `${name}_row_evidence_promotions_invalid:${row.asset_id}`);
  }
}

function validateRows(rows, { arm, manifest, cohortAssetIds, name }) {
  invariant(Array.isArray(rows), `${name}_rows_not_array`);
  for (const row of rows) validateRowShape(row, { arm, manifest, name });
  const ids = rows.map(({ asset_id }) => asset_id);
  invariant(new Set(ids).size === ids.length, `${name}_duplicate_asset_ids`);
  invariant(sameSet(ids, cohortAssetIds), `${name}_asset_set_mismatch`);
  const byId = new Map(rows.map((row) => [row.asset_id, row]));
  return cohortAssetIds.map((id) => byId.get(id));
}

function validateLivePairing(evidenceRows, liveRows, evidenceContract, liveContract,
  evidenceManifest, liveManifest) {
  for (const field of ["model", "effort", "image_detail", "dataset_sha256", "asset_ids_sha256", "sealed_labels_sha256"]) {
    invariant(evidenceContract[field] === liveContract[field], `live_control_contract_mismatch:${field}`);
  }
  const evidenceSources = evidenceManifest.finisher.contract.source_sha256;
  const liveSources = liveManifest.finisher.contract.source_sha256;
  const commonSources = Object.keys(evidenceSources).filter((source) => Object.hasOwn(liveSources, source));
  invariant(commonSources.length > 0, "live_control_no_common_finisher_sources");
  for (const source of commonSources) {
    invariant(evidenceSources[source] === liveSources[source], `live_control_finisher_source_mismatch:${source}`);
  }
  const live = new Map(liveRows.map((row) => [row.asset_id, row]));
  for (const row of evidenceRows) {
    const control = live.get(row.asset_id);
    invariant(control.reference === row.reference, `live_control_reference_mismatch:${row.asset_id}`);
    invariant(control.image_set_sha256 === row.image_set_sha256, `live_control_image_set_mismatch:${row.asset_id}`);
    invariant(control.image_count === row.image_count, `live_control_image_count_mismatch:${row.asset_id}`);
  }
}

function matchingEvidence(row, promotion) {
  return (row.evidence_spans || []).filter((span) => span.exact_text === promotion.exact_text);
}

function strictProductExtensionSpan(row, span) {
  if (!["printed_text", "stamped_text", "slab_label_text"].includes(span.source)
      || span.uncertainty !== "none"
      || !/(^|[_\s-])(product|set|brand)([_\s-]|$)/i.test(String(span.advisory_role || ""))) return false;
  const base = orderedTokens(row.fields?.product);
  const extension = orderedTokens(span.exact_text);
  if (base.length === 0) return extension.filter((token) => /[a-z]/i.test(token)).length >= 2;
  if (extension.length <= base.length) return false;
  return extension.some((_, start) => base.every((token, offset) => extension[start + offset] === token));
}

function anchoredProductLike(span) {
  return ["printed_text", "stamped_text", "slab_label_text"].includes(span?.source)
    && span?.uncertainty === "none"
    && /(^|[_\s-])(product|set|brand)([_\s-]|$)/i.test(String(span?.advisory_role || ""));
}

function containsTargetTokens(value, targets) {
  const tokens = tokenise(value);
  return targets.every((target) => tokens.has(target));
}

function mechanismChannel(row) {
  const targetTokens = MECHANISM_TARGET_TOKENS[row.asset_id];
  invariant(targetTokens, `mechanism_target_missing:${row.asset_id}`);
  const canonical = containsTargetTokens(row.fields?.product, targetTokens);
  const evidence = row.evidence_spans.some((span) => anchoredProductLike(span)
    && containsTargetTokens(span.exact_text, targetTokens));
  if (canonical && evidence) return "both";
  if (canonical) return "canonical_only";
  if (evidence) return "evidence_only";
  return "missing";
}

function strictProductExtension(row, promotion, spans) {
  return promotion.canonical_field_written === "evaluation_overlay_only"
    && row.production_promoted === false
    && spans.some((span) => strictProductExtensionSpan(row, span));
}

function promotionLegality(row, promotion) {
  const spans = matchingEvidence(row, promotion);
  if (!spans.length) return "missing_exact_evidence";
  if (!spans.some((span) => span.source !== "visual_property" && span.uncertainty === "none")) {
    return "not_source_anchored";
  }
  if (promotion.target === "year") return "year_promotion_forbidden";
  if (promotion.target === "print_finish") return "print_finish_promotion_forbidden";
  if (promotion.target === "product") {
    return strictProductExtension(row, promotion, spans) ? null : "product_extension_not_strict";
  }
  if (promotion.target === "current_copy_renderer") {
    return promotion.canonical_field_written === null ? null : "renderer_wrote_canonical_field";
  }
  if (["descriptive_rarity", "observable_components"].includes(promotion.target)) {
    return promotion.canonical_field_written === "evaluation_overlay_only" ? null : "overlay_boundary_missing";
  }
  return "promotion_target_not_allowed";
}

export function analyzeBoundedEvidenceV2Gate({
  evidenceRows,
  evidenceManifest,
  cohortManifest,
  cohortName,
  cohortAssetIds,
  cohortAssetIdsSha256 = sha256(`${JSON.stringify(cohortAssetIds, null, 2)}\n`),
  liveControlRows = [],
  liveControlManifest = null,
  promotionLabels,
  helpfulEvidenceLabels,
  evidenceReplayValidated = false,
  evidenceParentCheckpointSha256 = null,
  liveControlCheckpointSha256 = null,
  inputPricePerMillion = null,
  outputPricePerMillion = null,
  expectedEvidenceCards = null,
  schemaNoninferiorityMargin = 0.005
} = {}) {
  validateCohortSelection({ cohortManifest, cohortName, cohortAssetIds, cohortAssetIdsSha256 });
  const expectedCount = cohortAssetIds.length;
  invariant(expectedEvidenceCards === null || Number(expectedEvidenceCards) === expectedCount,
    "expected_cards_must_match_named_cohort");
  const evidenceContract = validateRunManifest(evidenceManifest, {
    arm: EVIDENCE_ARM,
    assetIdsSha256: cohortAssetIdsSha256,
    assetIds: cohortAssetIds,
    selectionRole: COHORT_SPECS[cohortName].role,
    expectedCount,
    checkpointSha256: evidenceParentCheckpointSha256
      ?? sha256(`${evidenceRows.map(JSON.stringify).join("\n")}\n`),
    name: "evidence_manifest"
  });
  const replayRows = evidenceRows.filter((row) => row.replay_fingerprint !== undefined
    || row.parent_run_fingerprint !== undefined || row.provider_row_sha256 !== undefined);
  invariant(replayRows.length === 0 || replayRows.length === evidenceRows.length,
    "evidence_replay_rows_mixed_with_provider_rows");
  invariant(replayRows.length === 0 || evidenceReplayValidated, "evidence_replay_receipt_required");
  invariant(replayRows.length > 0 || !evidenceReplayValidated, "evidence_replay_validation_without_replay_rows");
  const pairs = validateRows(evidenceRows, {
    arm: EVIDENCE_ARM, manifest: evidenceManifest, cohortAssetIds, name: "evidence"
  });

  let liveRows = [];
  if (liveControlRows.length || liveControlManifest) {
    invariant(["mechanism6", "confirmatory50"].includes(cohortName),
      "live_control_only_allowed_for_mechanism6_or_confirmatory50");
    invariant(liveControlRows.length > 0 && liveControlManifest, "live_control_rows_and_manifest_required_together");
    const liveContract = validateRunManifest(liveControlManifest, {
      arm: LIVE_CONTROL_ARM,
      assetIdsSha256: cohortAssetIdsSha256,
      assetIds: cohortAssetIds,
      selectionRole: COHORT_SPECS[cohortName].role,
      expectedCount,
      checkpointSha256: liveControlCheckpointSha256
        ?? sha256(`${liveControlRows.map(JSON.stringify).join("\n")}\n`),
      name: "live_control_manifest"
    });
    liveRows = validateRows(liveControlRows, {
      arm: LIVE_CONTROL_ARM, manifest: liveControlManifest, cohortAssetIds, name: "live_control"
    });
    validateLivePairing(
      pairs, liveRows, evidenceContract, liveContract, evidenceManifest, liveControlManifest
    );
  }

  const sameResponse = pairedStats(pairs, (row) => row.canonical_control_title, (row) => row.title);
  const promotionDecisions = pairs.flatMap((row) => (row.evidence_promotions || []).map((promotion) => ({
    asset_id: row.asset_id,
    ...promotion
  })));
  const promotions = promotionDecisions.filter(({ blocked }) => !blocked);
  const blockedPromotions = promotionDecisions.filter(({ blocked }) => Boolean(blocked));
  const byId = new Map(pairs.map((row) => [row.asset_id, row]));
  const illegalPromotions = promotions.flatMap((promotion) => {
    const reason = promotionLegality(byId.get(promotion.asset_id), promotion);
    return reason ? [{ ...promotion, legality_error: reason }] : [];
  });

  const helpfulEvidence = pairs.flatMap((row) => {
    const reference = tokenise(row.reference);
    const control = tokenise(row.canonical_control_title);
    return (row.evidence_spans || []).flatMap((span) => {
      const helpful = [...tokenise(span.exact_text)].filter((token) => reference.has(token) && !control.has(token));
      return helpful.length ? [{ asset_id: row.asset_id, exact_text: span.exact_text, helpful_tokens: helpful }] : [];
    });
  });

  const promotionLabelMap = validateLabelSet(
    promotionLabels, promotions, promotionKey, "promotion_labels", { targetRequired: true }
  );
  const helpfulLabelMap = validateLabelSet(
    helpfulEvidenceLabels, helpfulEvidence, helpfulKey, "helpful_evidence_labels"
  );
  const falsePromotions = promotions
    .filter((promotion) => promotionLabelMap.get(promotionKey(promotion)).verdict === "false");
  const criticalFalsePromotions = promotions
    .filter((promotion) => promotionLabelMap.get(promotionKey(promotion)).verdict === "critical_wrong");
  const emptyBaseProductAuditFailures = promotions.filter((promotion) => {
    const row = byId.get(promotion.asset_id);
    if (promotion.target !== "product" || orderedTokens(row.fields?.product).length > 0) return false;
    const label = promotionLabelMap.get(promotionKey(promotion));
    return label?.empty_base_product_tokens_verified !== true
      || typeof label?.reviewer !== "string" || !label.reviewer.trim();
  });
  const confirmedHelpful = helpfulEvidence
    .filter((item) => helpfulLabelMap.get(helpfulKey(item)).verdict === "true");
  const rejectedHelpful = helpfulEvidence
    .filter((item) => helpfulLabelMap.get(helpfulKey(item)).verdict !== "true");
  const over80 = pairs.filter((row) => Number(row.length) > 80);
  let mechanismChannels = [];
  if (cohortName === "mechanism6") {
    invariant(sameSet(cohortAssetIds, Object.keys(MECHANISM_TARGET_TOKENS)),
      "mechanism_cohort_targets_mismatch");
    mechanismChannels = pairs.map((row) => ({
      asset_id: row.asset_id,
      target_tokens: MECHANISM_TARGET_TOKENS[row.asset_id],
      channel: mechanismChannel(row)
    }));
  }
  const mechanismCanonicalRows = mechanismChannels
    .filter(({ channel }) => ["canonical_only", "both"].includes(channel));
  const mechanismEvidenceRows = mechanismChannels
    .filter(({ channel }) => ["evidence_only", "both"].includes(channel));
  const mechanismCanonicalOnlyRows = mechanismChannels.filter(({ channel }) => channel === "canonical_only");

  const validPriceInputs = inputPricePerMillion !== null && outputPricePerMillion !== null
    && Number.isFinite(Number(inputPricePerMillion)) && Number(inputPricePerMillion) >= 0
    && Number.isFinite(Number(outputPricePerMillion)) && Number(outputPricePerMillion) >= 0;
  const tokenLatencyCost = {
    input_tokens_total: pairs.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0),
    output_tokens_total: pairs.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0),
    total_tokens: pairs.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0),
    median_latency_ms: median(pairs.map((row) => Number(row.latency_ms || 0))),
    estimated_cost: validPriceInputs
      ? pairs.reduce((sum, row) => sum
          + Number(row.input_tokens || 0) * Number(inputPricePerMillion) / 1_000_000
          + Number(row.output_tokens || 0) * Number(outputPricePerMillion) / 1_000_000, 0)
      : null,
    cost_note: validPriceInputs
      ? "caller_supplied_prices"
      : "token_usage_only; pass explicit current nonnegative prices to estimate currency cost"
  };

  let schemaInterference = null;
  if (liveRows.length) {
    const live = new Map(liveRows.map((row) => [row.asset_id, row]));
    const livePairs = pairs.map((row) => ({ ...row, live: live.get(row.asset_id) }));
    const paired = pairedStats(livePairs, (row) => row.live.title, (row) => row.canonical_control_title);
    const endToEnd = pairedStats(livePairs, (row) => row.live.title, (row) => row.title);
    const fields = [...new Set(livePairs.flatMap((row) => [
      ...Object.keys(row.fields || {}), ...Object.keys(row.live.fields || {})
    ]))].sort();
    const perField = Object.fromEntries(fields.map((field) => {
      const changed = livePairs.filter((row) => JSON.stringify(row.fields?.[field] ?? null)
        !== JSON.stringify(row.live.fields?.[field] ?? null));
      const referenceRegressions = changed.filter((row) => {
        const reference = tokenise(row.reference);
        const before = [...tokenise(fieldText(row.live.fields?.[field]))].filter((token) => reference.has(token)).length;
        const after = [...tokenise(fieldText(row.fields?.[field]))].filter((token) => reference.has(token)).length;
        return after < before;
      });
      return [field, { changed: changed.length, reference_support_regressions: referenceRegressions.length }];
    }));
    schemaInterference = {
      ...paired,
      diagnostic_only: true,
      preregistered_noninferiority_margin: -Math.abs(schemaNoninferiorityMargin),
      end_to_end: endToEnd,
      per_field: perField,
      critical_year_product_regressions: ["year", "product"]
        .reduce((sum, field) => sum + Number(perField[field]?.reference_support_regressions || 0), 0)
    };
  }

  const resolverPositive = sameResponse.delta_f1 > 0 && sameResponse.wins > sameResponse.losses;
  const promotionSafe = illegalPromotions.length === 0
    && falsePromotions.length === 0 && criticalFalsePromotions.length === 0
    && emptyBaseProductAuditFailures.length === 0;
  const stageA = {
    cohort: cohortName,
    expected_cards: expectedCount,
    complete: pairs.length === expectedCount,
    resolver_positive_net_gain: resolverPositive,
    confirmed_reference_novel_evidence: confirmedHelpful.length,
    promotion_legal: promotionSafe,
    illegal_promotions: illegalPromotions.length,
    false_promotions: falsePromotions.length,
    critical_false_promotions: criticalFalsePromotions.length,
    empty_base_product_audit_failures: emptyBaseProductAuditFailures.length,
    mechanism_channels: mechanismChannels,
    mechanism_canonical_product_rows: mechanismCanonicalRows.length,
    mechanism_evidence_span_rows: mechanismEvidenceRows.length,
    mechanism_canonical_only_rows: mechanismCanonicalOnlyRows.length,
    no_over_80: over80.length === 0
  };
  if (!stageA.complete || !stageA.promotion_legal || !stageA.no_over_80) {
    stageA.decision = "STOP";
  } else if (cohortName === "mechanism6") {
    if (mechanismChannels.some(({ channel }) => channel === "missing")) {
      stageA.decision = "STOP";
    } else if (mechanismCanonicalOnlyRows.length > 0) {
      stageA.decision = "MECHANISM_CANONICAL_CONTROL_REQUIRED";
    } else {
      stageA.decision = "MECHANISM_EVIDENCE_CONFIRMED";
    }
  } else if (!stageA.resolver_positive_net_gain) {
    stageA.decision = confirmedHelpful.length > 0 ? "RESOLVER_WORK_REQUIRED" : "STOP";
  } else if (cohortName === "confirmatory50") {
    stageA.decision = "ADVANCE_TO_STAGE_B_LIVE_CONTROL";
  } else if (cohortName === "screen50") {
    stageA.decision = "DEVELOPMENT_SCREEN_PASS";
  } else if (cohortName === "audited100") {
    stageA.decision = "DEVELOPMENT_EXTENSION_PASS";
  } else {
    stageA.decision = "DEVELOPMENT_POPULATION_PASS";
  }

  const mechanismLiveTargetRows = cohortName === "mechanism6" && liveRows.length
    ? liveRows.filter((row) => containsTargetTokens(
      row.fields?.product, MECHANISM_TARGET_TOKENS[row.asset_id]
    )).length
    : null;
  const stageB = cohortName === "mechanism6" && schemaInterference ? {
    complete: schemaInterference.n === expectedCount,
    bounded_canonical_target_rows: mechanismCanonicalRows.length,
    live_canonical_target_rows: mechanismLiveTargetRows,
    decision: stageA.decision === "MECHANISM_CANONICAL_CONTROL_REQUIRED"
      ? "MECHANISM_CANONICAL_CONTROL_COMPLETE"
      : "STOP"
  } : schemaInterference ? {
    complete: schemaInterference.n === expectedCount,
    positive_end_to_end_f1: schemaInterference.end_to_end.delta_f1 > 0
      && schemaInterference.end_to_end.wins > schemaInterference.end_to_end.losses,
    schema_cost_within_margin_or_recovered: schemaInterference.delta_f1 >= -Math.abs(schemaNoninferiorityMargin)
      || Math.abs(Math.min(0, schemaInterference.delta_f1)) < sameResponse.delta_f1,
    no_critical_year_product_regression: schemaInterference.critical_year_product_regressions === 0,
    promotion_legal: promotionSafe,
    decision: stageA.decision === "ADVANCE_TO_STAGE_B_LIVE_CONTROL"
      && schemaInterference.n === expectedCount
      && schemaInterference.end_to_end.delta_f1 > 0
      && schemaInterference.end_to_end.wins > schemaInterference.end_to_end.losses
      && (schemaInterference.delta_f1 >= -Math.abs(schemaNoninferiorityMargin)
        || Math.abs(Math.min(0, schemaInterference.delta_f1)) < sameResponse.delta_f1)
      && schemaInterference.critical_year_product_regressions === 0
      && promotionSafe
      ? "CONFIRMATORY_PASS_FINAL_VALIDATION_REQUIRED"
      : "STOP"
  } : { complete: false, decision: "NOT_RUN" };

  return {
    schema_version: "bounded-evidence-v2-gate-v2",
    validated_contract: {
      cohort: cohortName,
      selection_role: COHORT_SPECS[cohortName].role,
      evidence_run_fingerprint: evidenceManifest.fingerprint,
      live_control_run_fingerprint: liveControlManifest?.fingerprint ?? null,
      model: REQUIRED_MODEL,
      effort: REQUIRED_EFFORT,
      image_detail: REQUIRED_DETAIL,
      asset_ids_sha256: cohortAssetIdsSha256
    },
    population: { evidence_rows: pairs.length, unique_cards: pairs.length, duplicates: 0 },
    same_response: sameResponse,
    evidence: {
      spans: pairs.reduce((sum, row) => sum + row.evidence_spans.length, 0),
      helpful_occurrences: helpfulEvidence.length,
      manually_confirmed_helpful_occurrences: confirmedHelpful.length,
      helpful_rows: helpfulEvidence,
      rejected_helpful_rows: rejectedHelpful,
      promotions: promotions.length,
      blocked_promotions: blockedPromotions,
      illegal_promotions: illegalPromotions,
      false_promotions: falsePromotions,
      critical_false_promotions: criticalFalsePromotions,
      empty_base_product_audit_failures: emptyBaseProductAuditFailures
    },
    title_safety: { over_80_cards: over80.map(({ asset_id, length }) => ({ asset_id, length })) },
    token_latency_cost: tokenLatencyCost,
    schema_interference: schemaInterference,
    gates: { stage_a: stageA, stage_b: stageB }
  };
}

export async function loadCohortSelection(cohortManifestPath, cohortName) {
  const body = await readFile(cohortManifestPath, "utf8");
  const manifest = JSON.parse(body);
  invariant(manifest?.schema_version === "bounded-evidence-v2-cohort-manifest-v2",
    "cohort_manifest_schema_invalid");
  invariant(manifest?.relationship?.canonical_v3 === 150
      && manifest?.relationship?.audited_overlap === 100
      && manifest?.relationship?.development_screen === 50
      && manifest?.relationship?.outside_canonical_v3 === 105
      && manifest?.relationship?.confirmatory_validation === 50
      && manifest?.relationship?.confirmatory_reserve === 55
      && manifest?.relationship?.product_mechanism_probe === 6,
  "cohort_manifest_relationship_invalid");
  for (const source of ["canonical_v3", "high100", "reviewed_dataset_255"]) {
    validateHash(manifest?.source_sha256?.[source], `cohort_manifest_source_hash_invalid:${source}`);
  }
  const base = dirname(cohortManifestPath);
  const loaded = {};
  for (const [name, spec] of Object.entries(COHORT_SPECS)) {
    const entry = manifest?.cohorts?.[spec.entry];
    invariant(entry?.file === spec.file, `cohort_file_name_invalid:${name}`);
    invariant(entry?.selection_role === spec.role, `${name}_cohort_role_invalid`);
    const assetIdsBody = await readFile(resolve(base, spec.file), "utf8");
    const assetIds = JSON.parse(assetIdsBody);
    validateCohortSelection({
      cohortManifest: manifest,
      cohortName: name,
      cohortAssetIds: assetIds,
      cohortAssetIdsSha256: sha256(assetIdsBody)
    });
    loaded[name] = { assetIdsBody, assetIds };
  }
  const reserveEntry = manifest?.cohorts?.reserve55;
  invariant(reserveEntry?.file === "confirmatory-reserve-55.asset-ids.json"
      && reserveEntry?.selection_role === "confirmatory_reserve"
      && reserveEntry?.count === 55, "confirmatory_reserve_contract_invalid");
  const reserveBody = await readFile(resolve(base, reserveEntry.file), "utf8");
  const reserveIds = JSON.parse(reserveBody);
  invariant(Array.isArray(reserveIds) && reserveIds.length === 55
      && new Set(reserveIds).size === 55
      && reserveIds.every((id) => typeof id === "string" && id.trim() === id && id.length > 0),
  "confirmatory_reserve_asset_ids_invalid");
  invariant(sha256(reserveBody) === reserveEntry.asset_ids_sha256,
    "confirmatory_reserve_asset_ids_hash_mismatch");
  invariant(loaded.screen50.assetIds.length === 50 && loaded.audited100.assetIds.length === 100
      && loaded.development150.assetIds.length === 150 && loaded.mechanism6.assetIds.length === 6
      && loaded.confirmatory50.assetIds.length === 50,
  "cohort_manifest_population_invalid");
  const union = [...loaded.screen50.assetIds, ...loaded.audited100.assetIds];
  invariant(new Set(union).size === 150 && sameSet(union, loaded.development150.assetIds),
    "cohort_manifest_union_invalid");
  const developmentSet = new Set(loaded.development150.assetIds);
  invariant(loaded.mechanism6.assetIds.every((id) => developmentSet.has(id)),
    "mechanism_cohort_must_be_development_subset");
  invariant(loaded.confirmatory50.assetIds.every((id) => !developmentSet.has(id)),
    "confirmatory_cohort_not_disjoint_from_development150");
  invariant(reserveIds.every((id) => !developmentSet.has(id)),
    "confirmatory_reserve_not_disjoint_from_development150");
  invariant(new Set([...loaded.confirmatory50.assetIds, ...reserveIds]).size === 105,
    "confirmatory_and_reserve_overlap");
  invariant(loaded.confirmatory50.assetIds.length + reserveIds.length
      === manifest.relationship.outside_canonical_v3, "confirmatory_partition_invalid");
  invariant(loaded.confirmatory50.assetIds.every((id) => typeof id === "string"),
    "confirmatory_asset_ids_invalid");
  invariant(manifest.cohorts.confirmatory50.selection_salt
      && manifest.cohorts.confirmatory50.selection_salt === reserveEntry.selection_salt,
  "confirmatory_selection_salt_mismatch");
  invariant(Object.hasOwn(loaded, cohortName), `cohort_name_invalid:${cohortName}`);
  return {
    manifest,
    assetIds: loaded[cohortName].assetIds,
    assetIdsSha256: sha256(loaded[cohortName].assetIdsBody)
  };
}

async function main(argv = process.argv.slice(2)) {
  const evidencePath = valueFor(argv, "--evidence");
  const evidenceManifestPath = valueFor(argv, "--evidence-manifest");
  const cohortManifestPath = valueFor(argv, "--cohort-manifest");
  const cohortName = valueFor(argv, "--cohort-name");
  const promotionLabelsPath = valueFor(argv, "--promotion-labels");
  const helpfulLabelsPath = valueFor(argv, "--helpful-evidence-labels");
  for (const [flag, value] of [
    ["--evidence", evidencePath], ["--evidence-manifest", evidenceManifestPath],
    ["--cohort-manifest", cohortManifestPath], ["--cohort-name", cohortName],
    ["--promotion-labels", promotionLabelsPath], ["--helpful-evidence-labels", helpfulLabelsPath]
  ]) invariant(value, `${flag} is required`);

  const liveControlPath = valueFor(argv, "--live-control");
  const liveControlManifestPath = valueFor(argv, "--live-control-manifest");
  invariant(Boolean(liveControlPath) === Boolean(liveControlManifestPath),
    "--live-control and --live-control-manifest are required together");
  const cohort = await loadCohortSelection(resolve(cohortManifestPath), cohortName);
  const replayManifestPath = valueFor(argv, "--evidence-replay-manifest");
  const replayInputPath = valueFor(argv, "--evidence-replay-input");
  invariant(Boolean(replayManifestPath) === Boolean(replayInputPath),
    "--evidence-replay-manifest and --evidence-replay-input are required together");
  const [evidenceBody, evidenceManifestBody, promotionLabelsBody, helpfulLabelsBody,
    liveBody, liveManifestBody, replayManifestBody, replayInputBody] = await Promise.all([
    readFile(resolve(evidencePath), "utf8"),
    readFile(resolve(evidenceManifestPath), "utf8"),
    readFile(resolve(promotionLabelsPath), "utf8"),
    readFile(resolve(helpfulLabelsPath), "utf8"),
    liveControlPath ? readFile(resolve(liveControlPath), "utf8") : "",
    liveControlManifestPath ? readFile(resolve(liveControlManifestPath), "utf8") : null,
    replayManifestPath ? readFile(resolve(replayManifestPath), "utf8") : null,
    replayInputPath ? readFile(resolve(replayInputPath), "utf8") : null
  ]);
  let evidenceReplayValidated = false;
  if (replayManifestBody) {
    const evalRoot = valueFor(argv, "--eval-root", "/Users/paidaxin/lynca-eval-root");
    const scorerPath = resolve(evalRoot, "scripts/evaluate-cloud-listing-api.mjs");
    const [{ policyFairTokenRecall }, expectedSourceHashes] = await Promise.all([
      import(scorerPath), currentReplaySourceHashes({ scorerPath })
    ]);
    validateReplayArtifacts({
      replayBody: evidenceBody,
      replayManifest: JSON.parse(replayManifestBody),
      inputCheckpointBody: replayInputBody,
      parentRunManifestBody: evidenceManifestBody,
      expectedSourceHashes,
      scoreTokenRecall: policyFairTokenRecall
    });
    evidenceReplayValidated = true;
  }
  const report = analyzeBoundedEvidenceV2Gate({
    evidenceRows: rowsFrom(evidenceBody, "evidence"),
    evidenceManifest: JSON.parse(evidenceManifestBody),
    cohortManifest: cohort.manifest,
    cohortName,
    cohortAssetIds: cohort.assetIds,
    cohortAssetIdsSha256: cohort.assetIdsSha256,
    liveControlRows: liveBody ? rowsFrom(liveBody, "live_control") : [],
    liveControlManifest: liveManifestBody ? JSON.parse(liveManifestBody) : null,
    promotionLabels: rowsFrom(promotionLabelsBody, "promotion_labels"),
    helpfulEvidenceLabels: rowsFrom(helpfulLabelsBody, "helpful_evidence_labels"),
    evidenceReplayValidated,
    evidenceParentCheckpointSha256: sha256(replayInputBody ?? evidenceBody),
    liveControlCheckpointSha256: liveBody ? sha256(liveBody) : null,
    inputPricePerMillion: valueFor(argv, "--input-price-per-million"),
    outputPricePerMillion: valueFor(argv, "--output-price-per-million"),
    expectedEvidenceCards: valueFor(argv, "--expected-cards"),
    schemaNoninferiorityMargin: Number(valueFor(argv, "--schema-noninferiority-margin", "0.005"))
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const out = valueFor(argv, "--out");
  if (out) await writeFile(out, serialized);
  process.stdout.write(serialized);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
