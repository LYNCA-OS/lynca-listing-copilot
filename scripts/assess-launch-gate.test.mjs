import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchLiveReleaseProvenance,
  main,
  parseAttestationVerificationOutput,
  productionHealthUrl,
  productionMainApiUrl,
  verifyWriterJourneyAttestation
} from "./assess-launch-gate.mjs";
import {
  assessLaunchAccuracy,
  launchThroughputCheckpointSchemaVersion
} from "../lib/listing/evaluation/launch-benchmark.mjs";
import {
  launchReleaseDimensionWorkflows,
  launchReleasePacketSchemaVersion,
  launchReleasePacketWorkflowRef,
  releaseReportDigests
} from "../lib/listing/evaluation/launch-release-packet.mjs";

const sha = "a".repeat(40);
const pipelineFingerprint = "3".repeat(64);
const catalogRevision = "catalog-snapshot-1";
const deploymentId = "dpl_ExactMain123";
const now = () => new Date("2026-07-14T00:01:00.000Z");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function liveFetch(url) {
  if (url === productionMainApiUrl) return jsonResponse({ sha });
  if (url === productionHealthUrl) {
    return jsonResponse({
      deployment: { git_commit_sha: sha, deployment_id: deploymentId },
      recognition_pipeline_fingerprint: pipelineFingerprint,
      active_catalog_snapshot_revision: catalogRevision
    });
  }
  throw new Error(`unexpected URL: ${url}`);
}

function attestationOutput() {
  return JSON.stringify([{
    attestation: { bundle: true },
    verificationResult: {
      signature: { certificate: { subjectAlternativeName: "trusted" } },
      verifiedTimestamps: [{ type: "transparency-log" }],
      statement: { subject: [{ name: "evidence.json", digest: { sha256: "f".repeat(64) } }] }
    }
  }]);
}

const requestedUrls = [];
const live = await fetchLiveReleaseProvenance({
  fetchImpl: async (url, options) => {
    requestedUrls.push([url, options]);
    return liveFetch(url);
  },
  now,
  env: {}
});
assert.deepEqual(requestedUrls.map(([url]) => url), [productionMainApiUrl, productionHealthUrl]);
assert.equal(live.verified, true);
assert.equal(live.main_git_sha, sha);
assert.equal(live.deployment_git_sha, sha);
assert.equal(live.deployment_id, deploymentId);
assert.equal(live.recognition_pipeline_fingerprint, pipelineFingerprint);
assert.equal(live.active_catalog_snapshot_revision, catalogRevision);
assert.equal(live.production_base_url, "https://listing.lyncafei.team");

let verifiedCommand = null;
let temporaryEvidencePath = "";
const immutableEvidenceBytes = Buffer.from('{"immutable":true}\n');
const attestation = await verifyWriterJourneyAttestation({
  evidenceBytes: immutableEvidenceBytes,
  liveMainGitSha: sha,
  runCommand: async (command, args) => {
    verifiedCommand = [command, args];
    temporaryEvidencePath = args[2];
    assert.deepEqual(await readFile(temporaryEvidencePath), immutableEvidenceBytes);
    return { stdout: attestationOutput() };
  }
});
assert.equal(attestation.verified, true);
assert.equal(attestation.verified_attestation_count, 1);
assert.equal(attestation.denied_self_hosted_runners, true);
assert.equal(verifiedCommand[0], "gh");
assert.deepEqual(verifiedCommand[1], [
  "attestation",
  "verify",
  temporaryEvidencePath,
  "--repo",
  "LYNCA-OS/lynca-listing-copilot",
  "--signer-workflow",
  "LYNCA-OS/lynca-listing-copilot/.github/workflows/production-writer-journey.yml",
  "--source-ref",
  "refs/heads/main",
  "--source-digest",
  sha,
  "--deny-self-hosted-runners",
  "--format",
  "json"
]);
await assert.rejects(() => access(temporaryEvidencePath), /ENOENT/);
assert.throws(() => parseAttestationVerificationOutput("[]"), /no verified attestations/);
assert.throws(() => parseAttestationVerificationOutput("not-json"), /did not return JSON/);
assert.throws(() => parseAttestationVerificationOutput(JSON.stringify([{
  verificationResult: { signature: { certificate: {} }, verifiedTimestamps: [], statement: { subject: [] } }
}])), /structurally incomplete/);

