#!/usr/bin/env node

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import {
  CANDIDATE_EXPRESSION_V3_MAX_FACTS,
  CANDIDATE_EXPRESSION_V3_PROMPT,
  CANDIDATE_EXPRESSION_V3_SCHEMA,
  CANDIDATE_EXPRESSION_V3_SCHEMA_NAME,
  CANDIDATE_EXPRESSION_V3_VERSION,
  buildCandidateExpressionV3Request,
  finishCandidateExpressionV3
} from "../lib/listing/thin/candidate-expression-v3.mjs";
import { requestFingerprint } from "./run-thin-path-eval.mjs";

const ARM = "candidate_expression_v3_high";
const MODEL = "gpt-5.6-luna";
const EFFORT = "none";
const IMAGE_DETAIL = "high";
const SELECTION_ROLE = "mechanism_probe_known_wins";
const COHORT_FILE = "product-mechanism-6.asset-ids.json";
const MAX_MEDIAN_OUTPUT_TOKENS = 400;
const HEX_256 = /^[0-9a-f]{64}$/;
const VISIBLE_LABEL_VERDICTS = new Set(["supported", "unsupported"]);

export const CANDIDATE_EXPRESSION_V3_MECHANISM_TARGETS = Object.freeze({
  reviewed_blind_8945fde9c65cb1b9f3a8: Object.freeze(["draft"]),
  reviewed_blind_7059d3b39d01402f0e61: Object.freeze(["veefriends"]),
  reviewed_blind_7c93444e09007eaec82f: Object.freeze(["mjx"]),
  reviewed_blind_7815e1aeda1f8e00dd4e: Object.freeze(["veefriends"]),
  reviewed_blind_a4051a222e9be2cf8149: Object.freeze(["star", "wars"]),
  reviewed_blind_a8a73b44f77bf6e823e2: Object.freeze(["ufc"])
});

