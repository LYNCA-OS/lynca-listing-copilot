#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  buildReplayArtifacts,
  validateReplayArtifacts
} from "./replay-bounded-evidence-v2-checkpoint.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixture = await readFile(new URL("./fixtures/bounded-evidence-v2-response.json", import.meta.url), "utf8");
const contract = {
  schema_version: "thin-path-eval-run-contract-v2",
  model: "gpt-5.6-luna",
  effort: "none",
  image_detail: "high",
  arms: [{
    key: "thin_canonical_bounded_evidence_v2_high",
    eval_version: "bounded-evidence-v2"
  }]
};
const finisherContract = {
  schema_version: "thin-path-eval-finisher-contract-v1",
  derivation_contract: "thin-path-eval-derived-metrics-v1",
  arms: ["thin_canonical_bounded_evidence_v2_high"],
  source_sha256: { bounded_evidence_v2: "f".repeat(64) }
};
const finisher = {
  fingerprint: sha256(JSON.stringify(finisherContract)),
  contract: finisherContract
};
const parentManifestBase = {
  schema_version: "thin-path-eval-run-manifest-v2",
  fingerprint: sha256(JSON.stringify(contract)),
  contract,
  finisher,
  max_requested_limit: 1
};
const inputRow = {
  asset_id: "asset-a",
  arm: "thin_canonical_bounded_evidence_v2_high",
  image_detail: "high",
  raw_title: fixture,
  reference: "2024 Topps Chrome Player 027/150",
  title: "stale derived title",
  f1: 0,
  latency_ms: 1234,
  input_tokens: 100,
  output_tokens: 50,
  total_tokens: 150,
  cached_input_tokens: 0,
  model: "gpt-5.6-luna",
  served_model: "gpt-5.6-luna-2026-07-01",
  requested_effort: "none",
  served_effort: "none",
  request_sha256: "a".repeat(64),
  image_set_sha256: "b".repeat(64),
  image_count: 2,
  request_attempt_count: 1,
  provider_attempts: [{ attempt: 1, status: "success" }],
  run_fingerprint: parentManifestBase.fingerprint,
  finisher_fingerprint: finisher.fingerprint,
  arm_eval_version: "bounded-evidence-v2",
  started_at: "2026-08-01T00:00:00.000Z",
  completed_at: "2026-08-01T00:00:01.234Z"
};
const inputCheckpointBody = `${JSON.stringify(inputRow)}\n`;
const parentManifest = {
  ...parentManifestBase,
  checkpoint_rows: 1,
  checkpoint_sha256: sha256(inputCheckpointBody)
};
const parentRunManifestBody = `${JSON.stringify(parentManifest, null, 2)}\n`;
const sourceHashes = {
  replay_harness: "1".repeat(64),
  bounded_evidence_v2: "2".repeat(64),
  scorer: "3".repeat(64)
};
const artifacts = buildReplayArtifacts({
  inputCheckpointBody,
  parentRunManifestBody,
  sourceHashes,
  scoreTokenRecall: () => 0.75,
  createdAt: "2026-08-01T01:00:00.000Z"
});

assert.equal(artifacts.rows.length, 1);
assert.equal(artifacts.rows[0].run_fingerprint, parentManifest.fingerprint,
  "replay must retain the paid provider run identity");
assert.equal(artifacts.rows[0].parent_run_fingerprint, parentManifest.fingerprint);
assert.match(artifacts.rows[0].replay_fingerprint, /^[0-9a-f]{64}$/);
assert.match(artifacts.rows[0].title, /027\/150/);
assert.doesNotMatch(artifacts.rows[0].canonical_control_title, /027\/150/);
assert.equal(artifacts.rows[0].latency_ms, inputRow.latency_ms);
assert.equal(artifacts.rows[0].request_sha256, inputRow.request_sha256);
assert.deepEqual(artifacts.rows[0].provider_attempts, inputRow.provider_attempts);
assert.equal(artifacts.rows[0].finisher_fingerprint, inputRow.finisher_fingerprint);
assert.equal(artifacts.rows[0].score, 0.75);
assert.equal(artifacts.replayManifest.note, "zero_cost_deterministic_replay_not_a_provider_run");

const validated = validateReplayArtifacts({
  replayBody: artifacts.outputBody,
  replayManifest: artifacts.replayManifest,
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
});
assert.equal(validated.rows.length, 1);

assert.throws(() => validateReplayArtifacts({
  replayBody: artifacts.outputBody.replace("027/150", "999/999"),
  replayManifest: artifacts.replayManifest,
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
}), /replay_output_hash_mismatch/);

assert.throws(() => validateReplayArtifacts({
  replayBody: artifacts.outputBody,
  replayManifest: artifacts.replayManifest,
  inputCheckpointBody: `${inputCheckpointBody} `,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
}), /replay_input_checkpoint_mismatch/);

assert.throws(() => validateReplayArtifacts({
  replayBody: artifacts.outputBody,
  replayManifest: artifacts.replayManifest,
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: { ...sourceHashes, scorer: "4".repeat(64) },
  scoreTokenRecall: () => 0.75
}), /replay_sources_stale/);

const changedProviderRows = artifacts.rows.map((row) => ({ ...row, input_tokens: 999 }));
const changedProviderBody = `${changedProviderRows.map(JSON.stringify).join("\n")}\n`;
const changedProviderManifest = {
  ...artifacts.replayManifest,
  output_sha256: sha256(changedProviderBody)
};
assert.throws(() => validateReplayArtifacts({
  replayBody: changedProviderBody,
  replayManifest: changedProviderManifest,
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
}), /replay_provider_fields_changed/);

const changedAttemptsRows = artifacts.rows.map((row) => ({
  ...row,
  provider_attempts: [{ attempt: 1, status: "forged" }]
}));
const changedAttemptsBody = `${changedAttemptsRows.map(JSON.stringify).join("\n")}\n`;
assert.throws(() => validateReplayArtifacts({
  replayBody: changedAttemptsBody,
  replayManifest: { ...artifacts.replayManifest, output_sha256: sha256(changedAttemptsBody) },
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
}), /replay_provider_fields_changed/);

const changedUnknownRows = artifacts.rows.map((row) => ({ ...row, future_provider_field: "forged" }));
const changedUnknownBody = `${changedUnknownRows.map(JSON.stringify).join("\n")}\n`;
assert.throws(() => validateReplayArtifacts({
  replayBody: changedUnknownBody,
  replayManifest: { ...artifacts.replayManifest, output_sha256: sha256(changedUnknownBody) },
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
}), /replay_provider_fields_changed/);

const changedDerivedRows = artifacts.rows.map((row) => ({ ...row, title: "forged title" }));
const changedDerivedBody = `${changedDerivedRows.map(JSON.stringify).join("\n")}\n`;
assert.throws(() => validateReplayArtifacts({
  replayBody: changedDerivedBody,
  replayManifest: { ...artifacts.replayManifest, output_sha256: sha256(changedDerivedBody) },
  inputCheckpointBody,
  parentRunManifestBody,
  expectedSourceHashes: sourceHashes,
  scoreTokenRecall: () => 0.75
}), /replay_derived_fields_mismatch/);

console.log("bounded evidence v2 replay tests passed");