function accuracyReport() {
  return {
    schema_version: "golden-sem-accuracy-report-v1",
    status: "COMPLETED",
    source: {
      partition: "holdout",
      dataset_schema_version: "release-set-v1",
      set_type: "CORE_HOLDOUT",
      field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH",
      predictions_schema_version: "golden-sem-prediction-run-v1",
      release_set_validation_ok: true,
      release_set_digest_schema_version: "release-set-content-digest-v2",
      release_set_item_set_sha256: "1".repeat(64),
      prediction_digest_schema_version: "canonical-json-sha256-v1",
      prediction_content_sha256: "2".repeat(64),
      deployment_git_commit_sha: sha,
      recognition_pipeline_fingerprint: "3".repeat(64),
      catalog_snapshot_revision: "catalog-snapshot-1",
      prediction_row_count: 45,
      prediction_rows_version_bound: true,
      prediction_item_ids_unique: true,
      prediction_exact_item_set_match: true
    },
    scope: {
      reviewed_ground_truth_only: true,
      formal_golden_sem: true,
      explicit_evaluation_truth_policy: true,
      launch_gate_eligible: true,
      writer_title_used_as_field_ground_truth: false,
      prediction_run_provenance_complete: true,
      renderer_replay_inputs_complete: true
    },
    summary: {
      label_item_count: 45,
      evaluated_card_count: 45,
      matched_prediction_count: 45,
      independent_identity_group_count: 45,
      launch_field_contract_covered_count: 45,
      critical_identity_covered_count: 45
    },
    metrics: {
      sem_card_exact_accuracy: { correct: 40, total: 45, rate: 0.888889 },
      critical_overclaim_count: 0,
      critical_fabrication_count: 0,
      catastrophic_title_count: 0,
      renderer_fidelity: { correct: 45, total: 45, rate: 1 },
      title_critical_fidelity: { correct: 45, total: 45, rate: 1 }
    }
  };
}

assert.equal(assessLaunchAccuracy(accuracyReport()).verdict, "PASS");
const thinAccuracyReport = accuracyReport();
thinAccuracyReport.summary.launch_field_contract_covered_count = 1;
thinAccuracyReport.summary.critical_identity_covered_count = 0;
assert.equal(assessLaunchAccuracy(thinAccuracyReport).verdict, "INCONCLUSIVE");
assert.ok(assessLaunchAccuracy(thinAccuracyReport).evidence_shortfall_reasons.includes(
  "FORMAL_LAUNCH_FIELD_COVERAGE_INCOMPLETE"
));
const duplicatePredictionAccuracyReport = accuracyReport();
duplicatePredictionAccuracyReport.source.prediction_item_ids_unique = false;
duplicatePredictionAccuracyReport.source.prediction_exact_item_set_match = false;
assert.equal(assessLaunchAccuracy(duplicatePredictionAccuracyReport).verdict, "INCONCLUSIVE");
const duplicateIdentityAccuracyReport = accuracyReport();
duplicateIdentityAccuracyReport.summary.independent_identity_group_count = 1;
assert.equal(assessLaunchAccuracy(duplicateIdentityAccuracyReport).verdict, "INCONCLUSIVE");
const fabricatedRendererAccuracyReport = accuracyReport();
fabricatedRendererAccuracyReport.metrics.renderer_fidelity = { correct: 44, total: 45, rate: 0.977778 };
assert.equal(assessLaunchAccuracy(fabricatedRendererAccuracyReport).verdict, "FAIL");
assert.ok(assessLaunchAccuracy(fabricatedRendererAccuracyReport).failure_reasons.includes(
  "RENDERER_FIDELITY_BELOW_100_PERCENT"
));

function throughputReport(level) {
  return {
    schema_version: launchThroughputCheckpointSchemaVersion,
    benchmark_level: level,
    summary: { attempted_count: level, ok_count: level, completed_cards_per_minute: 6.2 },
    stability_envelope: { aggregate: { technical_availability: 1 } }
  };
}

function reliabilityReport() {
  return {
    schema_version: "v4-multi-tenant-soak-v1",
    tenant_count: 3,
    summary: {
      attempted_count: 1000,
      ok_count: 1000,
      production_integrity: {
        tenant_count: 3,
        duplicate_job_id_count: 0,
        duplicate_asset_id_count: 0,
        missing_job_id_count: 0,
        successful_nonterminal_job_count: 0,
        tenant_isolation_measured_count: 1000,
        tenant_isolation_violation_count: 0
      }
    },
    stability_envelope: {
      schema_version: "v4-stability-envelope-v1",
      verdict: "PASS",
      aggregate: {
        attempted_count: 1000,
        completed_count: 1000,
        tenant_count: 3,
        technical_availability: 1,
        residual_backlog_count: 0
      },
      evidence_shortfall_reasons: [],
      runtime_rejection_reasons: [],
      warning_reasons: []
    }
  };
}

