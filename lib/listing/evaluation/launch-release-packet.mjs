import { createHash } from "node:crypto";

export const launchReleasePacketSchemaVersion = "launch-release-evidence-packet-v1";
export const launchReleaseRepository = "LYNCA-OS/lynca-listing-copilot";
export const launchReleaseSourceRef = "refs/heads/main";
export const launchReleaseBaseUrl = "https://listing.lyncafei.team";
export const launchReleasePacketSignerWorkflow = `${launchReleaseRepository}/.github/workflows/launch-release-packet.yml`;
export const launchReleasePacketWorkflowRef = `${launchReleasePacketSignerWorkflow}@${launchReleaseSourceRef}`;
export const launchReleaseDimensionWorkflows = Object.freeze({
  accuracy: `${launchReleaseRepository}/.github/workflows/launch-sem-accuracy.yml@${launchReleaseSourceRef}`,
  throughput: `${launchReleaseRepository}/.github/workflows/launch-performance-benchmark.yml@${launchReleaseSourceRef}`,
  reliability: `${launchReleaseRepository}/.github/workflows/launch-performance-benchmark.yml@${launchReleaseSourceRef}`,
  writer_journey: `${launchReleaseRepository}/.github/workflows/production-writer-journey.yml@${launchReleaseSourceRef}`
});

const requiredArtifacts = Object.freeze({
  accuracy: ["accuracy"],
  throughput: ["throughput_100", "throughput_500", "throughput_1000"],
  reliability: ["reliability"],
  writer_journey: ["writer_journey"]
});

function exactPrintable(value, pattern = null) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || !value
    || value.length > 512
    || /[^\x20-\x7e]/.test(value)
  ) return null;
  return !pattern || pattern.test(value) ? value : null;
}

function exactGitSha(value) {
  const text = exactPrintable(value, /^[0-9a-fA-F]{40}$/);
  return text ? text.toLowerCase() : null;
}

function exactDeploymentId(value) {
  return exactPrintable(value, /^dpl_[A-Za-z0-9]+$/);
}

function exactSha256(value) {
  const text = exactPrintable(value, /^[0-9a-fA-F]{64}$/);
  return text ? text.toLowerCase() : null;
}

function canonicalTime(value) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return { value, milliseconds };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function verdict(failures, shortfalls) {
  if (failures.length) return "FAIL";
  if (shortfalls.length) return "INCONCLUSIVE";
  return "PASS";
}

export function sha256Bytes(bytes) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
    throw new TypeError("release evidence must be supplied as bytes");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

export function releaseReportDigests({ accuracyBytes, throughputBytes = [], reliabilityBytes, writerJourneyBytes } = {}) {
  return {
    accuracy: accuracyBytes ? { accuracy: sha256Bytes(accuracyBytes) } : {},
    throughput: Object.fromEntries((Array.isArray(throughputBytes) ? throughputBytes : []).map((bytes, index) => (
      [`throughput_${[100, 500, 1000][index] ?? `unexpected_${index}`}`, sha256Bytes(bytes)]
    ))),
    reliability: reliabilityBytes ? { reliability: sha256Bytes(reliabilityBytes) } : {},
    writer_journey: writerJourneyBytes ? { writer_journey: sha256Bytes(writerJourneyBytes) } : {}
  };
}

function assessPacketProvenance(provenance, {
  expectedWorkflowRef,
  liveReleaseProvenance,
  maximumAgeMs,
  checkedAtMs,
  prefix
}) {
  const failures = [];
  const shortfalls = [];
  const repository = exactPrintable(provenance?.repository);
  const workflowRef = exactPrintable(provenance?.workflow_ref);
  const runId = exactPrintable(provenance?.run_id, /^[1-9][0-9]*$/);
  const runAttempt = exactPrintable(provenance?.run_attempt, /^[1-9][0-9]*$/);
  const event = exactPrintable(provenance?.event, /^(workflow_run|workflow_dispatch)$/);
  const sourceRef = exactPrintable(provenance?.source_ref);
  const gitSha = exactGitSha(provenance?.git_commit_sha);
  const deploymentSha = exactGitSha(provenance?.deployment_git_commit_sha);
  const deploymentId = exactDeploymentId(provenance?.deployment_id);
  const baseUrl = exactPrintable(provenance?.production_base_url);
  const completedAt = canonicalTime(provenance?.completed_at ?? provenance?.created_at);
  const liveSha = exactGitSha(liveReleaseProvenance?.main_git_sha);
  const liveDeploymentSha = exactGitSha(liveReleaseProvenance?.deployment_git_sha);
  const liveDeploymentId = exactDeploymentId(liveReleaseProvenance?.deployment_id);

  if (repository !== launchReleaseRepository) shortfalls.push(`${prefix}_REPOSITORY_PROVENANCE_REQUIRED`);
  if (workflowRef !== expectedWorkflowRef) shortfalls.push(`${prefix}_WORKFLOW_PROVENANCE_REQUIRED`);
  if (!runId || !runAttempt || !event) shortfalls.push(`${prefix}_RUN_PROVENANCE_REQUIRED`);
  if (sourceRef !== launchReleaseSourceRef) shortfalls.push(`${prefix}_SOURCE_REF_REQUIRED`);
  if (!gitSha || !deploymentSha || !deploymentId) shortfalls.push(`${prefix}_RELEASE_IDENTITY_REQUIRED`);
  if (baseUrl !== launchReleaseBaseUrl) shortfalls.push(`${prefix}_PRODUCTION_BASE_URL_REQUIRED`);
  if (!completedAt) shortfalls.push(`${prefix}_COMPLETED_AT_REQUIRED`);
  else if (
    !Number.isFinite(checkedAtMs)
    || completedAt.milliseconds > checkedAtMs + 60_000
    || checkedAtMs - completedAt.milliseconds > maximumAgeMs
  ) failures.push(`${prefix}_EVIDENCE_STALE_OR_FUTURE`);
  if (gitSha && liveSha && gitSha !== liveSha) failures.push(`${prefix}_MAIN_SHA_MISMATCH`);
  if (deploymentSha && liveDeploymentSha && deploymentSha !== liveDeploymentSha) {
    failures.push(`${prefix}_DEPLOYMENT_SHA_MISMATCH`);
  }
  if (deploymentId && liveDeploymentId && deploymentId !== liveDeploymentId) {
    failures.push(`${prefix}_DEPLOYMENT_ID_MISMATCH`);
  }
  return { failures, shortfalls };
}

