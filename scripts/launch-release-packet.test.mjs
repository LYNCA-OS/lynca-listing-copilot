import assert from "node:assert/strict";
import {
  assessLaunchReleasePacket,
  launchReleaseDimensionWorkflows,
  launchReleasePacketSchemaVersion,
  launchReleasePacketSignerWorkflow,
  launchReleasePacketWorkflowRef,
  releaseReportDigests
} from "../lib/listing/evaluation/launch-release-packet.mjs";

const mainSha = "a".repeat(40);
const deploymentId = "dpl_ExactMain123";
const completedAt = "2026-07-14T00:00:00.000Z";
const bytes = {
  accuracy: Buffer.from('{"accuracy":1}\n'),
  throughput: [100, 500, 1000].map((level) => Buffer.from(`{"throughput":${level}}\n`)),
  reliability: Buffer.from('{"reliability":1}\n'),
  writerJourney: Buffer.from('{"journey":true}\n')
};
const digests = releaseReportDigests({
  accuracyBytes: bytes.accuracy,
  throughputBytes: bytes.throughput,
  reliabilityBytes: bytes.reliability,
  writerJourneyBytes: bytes.writerJourney
});

function provenance(workflowRef, overrides = {}) {
  return {
    repository: "LYNCA-OS/lynca-listing-copilot",
    workflow_ref: workflowRef,
    run_id: "123456789",
    run_attempt: "1",
    event: "workflow_dispatch",
    source_ref: "refs/heads/main",
    git_commit_sha: mainSha,
    deployment_git_commit_sha: mainSha,
    deployment_id: deploymentId,
    production_base_url: "https://listing.lyncafei.team",
    completed_at: completedAt,
    ...overrides
  };
}

function packet(overrides = {}) {
  return {
    schema_version: launchReleasePacketSchemaVersion,
    ...provenance(launchReleasePacketWorkflowRef, { created_at: completedAt }),
    dimensions: {
      accuracy: {
        artifacts: [{ id: "accuracy", sha256: digests.accuracy.accuracy }],
        provenance: provenance(launchReleaseDimensionWorkflows.accuracy)
      },
      throughput: {
        artifacts: [100, 500, 1000].map((level) => ({
          id: `throughput_${level}`,
          sha256: digests.throughput[`throughput_${level}`]
        })),
        provenance: provenance(launchReleaseDimensionWorkflows.throughput)
      },
      reliability: {
        artifacts: [{ id: "reliability", sha256: digests.reliability.reliability }],
        provenance: provenance(launchReleaseDimensionWorkflows.reliability)
      },
      writer_journey: {
        artifacts: [{ id: "writer_journey", sha256: digests.writer_journey.writer_journey }],
        provenance: provenance(launchReleaseDimensionWorkflows.writer_journey)
      }
    },
    ...overrides
  };
}

const liveReleaseProvenance = {
  verified: true,
  repository: "LYNCA-OS/lynca-listing-copilot",
  main_git_sha: mainSha,
  deployment_git_sha: mainSha,
  deployment_id: deploymentId,
  production_base_url: "https://listing.lyncafei.team",
  checked_at: "2026-07-14T00:01:00.000Z"
};
const attestationVerification = {
  verified: true,
  repository: "LYNCA-OS/lynca-listing-copilot",
  signer_workflow: launchReleasePacketSignerWorkflow,
  source_ref: "refs/heads/main",
  source_digest: mainSha,
  denied_self_hosted_runners: true,
  verified_attestation_count: 1
};
const writerJourneyReport = {
  repository: "LYNCA-OS/lynca-listing-copilot",
  workflow_ref: launchReleaseDimensionWorkflows.writer_journey,
  run_id: "123456789",
  run_attempt: "1",
  event: "workflow_dispatch",
  source_ref: "refs/heads/main",
  production_base_url: "https://listing.lyncafei.team",
  expected_git_commit_sha: mainSha,
  deployment_git_commit_sha: mainSha,
  deployment_id: deploymentId,
  finished_at: completedAt
};

function assess(overrides = {}) {
  return assessLaunchReleasePacket({
    packet: packet(),
    reportDigests: digests,
    liveReleaseProvenance,
    attestationVerification,
    writerJourneyReport,
    ...overrides
  });
}