function journeyReport() {
  const stageIds = ["health", "real_image_materialization", "login", "upload", "enqueue", "status", "l2_ready", "accept_edit", "persistence"];
  return {
    schema_version: "production-writer-journey-evidence-v3",
    passed: true,
    launch_ready_mutated: false,
    repository: "LYNCA-OS/lynca-listing-copilot",
    workflow_ref: "LYNCA-OS/lynca-listing-copilot/.github/workflows/production-writer-journey.yml@refs/heads/main",
    run_id: "123456789",
    run_attempt: "1",
    event: "workflow_run",
    source_ref: "refs/heads/main",
    production_base_url: "https://listing.lyncafei.team",
    deployment_id: deploymentId,
    finished_at: "2026-07-14T00:00:00.000Z",
    expected_git_commit_sha: sha,
    deployment_git_commit_sha: sha,
    exact_sha_match: true,
    required_stage_ids: stageIds,
    all_required_stages_passed: true,
    request_ids: ["request_1"],
    asset_ids: ["asset_1"],
    batch_ids: ["batch_1"],
    job_ids: ["job_1"],
    session_ids: ["session_1"],
    stages: Object.fromEntries(stageIds.map((stage) => [stage, { passed: true }])),
    artifact_safety: {
      safe_to_upload: true,
      har_uploaded: false,
      trace_uploaded: false,
      sensitive_value_scan_passed: true,
      storage_state_persisted: false,
      login_screenshot_recorded: false,
      screenshot_sensitive_controls_masked: true
    }
  };
}

function releaseProvenance(workflowRef, overrides = {}) {
  return {
    repository: "LYNCA-OS/lynca-listing-copilot",
    workflow_ref: workflowRef,
    run_id: "123456789",
    run_attempt: "1",
    event: "workflow_dispatch",
    source_ref: "refs/heads/main",
    git_commit_sha: sha,
    deployment_git_commit_sha: sha,
    deployment_id: deploymentId,
    production_base_url: "https://listing.lyncafei.team",
    completed_at: "2026-07-14T00:00:00.000Z",
    ...overrides
  };
}

function releasePacket(digests) {
  return {
    schema_version: launchReleasePacketSchemaVersion,
    ...releaseProvenance(launchReleasePacketWorkflowRef, { created_at: "2026-07-14T00:00:00.000Z" }),
    dimensions: {
      accuracy: {
        artifacts: [{ id: "accuracy", sha256: digests.accuracy.accuracy }],
        provenance: releaseProvenance(launchReleaseDimensionWorkflows.accuracy)
      },
      throughput: {
        artifacts: [100, 500, 1000].map((level) => ({
          id: `throughput_${level}`,
          sha256: digests.throughput[`throughput_${level}`]
        })),
        provenance: releaseProvenance(launchReleaseDimensionWorkflows.throughput)
      },
      reliability: {
        artifacts: [{ id: "reliability", sha256: digests.reliability.reliability }],
        provenance: releaseProvenance(launchReleaseDimensionWorkflows.reliability)
      },
      writer_journey: {
        artifacts: [{ id: "writer_journey", sha256: digests.writer_journey.writer_journey }],
        provenance: releaseProvenance(launchReleaseDimensionWorkflows.writer_journey, {
          event: "workflow_run"
        })
      }
    }
  };
}