const ROOT_SCHEMA_KEYS = Object.freeze(["candidate_facts", "unreadable_regions"]);
const FACT_SCHEMA_KEYS = Object.freeze(["value", "kind", "basis", "image", "region", "uncertainty"]);
const LABEL_KEYS = Object.freeze([
  "asset_id", ...FACT_SCHEMA_KEYS, "verdict", "reviewer"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sameSet = (left, right) => left.length === right.length
  && left.every((value) => new Set(right).has(value));
const normalizedTokens = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function validateHash(value, code) {
  invariant(typeof value === "string" && HEX_256.test(value), code);
}

function exactObjectKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function rawObject(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function rowsFrom(body, name) {
  return String(body ?? "").split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      invariant(row && typeof row === "object" && !Array.isArray(row),
        `${name}_row_not_object:${index + 1}`);
      return [row];
    } catch (error) {
      if (String(error?.message || "").startsWith(`${name}_`)) throw error;
      throw new Error(`${name}_invalid_json:${index + 1}`);
    }
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function expectedRequestSha256(imageCount) {
  invariant(Number.isInteger(imageCount) && imageCount >= 0 && imageCount <= 2,
    "request_image_count_invalid");
  return requestFingerprint(buildCandidateExpressionV3Request({
    imageUrls: Array.from({ length: imageCount }, (_, index) => `https://signed.invalid/${index + 1}`),
    model: MODEL,
    effort: EFFORT,
    imageDetail: IMAGE_DETAIL
  }));
}

function validateCohort({ cohortManifest, cohortAssetIds, cohortAssetIdsSha256 }) {
  invariant(cohortManifest?.schema_version === "bounded-evidence-v2-cohort-manifest-v2",
    "cohort_manifest_schema_invalid");
  invariant(cohortManifest?.relationship?.product_mechanism_probe === 6,
    "cohort_manifest_mechanism_relationship_invalid");
  for (const source of ["canonical_v3", "high100", "reviewed_dataset_255"]) {
    validateHash(cohortManifest?.source_sha256?.[source],
      `cohort_manifest_source_hash_invalid:${source}`);
  }
  const entry = cohortManifest?.cohorts?.mechanism6;
  invariant(entry?.file === COHORT_FILE, "cohort_manifest_file_invalid");
  invariant(entry?.selection_role === SELECTION_ROLE, "cohort_manifest_role_invalid");
  invariant(entry?.selection_method === "six_preidentified_product_extension_wins_mechanism_only",
    "cohort_manifest_selection_method_invalid");
  invariant(entry?.count === 6, "cohort_manifest_count_invalid");
  validateHash(entry?.asset_ids_sha256, "cohort_manifest_asset_ids_hash_invalid");
  invariant(entry.asset_ids_sha256 === cohortAssetIdsSha256,
    "cohort_manifest_asset_ids_hash_mismatch");
  invariant(Array.isArray(cohortAssetIds) && cohortAssetIds.length === 6,
    "cohort_asset_ids_invalid");
  invariant(cohortAssetIds.every((assetId) => typeof assetId === "string"
      && assetId.trim() === assetId && assetId.length > 0), "cohort_asset_id_invalid");
  invariant(new Set(cohortAssetIds).size === cohortAssetIds.length,
    "cohort_asset_ids_duplicate");
  invariant(sameSet(cohortAssetIds, Object.keys(CANDIDATE_EXPRESSION_V3_MECHANISM_TARGETS)),
    "cohort_mechanism_targets_mismatch");
}

function validateRunManifest({ runManifest, cohortAssetIds, cohortAssetIdsSha256,
  checkpointSha256 }) {
  invariant(runManifest?.schema_version === "thin-path-eval-run-manifest-v2",
    "run_manifest_schema_invalid");
  invariant(runManifest?.contract?.schema_version === "thin-path-eval-run-contract-v2",
    "run_manifest_contract_schema_invalid");
  validateHash(runManifest.fingerprint, "run_manifest_fingerprint_invalid");
  invariant(runManifest.fingerprint === sha256(JSON.stringify(runManifest.contract)),
    "run_manifest_fingerprint_mismatch");

  const contract = runManifest.contract;
  invariant(contract.model === MODEL, "run_manifest_model_invalid");
  invariant(contract.effort === EFFORT, "run_manifest_effort_invalid");
  invariant(contract.image_detail === IMAGE_DETAIL, "run_manifest_detail_invalid");
  invariant(contract.cohort?.selection_role === SELECTION_ROLE,
    "run_manifest_selection_role_invalid");
  invariant(Number.isInteger(contract.execution?.concurrency)
      && contract.execution.concurrency >= 1, "run_manifest_concurrency_invalid");
  invariant(Number.isInteger(contract.execution?.request_timeout_ms)
      && contract.execution.request_timeout_ms >= 10_000, "run_manifest_timeout_invalid");
  invariant(Number.isInteger(contract.execution?.max_attempts)
      && contract.execution.max_attempts >= 1, "run_manifest_max_attempts_invalid");
  invariant(typeof contract.execution?.retry_policy === "string"
      && contract.execution.retry_policy.length > 0, "run_manifest_retry_policy_invalid");

  invariant(Array.isArray(contract.arms) && contract.arms.length === 1,
    "run_manifest_not_single_arm");
  const arm = contract.arms[0];
  invariant(arm.key === ARM, "run_manifest_arm_invalid");
  invariant(arm.fixed_image_detail === IMAGE_DETAIL, "run_manifest_arm_detail_invalid");
  invariant(arm.eval_version === CANDIDATE_EXPRESSION_V3_VERSION,
    "run_manifest_eval_version_invalid");
  invariant(arm.response_schema_name === CANDIDATE_EXPRESSION_V3_SCHEMA_NAME,
    "run_manifest_schema_name_invalid");
  invariant(arm.response_schema_sha256 === sha256(JSON.stringify(CANDIDATE_EXPRESSION_V3_SCHEMA)),
    "run_manifest_schema_hash_mismatch");
  invariant(arm.prompt_sha256 === sha256(CANDIDATE_EXPRESSION_V3_PROMPT),
    "run_manifest_prompt_hash_mismatch");
  invariant(Array.isArray(arm.request_template_sha256)
      && arm.request_template_sha256.length === 3, "run_manifest_request_templates_invalid");
  for (const imageCount of [0, 1, 2]) {
    invariant(arm.request_template_sha256[imageCount] === expectedRequestSha256(imageCount),
      `run_manifest_request_template_mismatch:${imageCount}`);
  }

  validateHash(contract.dataset_sha256, "run_manifest_dataset_hash_invalid");
  validateHash(contract.sealed_labels_sha256, "run_manifest_labels_hash_invalid");
  invariant(contract.asset_ids_sha256 === cohortAssetIdsSha256,
    "run_manifest_asset_ids_hash_mismatch");
  const providerBehavior = contract.source_sha256?.provider_request_behavior;
  invariant(providerBehavior === sha256(JSON.stringify([arm.request_template_sha256])),
    "run_manifest_provider_behavior_hash_mismatch");

  invariant(runManifest.max_requested_limit === 6, "run_manifest_limit_invalid");
  invariant(runManifest.max_requested_asset_ids_sha256
      === sha256(JSON.stringify(cohortAssetIds)), "run_manifest_selected_ids_hash_mismatch");
  validateHash(runManifest.checkpoint_sha256, "run_manifest_checkpoint_hash_invalid");
  invariant(runManifest.checkpoint_sha256 === checkpointSha256,
    "run_manifest_checkpoint_hash_mismatch");
  invariant(runManifest.checkpoint_rows === 6, "run_manifest_checkpoint_rows_invalid");
  invariant(typeof runManifest.completed_at === "string" && runManifest.completed_at.length > 0,
    "run_manifest_completion_missing");

  invariant(runManifest.finisher?.contract?.schema_version
      === "thin-path-eval-finisher-contract-v1", "run_manifest_finisher_schema_invalid");
  invariant(runManifest.finisher.contract.derivation_contract
      === "thin-path-eval-derived-metrics-v1", "run_manifest_finisher_derivation_invalid");
  invariant(JSON.stringify(runManifest.finisher.contract.arms) === JSON.stringify([ARM]),
    "run_manifest_finisher_arms_invalid");
  validateHash(runManifest.finisher.fingerprint, "run_manifest_finisher_fingerprint_invalid");
  invariant(runManifest.finisher.fingerprint
      === sha256(JSON.stringify(runManifest.finisher.contract)),
  "run_manifest_finisher_fingerprint_mismatch");
  const sources = runManifest.finisher.contract.source_sha256;
  invariant(sources && typeof sources === "object" && !Array.isArray(sources)
      && Object.keys(sources).length > 0, "run_manifest_finisher_sources_invalid");
  for (const [source, hash] of Object.entries(sources)) {
    validateHash(hash, `run_manifest_finisher_source_hash_invalid:${source}`);
  }
}

function strictRawSchemaDefects(raw, assetId) {
  const parsed = rawObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const defects = [];
  if (!exactObjectKeys(parsed, ROOT_SCHEMA_KEYS)) {
    defects.push(`candidate_v3_root_schema_mismatch:${assetId}`);
  }
  if (Array.isArray(parsed.candidate_facts)) {
    parsed.candidate_facts.forEach((candidate, index) => {
      if (!exactObjectKeys(candidate, FACT_SCHEMA_KEYS)) {
        defects.push(`candidate_v3_fact_schema_mismatch:${assetId}:${index}`);
      }
    });
  }
  return defects;
}

function validateCheckpointRows({ checkpointRows, runManifest, cohortAssetIds }) {
  invariant(Array.isArray(checkpointRows) && checkpointRows.length === 6,
    "checkpoint_row_count_invalid");
  const ids = checkpointRows.map(({ asset_id: assetId }) => assetId);
  invariant(new Set(ids).size === ids.length, "checkpoint_duplicate_asset_ids");
  invariant(sameSet(ids, cohortAssetIds), "checkpoint_asset_set_mismatch");
  const byId = new Map(checkpointRows.map((row) => [row.asset_id, row]));
  const ordered = cohortAssetIds.map((assetId) => byId.get(assetId));

  for (const row of ordered) {
    const suffix = row.asset_id;
    invariant(row.arm === ARM, `checkpoint_arm_invalid:${suffix}`);
    invariant(row.run_fingerprint === runManifest.fingerprint,
      `checkpoint_run_fingerprint_mismatch:${suffix}`);
    invariant(row.finisher_fingerprint === runManifest.finisher.fingerprint,
      `checkpoint_finisher_fingerprint_mismatch:${suffix}`);
    invariant(row.model === MODEL, `checkpoint_model_invalid:${suffix}`);
    invariant(row.requested_effort === EFFORT && row.served_effort === EFFORT,
      `checkpoint_effort_invalid:${suffix}`);
    invariant(row.image_detail === IMAGE_DETAIL, `checkpoint_detail_invalid:${suffix}`);
    invariant(row.arm_eval_version === CANDIDATE_EXPRESSION_V3_VERSION,
      `checkpoint_eval_version_invalid:${suffix}`);
    invariant(row.candidate_schema_version === CANDIDATE_EXPRESSION_V3_VERSION,
      `checkpoint_candidate_schema_invalid:${suffix}`);
    invariant(Number.isInteger(row.image_count) && row.image_count >= 1 && row.image_count <= 2,
      `checkpoint_image_count_invalid:${suffix}`);
    validateHash(row.image_set_sha256, `checkpoint_image_set_hash_invalid:${suffix}`);
    invariant(row.request_sha256 === expectedRequestSha256(row.image_count),
      `checkpoint_request_hash_mismatch:${suffix}`);
    invariant(typeof row.reference === "string" && row.reference.trim() === row.reference
      && row.reference.length > 0, `checkpoint_reference_invalid:${suffix}`);

    const derived = finishCandidateExpressionV3(row.raw_title);
    invariant(JSON.stringify(row.candidate_facts) === JSON.stringify(derived.candidate_facts),
      `checkpoint_candidate_derivation_mismatch:${suffix}`);
    invariant(JSON.stringify(row.unreadable_regions) === JSON.stringify(derived.unreadable_regions),
      `checkpoint_unreadable_derivation_mismatch:${suffix}`);
    invariant(JSON.stringify(row.candidate_defects) === JSON.stringify(derived.candidate_defects),
      `checkpoint_defect_derivation_mismatch:${suffix}`);
    invariant(row.title === derived.title && row.length === derived.length,
      `checkpoint_diagnostic_text_mismatch:${suffix}`);
    invariant(row.raw_length === derived.raw_length,
      `checkpoint_raw_length_mismatch:${suffix}`);
    invariant(row.sanitised === false && row.truncated === false,
      `checkpoint_candidate_mutation_invalid:${suffix}`);
  }
  return ordered;
}

function factKey(assetId, fact) {
  return JSON.stringify([assetId, ...FACT_SCHEMA_KEYS.map((field) => fact[field])]);
}

function labelToFact(label) {
  return Object.fromEntries(FACT_SCHEMA_KEYS.map((field) => [field, label[field]]));
}

function validateProvenanceLabels(labels, visibleFacts) {
  const expected = new Map(visibleFacts.map(({ asset_id: assetId, fact }) => [
    factKey(assetId, fact), { asset_id: assetId, ...fact }
  ]));
  invariant(expected.size === visibleFacts.length, "visible_candidate_keys_ambiguous");
  const supplied = new Map();
  for (const [index, label] of (labels ?? []).entries()) {
    invariant(exactObjectKeys(label, LABEL_KEYS), `provenance_label_schema_invalid:${index + 1}`);
    invariant(typeof label.asset_id === "string" && label.asset_id.length > 0,
      `provenance_label_asset_id_invalid:${index + 1}`);
    invariant(FACT_SCHEMA_KEYS.every((field) => typeof label[field] === "string"
      && label[field].length > 0), `provenance_label_fact_invalid:${index + 1}`);
    invariant(VISIBLE_LABEL_VERDICTS.has(label.verdict),
      `provenance_label_verdict_invalid:${index + 1}`);
    invariant(typeof label.reviewer === "string" && label.reviewer.trim().length > 0,
      `provenance_label_reviewer_invalid:${index + 1}`);
    const key = factKey(label.asset_id, labelToFact(label));
    invariant(expected.has(key), `provenance_label_extra:${index + 1}`);
    invariant(!supplied.has(key), `provenance_label_duplicate:${index + 1}`);
    supplied.set(key, label);
  }
  const missing = [...expected].filter(([key]) => !supplied.has(key)).map(([, value]) => value);
  const supported = [...supplied.values()].filter(({ verdict }) => verdict === "supported");
  const unsupported = [...supplied.values()].filter(({ verdict }) => verdict === "unsupported");
  return { expected: [...expected.values()], supplied: [...supplied.values()], missing, supported, unsupported };
}

function matchingTargetFacts(row) {
  const targetTokens = CANDIDATE_EXPRESSION_V3_MECHANISM_TARGETS[row.asset_id];
  return row.candidate_facts.filter((fact) => {
    const tokens = new Set(normalizedTokens(fact.value));
    return targetTokens.every((token) => tokens.has(token));
  });
}

export function analyzeCandidateExpressionV3Mechanism({
  checkpointRows,
  checkpointSha256,
  runManifest,
  cohortManifest,
  cohortAssetIds,
  cohortAssetIdsSha256,
  provenanceLabels = null
}) {
  validateCohort({ cohortManifest, cohortAssetIds, cohortAssetIdsSha256 });
  validateRunManifest({ runManifest, cohortAssetIds, cohortAssetIdsSha256, checkpointSha256 });
  const rows = validateCheckpointRows({ checkpointRows, runManifest, cohortAssetIds });

  const rowDiagnostics = rows.map((row) => {
    const parsedRaw = rawObject(row.raw_title);
    const rawFactCount = Array.isArray(parsedRaw?.candidate_facts)
      ? parsedRaw.candidate_facts.length : 0;
    const schemaDefects = strictRawSchemaDefects(row.raw_title, row.asset_id);
    const targetFacts = matchingTargetFacts(row);
    return {
      asset_id: row.asset_id,
      target_tokens: CANDIDATE_EXPRESSION_V3_MECHANISM_TARGETS[row.asset_id],
      captured: targetFacts.length > 0,
      matching_candidates: targetFacts,
      candidate_fact_count: row.candidate_facts.length,
      raw_candidate_fact_count: rawFactCount,
      candidate_defects: row.candidate_defects,
      strict_schema_defects: schemaDefects,
      output_tokens: row.output_tokens,
      fields_present: row.fields !== null && row.fields !== undefined,
      production_promotion_present: row.production_promoted === true
        || (Array.isArray(row.evidence_promotions) && row.evidence_promotions.length > 0)
    };
  });

  const visibleFacts = rows.flatMap((row) => row.candidate_facts
    .filter(({ basis }) => basis !== "model_knowledge")
    .map((fact) => ({ asset_id: row.asset_id, fact })));
  const knowledgeFacts = rows.flatMap((row) => row.candidate_facts
    .filter(({ basis }) => basis === "model_knowledge")
    .map((fact) => ({ asset_id: row.asset_id, fact })));
  const review = validateProvenanceLabels(provenanceLabels, visibleFacts);
  const validOutputTokens = rows.every(({ output_tokens: value }) => Number.isInteger(value) && value >= 0);
  const medianOutputTokens = validOutputTokens
    ? median(rows.map(({ output_tokens: value }) => value)) : null;

  const hardFailures = [];
  for (const diagnostic of rowDiagnostics) {
    if (!diagnostic.captured) hardFailures.push(`target_miss:${diagnostic.asset_id}`);
    if (diagnostic.raw_candidate_fact_count > CANDIDATE_EXPRESSION_V3_MAX_FACTS) {
      hardFailures.push(`candidate_fact_limit_exceeded:${diagnostic.asset_id}`);
    }
    if (diagnostic.candidate_defects.length || diagnostic.strict_schema_defects.length) {
      hardFailures.push(`candidate_schema_defect:${diagnostic.asset_id}`);
    }
    if (diagnostic.fields_present) hardFailures.push(`canonical_fields_present:${diagnostic.asset_id}`);
    if (diagnostic.production_promotion_present) {
      hardFailures.push(`production_promotion_present:${diagnostic.asset_id}`);
    }
  }
  if (!validOutputTokens) hardFailures.push("output_token_usage_missing_or_invalid");
  else if (medianOutputTokens > MAX_MEDIAN_OUTPUT_TOKENS) {
    hardFailures.push(`median_output_tokens_exceeded:${medianOutputTokens}`);
  }
  for (const label of review.unsupported) {
    hardFailures.push(`visible_provenance_unsupported:${label.asset_id}:${label.value}`);
  }

  const decision = hardFailures.length
    ? "STOP"
    : review.missing.length
      ? "MANUAL_REVIEW_REQUIRED"
      : "CAPTURE_ONLY_PASS";

  return {
    schema_version: "candidate-expression-v3-mechanism-gate-v1",
    validated_contract: {
      run_fingerprint: runManifest.fingerprint,
      cohort: "mechanism6",
      selection_role: SELECTION_ROLE,
      arm: ARM,
      candidate_schema_version: CANDIDATE_EXPRESSION_V3_VERSION,
      model: MODEL,
      effort: EFFORT,
      image_detail: IMAGE_DETAIL,
      asset_ids_sha256: cohortAssetIdsSha256
    },
    population: {
      rows: rows.length,
      unique_cards: new Set(rows.map(({ asset_id: assetId }) => assetId)).size,
      total_candidate_facts: rows.reduce((sum, row) => sum + row.candidate_facts.length, 0),
      visible_candidate_facts: visibleFacts.length,
      model_knowledge_candidate_facts: knowledgeFacts.length
    },
    target_capture: {
      captured_cards: rowDiagnostics.filter(({ captured }) => captured).length,
      missed_cards: rowDiagnostics.filter(({ captured }) => !captured)
        .map(({ asset_id: assetId }) => assetId),
      rows: rowDiagnostics
    },
    candidate_safety: {
      maximum_facts_per_card: CANDIDATE_EXPRESSION_V3_MAX_FACTS,
      rows_with_defects: rowDiagnostics.filter(({ candidate_defects, strict_schema_defects }) => (
        candidate_defects.length || strict_schema_defects.length
      )).map(({ asset_id: assetId }) => assetId),
      rows_with_canonical_fields: rowDiagnostics.filter(({ fields_present }) => fields_present)
        .map(({ asset_id: assetId }) => assetId),
      rows_with_production_promotion: rowDiagnostics
        .filter(({ production_promotion_present }) => production_promotion_present)
        .map(({ asset_id: assetId }) => assetId)
    },
    provenance_review: {
      expected_visible_labels: review.expected.length,
      supplied_labels: review.supplied.length,
      supported_labels: review.supported.length,
      unsupported_labels: review.unsupported,
      missing_labels: review.missing,
      complete: review.missing.length === 0
    },
    usage: {
      output_tokens_total: validOutputTokens
        ? rows.reduce((sum, row) => sum + row.output_tokens, 0) : null,
      median_output_tokens: medianOutputTokens,
      maximum_median_output_tokens: MAX_MEDIAN_OUTPUT_TOKENS,
      within_budget: validOutputTokens && medianOutputTokens <= MAX_MEDIAN_OUTPUT_TOKENS
    },
    hard_failures: hardFailures,
    decision,
    interpretation: decision === "CAPTURE_ONLY_PASS"
      ? "candidate capture only; no accuracy or production-promotion claim"
      : decision === "MANUAL_REVIEW_REQUIRED"
        ? "visible provenance labels are incomplete"
        : "mechanism gate failed"
  };
}

export async function loadCandidateExpressionV3MechanismInputs({
  checkpointPath, runManifestPath, cohortManifestPath, provenanceLabelsPath = null
}) {
  const [checkpointBody, runManifestBody, cohortManifestBody, provenanceLabelsBody] = await Promise.all([
    readFile(checkpointPath, "utf8"),
    readFile(runManifestPath, "utf8"),
    readFile(cohortManifestPath, "utf8"),
    provenanceLabelsPath ? readFile(provenanceLabelsPath, "utf8") : null
  ]);
  const cohortManifest = JSON.parse(cohortManifestBody);
  const cohortPath = resolve(dirname(cohortManifestPath), COHORT_FILE);
  const cohortBody = await readFile(cohortPath, "utf8");
  return {
    checkpointRows: rowsFrom(checkpointBody, "checkpoint"),
    checkpointSha256: sha256(checkpointBody),
    runManifest: JSON.parse(runManifestBody),
    cohortManifest,
    cohortAssetIds: JSON.parse(cohortBody),
    cohortAssetIdsSha256: sha256(cohortBody),
    provenanceLabels: provenanceLabelsBody === null
      ? null : rowsFrom(provenanceLabelsBody, "provenance_labels")
  };
}

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

export async function main(argv = process.argv.slice(2)) {
  const checkpointPath = valueFor(argv, "--checkpoint");
  const runManifestPath = valueFor(argv, "--run-manifest");
  const cohortManifestPath = valueFor(argv, "--cohort-manifest");
  const provenanceLabelsPath = valueFor(argv, "--provenance-labels");
  const outPath = valueFor(argv, "--out");
  for (const [flag, value] of [
    ["--checkpoint", checkpointPath],
    ["--run-manifest", runManifestPath],
    ["--cohort-manifest", cohortManifestPath],
    ["--out", outPath]
  ]) invariant(value, `${flag} is required`);

  const inputs = await loadCandidateExpressionV3MechanismInputs({
    checkpointPath: resolve(checkpointPath),
    runManifestPath: resolve(runManifestPath),
    cohortManifestPath: resolve(cohortManifestPath),
    provenanceLabelsPath: provenanceLabelsPath ? resolve(provenanceLabelsPath) : null
  });
  const report = analyzeCandidateExpressionV3Mechanism(inputs);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(resolve(outPath), serialized, "utf8");
  process.stdout.write(serialized);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
