#!/usr/bin/env node

// Zero-cost replay of stored provider responses through the current deterministic
// bounded-evidence-v2 finisher. A replay never receives a new run_fingerprint:
// that identifier remains the paid provider contract. The separate receipt binds
// the old checkpoint to the exact finisher/scorer sources and replay output.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  BOUNDED_EVIDENCE_V2_VERSION,
  finishBoundedEvidenceV2Title
} from "../lib/listing/thin/bounded-evidence-v2.mjs";

const ARM = "thin_canonical_bounded_evidence_v2_high";
const REPLAY_SCHEMA = "bounded-evidence-v2-replay-manifest-v1";
const REPLAY_CONTRACT_SCHEMA = "bounded-evidence-v2-replay-contract-v1";
const SHA256 = /^[0-9a-f]{64}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rowsFrom = (body) => String(body).split("\n").filter(Boolean).map(JSON.parse);
const valueFor = (argv, name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const REPLAY_MUTABLE_FIELDS = new Set([
  "score", "f1", "recall", "precision", "title", "sanitised", "truncated",
  "raw_length", "length", "fields", "canonical_control_title",
  "canonical_control_length", "field_defects", "grammar", "brackets",
  "dropped_brackets", "suppressed_brackets", "empty_fields", "unreadable_fields",
  "low_confidence_fields", "observations", "unreadable_regions", "observation_defects",
  "open_evidence", "evidence_schema_version", "evidence_spans", "evidence_candidates",
  "evidence_noise_dropped", "evidence_promotions", "evidence_defects",
  "evidence_resolution", "evidence_resolver_version", "production_promoted",
  "parent_run_fingerprint", "provider_row_sha256", "replay_fingerprint"
]);

const sourceFiles = (scorerPath) => ({
  replay_harness: new URL(import.meta.url),
  bounded_evidence_v2: new URL("../lib/listing/thin/bounded-evidence-v2.mjs", import.meta.url),
  canonical_fields: new URL("../lib/listing/thin/canonical-fields.mjs", import.meta.url),
  thin_listing_path: new URL("../lib/listing/thin/thin-listing-path.mjs", import.meta.url),
  canonical_composer: new URL("../lib/listing/thin/canonical-composer.mjs", import.meta.url),
  marketplace_composer_rules: new URL("../lib/listing/thin/marketplace-composer-rules.mjs", import.meta.url),
  sanitize_listing_title: new URL("../lib/listing/thin/sanitize-listing-title.mjs", import.meta.url),
  sem_definition: new URL("../lib/listing/csm/sem-definition.mjs", import.meta.url),
  product_semantics: new URL("../lib/listing/csm/product-semantics.mjs", import.meta.url),
  scorer: scorerPath
});

export async function currentReplaySourceHashes({ scorerPath }) {
  const entries = await Promise.all(Object.entries(sourceFiles(scorerPath)).map(async ([name, path]) => [
    name, sha256(await readFile(path))
  ]));
  return Object.freeze(Object.fromEntries(entries));
}

function validateParentRunManifest(manifest) {
  if (manifest?.schema_version !== "thin-path-eval-run-manifest-v2"
      || manifest?.contract?.schema_version !== "thin-path-eval-run-contract-v2") {
    throw new Error("replay_parent_manifest_schema_invalid");
  }
  if (manifest.fingerprint !== sha256(JSON.stringify(manifest.contract))) {
    throw new Error("replay_parent_manifest_fingerprint_invalid");
  }
  if (manifest?.finisher?.contract?.schema_version !== "thin-path-eval-finisher-contract-v1"
      || manifest.finisher.fingerprint !== sha256(JSON.stringify(manifest.finisher.contract))) {
    throw new Error("replay_parent_finisher_fingerprint_invalid");
  }
  const arms = manifest.contract.arms || [];
  if (arms.length !== 1 || arms[0]?.key !== ARM
      || arms[0]?.eval_version !== BOUNDED_EVIDENCE_V2_VERSION) {
    throw new Error("replay_parent_manifest_arm_invalid");
  }
}

function validateInputRows(rows, parentManifest) {
  const seen = new Set();
  for (const row of rows) {
    const key = `${row?.asset_id}\u0000${row?.arm}`;
    if (!row?.asset_id || row.arm !== ARM || seen.has(key)) {
      throw new Error(seen.has(key) ? "replay_input_duplicate_key" : "replay_input_row_invalid");
    }
    seen.add(key);
    if (row.run_fingerprint !== parentManifest.fingerprint) {
      throw new Error("replay_input_row_fingerprint_mismatch");
    }
    if (row.finisher_fingerprint !== parentManifest.finisher.fingerprint) {
      throw new Error("replay_input_row_finisher_fingerprint_mismatch");
    }
    if (typeof row.raw_title !== "string" || !row.raw_title.trim()) {
      throw new Error("replay_input_raw_title_missing");
    }
    if (typeof row.reference !== "string" || !row.reference.trim()) {
      throw new Error("replay_input_reference_missing");
    }
    if (!SHA256.test(String(row.request_sha256 || ""))
        || !SHA256.test(String(row.image_set_sha256 || ""))) {
      throw new Error("replay_input_request_shape_invalid");
    }
  }
}

const tokenise = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

function scoreF1(reference, title) {
  const wanted = tokenise(reference);
  const got = tokenise(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function replayDerivedFields(row, finished, scoreTokenRecall) {
  const quality = scoreF1(row.reference, finished.title);
  return {
    score: scoreTokenRecall(row.reference, finished.title),
    ...quality,
    title: finished.title,
    sanitised: finished.sanitised,
    truncated: finished.truncated,
    raw_length: finished.raw_length,
    length: finished.length,
    fields: finished.fields ?? null,
    canonical_control_title: finished.canonical_control_title ?? null,
    canonical_control_length: finished.canonical_control_length ?? null,
    field_defects: finished.field_defects ?? null,
    grammar: finished.grammar ?? null,
    brackets: finished.brackets ?? null,
    dropped_brackets: finished.dropped_brackets ?? null,
    suppressed_brackets: finished.suppressed_brackets ?? null,
    empty_fields: finished.empty_fields ?? null,
    unreadable_fields: finished.unreadable_fields ?? null,
    low_confidence_fields: finished.low_confidence_fields ?? null,
    observations: finished.observations ?? null,
    unreadable_regions: finished.unreadable_regions ?? null,
    observation_defects: finished.observation_defects ?? null,
    open_evidence: finished.open_evidence ?? null,
    evidence_schema_version: finished.evidence_schema_version ?? null,
    evidence_spans: finished.evidence_spans ?? null,
    evidence_candidates: finished.evidence_candidates ?? null,
    evidence_noise_dropped: finished.evidence_noise_dropped ?? null,
    evidence_promotions: finished.evidence_promotions ?? null,
    evidence_defects: finished.evidence_defects ?? null,
    evidence_resolution: finished.evidence_resolution ?? null,
    evidence_resolver_version: finished.evidence_resolver_version ?? BOUNDED_EVIDENCE_V2_VERSION,
    production_promoted: finished.production_promoted ?? null
  };
}

export function buildReplayArtifacts({
  inputCheckpointBody,
  parentRunManifestBody,
  sourceHashes,
  scoreTokenRecall,
  createdAt = new Date().toISOString()
}) {
  const parentManifest = JSON.parse(parentRunManifestBody);
  validateParentRunManifest(parentManifest);
  const inputRows = rowsFrom(inputCheckpointBody);
  validateInputRows(inputRows, parentManifest);
  if (!inputRows.length) throw new Error("replay_input_empty");
  if (parentManifest.checkpoint_sha256 !== sha256(inputCheckpointBody)
      || Number(parentManifest.checkpoint_rows) !== inputRows.length) {
    throw new Error("replay_parent_checkpoint_receipt_mismatch");
  }
  if (typeof scoreTokenRecall !== "function") throw new Error("replay_scorer_required");
  if (!sourceHashes || Object.values(sourceHashes).some((hash) => !SHA256.test(String(hash)))) {
    throw new Error("replay_source_hashes_invalid");
  }
  const contract = {
    schema_version: REPLAY_CONTRACT_SCHEMA,
    parent_run_fingerprint: parentManifest.fingerprint,
    parent_run_manifest_sha256: sha256(parentRunManifestBody),
    input_checkpoint_sha256: sha256(inputCheckpointBody),
    resolver_version: BOUNDED_EVIDENCE_V2_VERSION,
    source_sha256: sourceHashes
  };
  const replayFingerprint = sha256(JSON.stringify(contract));
  const replayRows = inputRows.map((row) => ({
    ...row,
    ...replayDerivedFields(row, finishBoundedEvidenceV2Title(row.raw_title), scoreTokenRecall),
    parent_run_fingerprint: row.run_fingerprint,
    provider_row_sha256: sha256(JSON.stringify(row)),
    replay_fingerprint: replayFingerprint
  }));
  const outputBody = `${replayRows.map(JSON.stringify).join("\n")}\n`;
  const replayManifest = {
    schema_version: REPLAY_SCHEMA,
    replay_fingerprint: replayFingerprint,
    contract,
    rows: replayRows.length,
    output_sha256: sha256(outputBody),
    created_at: createdAt,
    note: "zero_cost_deterministic_replay_not_a_provider_run"
  };
  return { rows: replayRows, outputBody, replayManifest };
}

function sameProviderFields(input, replay) {
  const immutableFields = new Set([...Object.keys(input), ...Object.keys(replay)]
    .filter((field) => !REPLAY_MUTABLE_FIELDS.has(field)));
  return [...immutableFields].every((field) => JSON.stringify(input[field] ?? null)
    === JSON.stringify(replay[field] ?? null));
}

export function validateReplayArtifacts({
  replayBody,
  replayManifest,
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes,
  scoreTokenRecall
}) {
  if (replayManifest?.schema_version !== REPLAY_SCHEMA
      || replayManifest?.contract?.schema_version !== REPLAY_CONTRACT_SCHEMA) {
    throw new Error("replay_manifest_schema_invalid");
  }
  const parentManifest = JSON.parse(parentRunManifestBody);
  validateParentRunManifest(parentManifest);
  const contract = replayManifest.contract;
  const expectedFingerprint = sha256(JSON.stringify(contract));
  if (replayManifest.replay_fingerprint !== expectedFingerprint) {
    throw new Error("replay_manifest_fingerprint_invalid");
  }
  if (contract.parent_run_fingerprint !== parentManifest.fingerprint
      || contract.parent_run_manifest_sha256 !== sha256(parentRunManifestBody)) {
    throw new Error("replay_parent_manifest_mismatch");
  }
  if (contract.input_checkpoint_sha256 !== sha256(inputCheckpointBody)) {
    throw new Error("replay_input_checkpoint_mismatch");
  }
  if (JSON.stringify(contract.source_sha256) !== JSON.stringify(expectedSourceHashes)) {
    throw new Error("replay_sources_stale");
  }
  if (replayManifest.output_sha256 !== sha256(replayBody)) {
    throw new Error("replay_output_hash_mismatch");
  }
  const inputRows = rowsFrom(inputCheckpointBody);
  const replayRows = rowsFrom(replayBody);
  validateInputRows(inputRows, parentManifest);
  if (parentManifest.checkpoint_sha256 !== sha256(inputCheckpointBody)
      || Number(parentManifest.checkpoint_rows) !== inputRows.length) {
    throw new Error("replay_parent_checkpoint_receipt_mismatch");
  }
  if (typeof scoreTokenRecall !== "function") throw new Error("replay_scorer_required");
  if (replayManifest.rows !== replayRows.length || inputRows.length !== replayRows.length) {
    throw new Error("replay_row_count_mismatch");
  }
  const inputByKey = new Map(inputRows.map((row) => [`${row.asset_id}\u0000${row.arm}`, row]));
  const seen = new Set();
  for (const row of replayRows) {
    const key = `${row?.asset_id}\u0000${row?.arm}`;
    const input = inputByKey.get(key);
    if (!input || seen.has(key)) throw new Error("replay_row_key_mismatch");
    seen.add(key);
    if (row.replay_fingerprint !== expectedFingerprint
        || row.parent_run_fingerprint !== parentManifest.fingerprint
        || row.run_fingerprint !== parentManifest.fingerprint
        || row.provider_row_sha256 !== sha256(JSON.stringify(input))) {
      throw new Error("replay_row_provenance_mismatch");
    }
    if (!sameProviderFields(input, row)) throw new Error("replay_provider_fields_changed");
    const expectedDerived = replayDerivedFields(
      input,
      finishBoundedEvidenceV2Title(input.raw_title),
      scoreTokenRecall
    );
    if (Object.entries(expectedDerived).some(([field, value]) => (
      JSON.stringify(row[field] ?? null) !== JSON.stringify(value ?? null)
    ))) {
      throw new Error("replay_derived_fields_mismatch");
    }
  }
  return Object.freeze({ rows: replayRows, replay_fingerprint: expectedFingerprint });
}

async function main(argv = process.argv.slice(2)) {
  const inputPath = valueFor(argv, "--input");
  const parentManifestPath = valueFor(argv, "--run-manifest");
  const outPath = valueFor(argv, "--out");
  if (!inputPath || !parentManifestPath || !outPath) {
    throw new Error("--input, --run-manifest and --out are required");
  }
  const evalRoot = valueFor(argv, "--eval-root", "/Users/paidaxin/lynca-eval-root");
  const scorerPath = resolve(evalRoot, "scripts/evaluate-cloud-listing-api.mjs");
  const [{ policyFairTokenRecall }, inputCheckpointBody, parentRunManifestBody, sourceHashes] = await Promise.all([
    import(scorerPath),
    readFile(resolve(inputPath), "utf8"),
    readFile(resolve(parentManifestPath), "utf8"),
    currentReplaySourceHashes({ scorerPath })
  ]);
  const artifacts = buildReplayArtifacts({
    inputCheckpointBody,
    parentRunManifestBody,
    sourceHashes,
    scoreTokenRecall: policyFairTokenRecall
  });
  const manifestOut = resolve(valueFor(argv, "--manifest-out", `${outPath}.replay-manifest.json`));
  await writeFile(resolve(outPath), artifacts.outputBody, "utf8");
  await writeFile(manifestOut, `${JSON.stringify(artifacts.replayManifest, null, 2)}\n`, "utf8");
  process.stdout.write(`replayed ${artifacts.rows.length} rows without provider calls\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