const directory = await mkdtemp(join(tmpdir(), "lynca-launch-attestation-"));
try {
  const paths = {
    accuracy: join(directory, "accuracy.json"),
    reliability: join(directory, "reliability.json"),
    journey: join(directory, "journey.json"),
    releasePacket: join(directory, "release-packet.json"),
    output: join(directory, "gate.json"),
    throughput: [100, 500, 1000].map((level) => join(directory, `throughput-${level}.json`))
  };
  const raw = {
    accuracy: Buffer.from(JSON.stringify(accuracyReport())),
    reliability: Buffer.from(JSON.stringify(reliabilityReport())),
    journey: Buffer.from(JSON.stringify(journeyReport())),
    throughput: [100, 500, 1000].map((level) => Buffer.from(JSON.stringify(throughputReport(level))))
  };
  const digests = releaseReportDigests({
    accuracyBytes: raw.accuracy,
    throughputBytes: raw.throughput,
    reliabilityBytes: raw.reliability,
    writerJourneyBytes: raw.journey
  });
  await Promise.all([
    writeFile(paths.accuracy, raw.accuracy),
    writeFile(paths.reliability, raw.reliability),
    writeFile(paths.journey, raw.journey),
    writeFile(paths.releasePacket, JSON.stringify(releasePacket(digests))),
    ...paths.throughput.map((path, index) => writeFile(path, raw.throughput[index]))
  ]);
  const argv = [
    "--accuracy", paths.accuracy,
    ...paths.throughput.flatMap((path) => ["--throughput", path]),
    "--reliability", paths.reliability,
    "--writer-journey", paths.journey,
    "--release-packet", paths.releasePacket,
    "--out", paths.output
  ];
  const code = await main(argv, {
    fetchImpl: liveFetch,
    runCommand: async () => ({ stdout: attestationOutput() }),
    now,
    env: {}
  });
  assert.equal(code, 0);
  const report = JSON.parse(await readFile(paths.output, "utf8"));
  assert.equal(report.launch_ready, true);
  assert.equal(report.dimensions.writer_journey.provenance.artifact_attestation_verified, true);
  assert.equal(report.release_evidence.verdict, "PASS");

  for (const [label, schemaVersion] of [
    ["missing", undefined],
    ["wrong", "v4-multi-tenant-soak-v1"]
  ]) {
    const invalidReport = throughputReport(100);
    if (schemaVersion === undefined) delete invalidReport.schema_version;
    else invalidReport.schema_version = schemaVersion;
    const invalidThroughputBytes = [
      Buffer.from(JSON.stringify(invalidReport)),
      raw.throughput[1],
      raw.throughput[2]
    ];
    const invalidDigests = releaseReportDigests({
      accuracyBytes: raw.accuracy,
      throughputBytes: invalidThroughputBytes,
      reliabilityBytes: raw.reliability,
      writerJourneyBytes: raw.journey
    });
    await Promise.all([
      writeFile(paths.throughput[0], invalidThroughputBytes[0]),
      writeFile(paths.releasePacket, JSON.stringify(releasePacket(invalidDigests)))
    ]);
    const invalidSchemaCode = await main(argv, {
      fetchImpl: liveFetch,
      runCommand: async () => ({ stdout: attestationOutput() }),
      now,
      env: {}
    });
    assert.equal(invalidSchemaCode, 1, `${label} throughput checkpoint schema must fail closed`);
    const invalidSchemaGate = JSON.parse(await readFile(paths.output, "utf8"));
    assert.equal(invalidSchemaGate.launch_ready, false);
    assert.equal(invalidSchemaGate.dimensions.throughput.verdict, "INCONCLUSIVE");
    assert.ok(
      invalidSchemaGate.dimensions.throughput.evidence_shortfall_reasons
        .includes("THROUGHPUT_100_CHECKPOINT_V1_REQUIRED")
    );
    assert.equal(
      invalidSchemaGate.release_evidence.dimensions.throughput.verdict,
      "PASS",
      "schema rejection must come from the throughput consumer, not a digest mismatch"
    );
  }
  await Promise.all([
    writeFile(paths.throughput[0], raw.throughput[0]),
    writeFile(paths.releasePacket, JSON.stringify(releasePacket(digests)))
  ]);

  const verifiedTemporaryPaths = [];
  const toctouCode = await main(argv, {
    fetchImpl: liveFetch,
    runCommand: async (_command, args) => {
      verifiedTemporaryPaths.push(args[2]);
      assert.notEqual(args[2], paths.journey);
      const signer = args[args.indexOf("--signer-workflow") + 1];
      if (signer.endsWith("production-writer-journey.yml")) {
        assert.deepEqual(await readFile(args[2]), raw.journey);
        await writeFile(paths.journey, JSON.stringify({ passed: false, forged_after_verify_started: true }));
      }
      return { stdout: attestationOutput() };
    },
    now,
    env: {}
  });
  assert.equal(toctouCode, 0, "source-path mutation must not change the one-read attested snapshot");
  for (const temporaryPath of verifiedTemporaryPaths) await assert.rejects(() => access(temporaryPath), /ENOENT/);
  await writeFile(paths.journey, raw.journey);

  const unattestedCode = await main(argv, {
    fetchImpl: liveFetch,
    runCommand: async () => { throw new Error("no attestation"); },
    now,
    env: {}
  });
  assert.equal(unattestedCode, 1);
  const unattested = JSON.parse(await readFile(paths.output, "utf8"));
  assert.equal(unattested.launch_ready, false);
  assert.ok(unattested.dimensions.writer_journey.evidence_shortfall_reasons.includes("WRITER_JOURNEY_ARTIFACT_ATTESTATION_REQUIRED"));

  const withoutPacketArgs = argv.filter((value, index) => (
    value !== "--release-packet" && argv[index - 1] !== "--release-packet"
  ));
  const noPacketCode = await main(withoutPacketArgs, {
    fetchImpl: liveFetch,
    runCommand: async () => ({ stdout: attestationOutput() }),
    now,
    env: {}
  });
  assert.equal(noPacketCode, 1);
  const noPacket = JSON.parse(await readFile(paths.output, "utf8"));
  assert.equal(noPacket.launch_ready, false);
  for (const dimension of ["accuracy", "throughput", "reliability", "writer_journey"]) {
    assert.ok(noPacket.dimensions[dimension].evidence_shortfall_reasons.includes("ATTESTED_RELEASE_PACKET_V1_REQUIRED"));
  }

  await assert.rejects(
    () => main([...argv, "--expected-git-sha", sha], { fetchImpl: liveFetch, now, env: {} }),
    /caller-supplied release identity is forbidden/
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("launch gate attestation and live provenance tests passed");