export function assessLaunchReleasePacket({
  packet = {},
  reportDigests = {},
  liveReleaseProvenance = {},
  attestationVerification = {},
  writerJourneyReport = {},
  maximumAgeMs = 24 * 60 * 60 * 1000
} = {}) {
  const failures = [];
  const shortfalls = [];
  const checkedAt = canonicalTime(liveReleaseProvenance?.checked_at);
  const checkedAtMs = checkedAt?.milliseconds ?? Number.NaN;
  const liveMainSha = exactGitSha(liveReleaseProvenance?.main_git_sha);
  const liveDeploymentSha = exactGitSha(liveReleaseProvenance?.deployment_git_sha);
  const liveDeploymentId = exactDeploymentId(liveReleaseProvenance?.deployment_id);
  const liveRepository = exactPrintable(liveReleaseProvenance?.repository);
  const liveBaseUrl = exactPrintable(liveReleaseProvenance?.production_base_url);
  const attestedDigest = exactGitSha(attestationVerification?.source_digest);
  const dimensionResults = {};

  if (packet.schema_version !== launchReleasePacketSchemaVersion) {
    shortfalls.push("ATTESTED_RELEASE_PACKET_V1_REQUIRED");
  }
  if (
    liveReleaseProvenance?.verified !== true
    || !checkedAt
    || !liveMainSha
    || !liveDeploymentSha
    || !liveDeploymentId
    || liveRepository !== launchReleaseRepository
    || liveBaseUrl !== launchReleaseBaseUrl
  ) {
    shortfalls.push("LIVE_RELEASE_PROVENANCE_REQUIRED");
  }
  if (liveMainSha && liveDeploymentSha && liveMainSha !== liveDeploymentSha) {
    failures.push("LIVE_MAIN_AND_PRODUCTION_SHA_MISMATCH");
  }
  if (attestationVerification?.verified !== true) shortfalls.push("RELEASE_PACKET_ATTESTATION_REQUIRED");
  if (
    attestationVerification?.repository !== launchReleaseRepository
    || attestationVerification?.signer_workflow !== launchReleasePacketSignerWorkflow
    || attestationVerification?.source_ref !== launchReleaseSourceRef
    || attestationVerification?.denied_self_hosted_runners !== true
    || !Number.isInteger(attestationVerification?.verified_attestation_count)
    || attestationVerification.verified_attestation_count < 1
  ) shortfalls.push("RELEASE_PACKET_ATTESTATION_PROVENANCE_REQUIRED");
  if (!attestedDigest) shortfalls.push("RELEASE_PACKET_ATTESTED_SOURCE_DIGEST_REQUIRED");
  else if (liveMainSha && attestedDigest !== liveMainSha) failures.push("RELEASE_PACKET_ATTESTED_SOURCE_DIGEST_MISMATCH");

  const packetProvenance = assessPacketProvenance(packet, {
    expectedWorkflowRef: launchReleasePacketWorkflowRef,
    liveReleaseProvenance,
    maximumAgeMs,
    checkedAtMs,
    prefix: "RELEASE_PACKET"
  });
  failures.push(...packetProvenance.failures);
  shortfalls.push(...packetProvenance.shortfalls);
  if (
    !packet.dimensions
    || typeof packet.dimensions !== "object"
    || Array.isArray(packet.dimensions)
    || Object.keys(packet.dimensions).sort().join(",") !== Object.keys(requiredArtifacts).sort().join(",")
  ) shortfalls.push("RELEASE_PACKET_DIMENSION_CONTRACT_REQUIRED");

  for (const dimension of Object.keys(requiredArtifacts)) {
    const dimensionFailures = [];
    const dimensionShortfalls = [];
    const record = packet?.dimensions?.[dimension];
    const provenanceResult = assessPacketProvenance(record?.provenance, {
      expectedWorkflowRef: launchReleaseDimensionWorkflows[dimension],
      liveReleaseProvenance,
      maximumAgeMs,
      checkedAtMs,
      prefix: `RELEASE_${dimension.toUpperCase()}`
    });
    dimensionFailures.push(...provenanceResult.failures);
    dimensionShortfalls.push(...provenanceResult.shortfalls);
    const artifacts = Array.isArray(record?.artifacts) ? record.artifacts : [];
    const expectedIds = requiredArtifacts[dimension];
    if (
      artifacts.length !== expectedIds.length
      || artifacts.some((artifact, index) => artifact?.id !== expectedIds[index])
    ) {
      dimensionShortfalls.push(`RELEASE_${dimension.toUpperCase()}_ARTIFACT_CONTRACT_REQUIRED`);
    } else {
      for (const artifact of artifacts) {
        const signedDigest = exactSha256(artifact?.sha256);
        const observedDigest = exactSha256(reportDigests?.[dimension]?.[artifact.id]);
        if (!signedDigest || !observedDigest) {
          dimensionShortfalls.push(`RELEASE_${dimension.toUpperCase()}_DIGEST_REQUIRED`);
        } else if (signedDigest !== observedDigest) {
          dimensionFailures.push(`RELEASE_${dimension.toUpperCase()}_DIGEST_MISMATCH`);
        }
      }
    }
    if (dimension === "writer_journey" && record?.provenance && typeof record.provenance === "object") {
      for (const [field, packetField] of [
        ["repository", "repository"],
        ["workflow_ref", "workflow_ref"],
        ["run_id", "run_id"],
        ["run_attempt", "run_attempt"],
        ["event", "event"],
        ["source_ref", "source_ref"],
        ["production_base_url", "production_base_url"],
        ["expected_git_commit_sha", "git_commit_sha"],
        ["deployment_git_commit_sha", "deployment_git_commit_sha"],
        ["deployment_id", "deployment_id"],
        ["finished_at", "completed_at"]
      ]) {
        if (typeof writerJourneyReport?.[field] !== "string" || writerJourneyReport[field] !== record?.provenance?.[packetField]) {
          dimensionFailures.push("RELEASE_WRITER_JOURNEY_PROVENANCE_MISMATCH");
          break;
        }
      }
    }
    const inheritedFailures = [...failures];
    const inheritedShortfalls = [...shortfalls];
    const allFailures = unique([...inheritedFailures, ...dimensionFailures]);
    const allShortfalls = unique([...inheritedShortfalls, ...dimensionShortfalls]);
    dimensionResults[dimension] = {
      verdict: verdict(allFailures, allShortfalls),
      pass: !allFailures.length && !allShortfalls.length,
      failure_reasons: allFailures,
      evidence_shortfall_reasons: allShortfalls
    };
  }

  const throughputProvenance = packet?.dimensions?.throughput?.provenance;
  const reliabilityProvenance = packet?.dimensions?.reliability?.provenance;
  if (
    typeof throughputProvenance?.run_id === "string"
    && typeof reliabilityProvenance?.run_id === "string"
    && (
      throughputProvenance.run_id !== reliabilityProvenance.run_id
      || throughputProvenance.run_attempt !== reliabilityProvenance.run_attempt
    )
  ) {
    for (const dimension of ["throughput", "reliability"]) {
      dimensionResults[dimension].failure_reasons = unique([
        ...dimensionResults[dimension].failure_reasons,
        "RELEASE_PERFORMANCE_RUN_PROVENANCE_MISMATCH"
      ]);
      dimensionResults[dimension].verdict = "FAIL";
      dimensionResults[dimension].pass = false;
    }
  }

  const aggregateFailures = unique(Object.values(dimensionResults).flatMap((row) => row.failure_reasons));
  const aggregateShortfalls = unique(Object.values(dimensionResults).flatMap((row) => row.evidence_shortfall_reasons));
  const status = verdict(aggregateFailures, aggregateShortfalls);
  return {
    schema_version: launchReleasePacketSchemaVersion,
    verdict: status,
    pass: status === "PASS",
    dimensions: dimensionResults,
    failure_reasons: aggregateFailures,
    evidence_shortfall_reasons: aggregateShortfalls,
    policy: {
      exact_report_bytes_required: true,
      exact_live_release_required: true,
      trusted_packet_attestation_required: true,
      independent_source_workflow_aggregation_required: true
    }
  };
}