const valid = assess();
assert.equal(valid.verdict, "PASS");
for (const dimension of Object.keys(valid.dimensions)) assert.equal(valid.dimensions[dimension].verdict, "PASS");

const missingPacket = assess({ packet: {}, attestationVerification: {} });
assert.equal(missingPacket.verdict, "INCONCLUSIVE");
assert.ok(missingPacket.evidence_shortfall_reasons.includes("ATTESTED_RELEASE_PACKET_V1_REQUIRED"));
assert.ok(missingPacket.evidence_shortfall_reasons.includes("RELEASE_PACKET_ATTESTATION_REQUIRED"));

const forgedAccuracy = packet();
forgedAccuracy.dimensions.accuracy.artifacts[0].sha256 = "f".repeat(64);
const digestMismatch = assess({ packet: forgedAccuracy });
assert.equal(digestMismatch.verdict, "FAIL");
assert.ok(digestMismatch.dimensions.accuracy.failure_reasons.includes("RELEASE_ACCURACY_DIGEST_MISMATCH"));

const oldRelease = packet({ git_commit_sha: "b".repeat(40) });
const oldReleaseResult = assess({ packet: oldRelease });
assert.equal(oldReleaseResult.verdict, "FAIL");
assert.ok(oldReleaseResult.failure_reasons.includes("RELEASE_PACKET_MAIN_SHA_MISMATCH"));

const liveDeploymentDrift = assess({
  liveReleaseProvenance: { ...liveReleaseProvenance, deployment_git_sha: "b".repeat(40) }
});
assert.equal(liveDeploymentDrift.verdict, "FAIL");
assert.ok(liveDeploymentDrift.failure_reasons.includes("LIVE_MAIN_AND_PRODUCTION_SHA_MISMATCH"));

const wrongProducer = packet();
wrongProducer.dimensions.accuracy.provenance.workflow_ref = "LYNCA-OS/lynca-listing-copilot/.github/workflows/untrusted.yml@refs/heads/main";
const wrongProducerResult = assess({ packet: wrongProducer });
assert.equal(wrongProducerResult.verdict, "INCONCLUSIVE");
assert.ok(wrongProducerResult.dimensions.accuracy.evidence_shortfall_reasons.includes("RELEASE_ACCURACY_WORKFLOW_PROVENANCE_REQUIRED"));

const splitPerformanceRuns = packet();
splitPerformanceRuns.dimensions.reliability.provenance.run_id = "987654321";
const splitPerformanceResult = assess({ packet: splitPerformanceRuns });
assert.equal(splitPerformanceResult.verdict, "FAIL");
assert.ok(splitPerformanceResult.failure_reasons.includes("RELEASE_PERFORMANCE_RUN_PROVENANCE_MISMATCH"));

const forgedJourneyProvenance = packet();
forgedJourneyProvenance.dimensions.writer_journey.provenance.run_attempt = "2";
const forgedJourneyResult = assess({ packet: forgedJourneyProvenance });
assert.equal(forgedJourneyResult.verdict, "FAIL");
assert.ok(forgedJourneyResult.failure_reasons.includes("RELEASE_WRITER_JOURNEY_PROVENANCE_MISMATCH"));

const selfHostedNotDenied = assess({
  attestationVerification: { ...attestationVerification, denied_self_hosted_runners: false }
});
assert.equal(selfHostedNotDenied.verdict, "INCONCLUSIVE");
assert.ok(selfHostedNotDenied.evidence_shortfall_reasons.includes("RELEASE_PACKET_ATTESTATION_PROVENANCE_REQUIRED"));

for (const mutate of [
  (candidate) => { candidate.deployment_id = { toString: () => deploymentId }; },
  (candidate) => { candidate.dimensions.accuracy.provenance.run_id = 123456789; },
  (candidate) => { candidate.dimensions.reliability.provenance.source_ref = "refs/heads/feature"; }
]) {
  const malformed = packet();
  mutate(malformed);
  assert.notEqual(assess({ packet: malformed }).verdict, "PASS", "typed or off-main provenance must fail closed");
}

console.log("launch release packet tests passed");
