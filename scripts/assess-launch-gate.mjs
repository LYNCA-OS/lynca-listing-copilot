#!/usr/bin/env node

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assessLaunchBenchmark,
  launchGateThresholds,
  productionLaunchBaseUrl,
  productionLaunchRepository,
  productionLaunchSourceRef,
  productionWriterJourneySignerWorkflow
} from "../lib/listing/evaluation/launch-benchmark.mjs";
import {
  assessLaunchReleasePacket,
  launchReleasePacketSignerWorkflow,
  releaseReportDigests
} from "../lib/listing/evaluation/launch-release-packet.mjs";

const execFileAsync = promisify(execFile);
export const productionMainApiUrl = `https://api.github.com/repos/${productionLaunchRepository}/commits/main`;
export const productionHealthUrl = `${productionLaunchBaseUrl}/api/v4/health`;

function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith(`${name}=`)) values.push(argument.slice(name.length + 1));
    else if (argument === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values.filter(Boolean);
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

async function readJsonSnapshot(path, label) {
  const target = resolve(path);
  if (!existsSync(target)) throw new Error(`${label} not found: ${target}`);
  const bytes = await readFile(target);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function exactGitSha(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const normalized = value.toLowerCase();
  return /^[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function exactDeploymentId(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  return /^dpl_[A-Za-z0-9]+$/.test(value) ? value : null;
}

function exactSha256(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const normalized = value.toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function exactCatalogRevision(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  return value && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

async function fetchJson(fetchImpl, url, label, headers = {}) {
  const response = await fetchImpl(url, { headers });
  if (!response || response.ok !== true) {
    throw new Error(`${label} failed: HTTP ${response?.status ?? "unknown"}`);
  }
  return response.json();
}

export async function fetchLiveReleaseProvenance({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  env = process.env
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const githubHeaders = {
    accept: "application/vnd.github+json",
    "user-agent": "lynca-launch-gate"
  };
  const githubToken = env.GH_TOKEN || env.GITHUB_TOKEN || "";
  if (githubToken) githubHeaders.authorization = `Bearer ${githubToken}`;
  const [main, health] = await Promise.all([
    fetchJson(fetchImpl, productionMainApiUrl, "GitHub main lookup", githubHeaders),
    fetchJson(fetchImpl, productionHealthUrl, "production health lookup", { accept: "application/json" })
  ]);
  const mainGitSha = exactGitSha(main?.sha);
  const deploymentGitSha = exactGitSha(health?.deployment?.git_commit_sha ?? health?.git_commit_sha);
  const deploymentId = exactDeploymentId(health?.deployment?.deployment_id ?? health?.deployment_id);
  const recognitionPipelineFingerprint = exactSha256(
    health?.recognition_pipeline_fingerprint
    ?? health?.active_recognition_contract?.recognition_pipeline_fingerprint
  );
  const activeCatalogSnapshotRevision = exactCatalogRevision(
    health?.active_catalog_snapshot_revision
    ?? health?.active_recognition_contract?.active_catalog_snapshot_revision
  );
  const checkedAt = now();
  if (!mainGitSha || !deploymentGitSha || !deploymentId || !(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime())) {
    throw new Error("live release provenance is incomplete");
  }
  return {
    verified: true,
    repository: productionLaunchRepository,
    main_git_sha: mainGitSha,
    deployment_git_sha: deploymentGitSha,
    deployment_id: deploymentId,
    recognition_pipeline_fingerprint: recognitionPipelineFingerprint,
    active_catalog_snapshot_revision: activeCatalogSnapshotRevision,
    production_base_url: productionLaunchBaseUrl,
    checked_at: checkedAt.toISOString()
  };
}

export function parseAttestationVerificationOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout || ""));
  } catch {
    throw new Error("GitHub attestation verification did not return JSON");
  }
  if (!Array.isArray(parsed) || parsed.length < 1) {
    throw new Error("GitHub attestation verification returned no verified attestations");
  }
  const structurallyVerified = parsed.filter((entry) => (
    entry
    && typeof entry === "object"
    && entry.verificationResult?.signature?.certificate
    && Array.isArray(entry.verificationResult?.verifiedTimestamps)
    && entry.verificationResult.verifiedTimestamps.length > 0
    && Array.isArray(entry.verificationResult?.statement?.subject)
    && entry.verificationResult.statement.subject.length > 0
  ));
  if (structurallyVerified.length !== parsed.length) {
    throw new Error("GitHub attestation verification result is structurally incomplete");
  }
  return structurallyVerified;
}

async function defaultRunCommand(command, args) {
  return execFileAsync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

async function verifyArtifactAttestation({
  artifactBytes,
  liveMainGitSha,
  signerWorkflow,
  subjectName,
  temporaryPrefix,
  runCommand = defaultRunCommand
} = {}) {
  const sourceDigest = exactGitSha(liveMainGitSha);
  if (
    !(Buffer.isBuffer(artifactBytes) || artifactBytes instanceof Uint8Array)
    || !artifactBytes.length
    || !sourceDigest
    || typeof signerWorkflow !== "string"
  ) {
    throw new Error("one immutable artifact byte snapshot, trusted signer, and live main Git SHA are required");
  }
  const directory = await mkdtemp(join(tmpdir(), temporaryPrefix));
  const artifactPath = join(directory, subjectName);
  try {
    await chmod(directory, 0o700);
    await writeFile(artifactPath, artifactBytes, { mode: 0o600, flag: "wx" });
    const args = [
      "attestation",
      "verify",
      artifactPath,
      "--repo",
      productionLaunchRepository,
      "--signer-workflow",
      signerWorkflow,
      "--source-ref",
      productionLaunchSourceRef,
      "--source-digest",
      sourceDigest,
      "--deny-self-hosted-runners",
      "--format",
      "json"
    ];
    const result = await runCommand("gh", args);
    if (result && typeof result === "object" && "exitCode" in result && result.exitCode !== 0) {
      throw new Error("GitHub attestation verification failed");
    }
    const entries = parseAttestationVerificationOutput(typeof result === "string" ? result : result?.stdout);
    return {
      verified: true,
      repository: productionLaunchRepository,
      signer_workflow: signerWorkflow,
      source_ref: productionLaunchSourceRef,
      source_digest: sourceDigest,
      denied_self_hosted_runners: true,
      verified_attestation_count: entries.length
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function verifyWriterJourneyAttestation({ evidenceBytes, liveMainGitSha, runCommand = defaultRunCommand } = {}) {
  return verifyArtifactAttestation({
    artifactBytes: evidenceBytes,
    liveMainGitSha,
    signerWorkflow: productionWriterJourneySignerWorkflow,
    subjectName: "evidence.json",
    temporaryPrefix: "lynca-writer-journey-attestation-",
    runCommand
  });
}

export async function verifyLaunchReleasePacketAttestation({ packetBytes, liveMainGitSha, runCommand = defaultRunCommand } = {}) {
  return verifyArtifactAttestation({
    artifactBytes: packetBytes,
    liveMainGitSha,
    signerWorkflow: launchReleasePacketSignerWorkflow,
    subjectName: "release-packet.json",
    temporaryPrefix: "lynca-release-packet-attestation-",
    runCommand
  });
}

function markdown(report = {}) {
  const accuracy = report.dimensions.accuracy;
  const reliability = report.dimensions.reliability;
  const writerJourney = report.dimensions.writer_journey;
  const lines = [
    "# LYNCA Launch Gate",
    "",
    `- Verdict: **${report.launch_verdict}**`,
    `- SEM Card-Exact: ${accuracy.value ?? "n/a"} / target ${accuracy.target}`,
    `- Reliability: ${reliability.technical_availability ?? "n/a"} / target ${reliability.target}`,
    `- Reliability sample: ${reliability.attempted_count}/${reliability.minimum_cards}`,
    `- Attested release packet: ${report.release_evidence?.verdict || "INCONCLUSIVE"}`,
    `- Production Writer Journey: ${writerJourney.verdict}`,
    `- Writer Journey deployment: ${writerJourney.deployment_id || "n/a"}`,
    `- Writer Journey exact SHA: ${writerJourney.exact_sha_match === true}`,
    `- Writer Journey artifact attestation: ${writerJourney.provenance?.artifact_attestation_verified === true}`,
    `- Live main SHA: ${writerJourney.current_release_git_sha || "n/a"}`,
    "",
    "## Throughput",
    "",
    "| Level | Cards/min | Availability | Verdict |",
    "| ---: | ---: | ---: | :--- |",
    ...report.dimensions.throughput.levels.map((row) => (
      `| ${row.benchmark_level} | ${row.completed_cards_per_minute ?? "n/a"} | ${row.technical_availability ?? "n/a"} | ${row.verdict} |`
    )),
    "",
    "## Blocking Reasons",
    "",
    ...Object.entries(report.dimensions).flatMap(([dimension, row]) => [
      ...row.failure_reasons.map((reason) => `- ${dimension}: ${reason}`),
      ...row.evidence_shortfall_reasons.map((reason) => `- ${dimension}: ${reason}`)
    ])
  ];
  if (lines.at(-1) === "") lines.push("- none");
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2), {
  fetchImpl = globalThis.fetch,
  runCommand = defaultRunCommand,
  now = () => new Date(),
  env = process.env
} = {}) {
  const accuracyPath = argValue(argv, "--accuracy");
  const throughputPaths = argValues(argv, "--throughput");
  const reliabilityPath = argValue(argv, "--reliability");
  const writerJourneyPath = argValue(argv, "--writer-journey");
  const releasePacketPath = argValue(argv, "--release-packet");
  const outPath = resolve(argValue(argv, "--out", "data/eval/launch-benchmark/launch-gate.json"));
  if (argValues(argv, "--expected-git-sha").length || argValues(argv, "--expected-deployment-id").length) {
    throw new Error("caller-supplied release identity is forbidden; the launch gate resolves live main and production health itself");
  }
  if (!accuracyPath || !reliabilityPath || !writerJourneyPath || throughputPaths.length !== 3) {
    throw new Error("--accuracy, three --throughput reports, --reliability, and --writer-journey are required");
  }
  const [accuracySnapshot, throughputSnapshots, reliabilitySnapshot, writerJourneySnapshot, releasePacketSnapshot] = await Promise.all([
    readJsonSnapshot(accuracyPath, "accuracy report"),
    Promise.all(throughputPaths.map((path) => readJsonSnapshot(path, "throughput report"))),
    readJsonSnapshot(reliabilityPath, "reliability report"),
    readJsonSnapshot(writerJourneyPath, "production writer journey report"),
    releasePacketPath
      ? readJsonSnapshot(releasePacketPath, "attested release packet")
      : Promise.resolve({ bytes: null, value: {} })
  ]);
  const orderedThroughputSnapshots = [100, 500, 1000].map((level) => (
    throughputSnapshots.find((snapshot) => Number(snapshot.value?.benchmark_level) === level)
  ));
  if (orderedThroughputSnapshots.some((snapshot) => !snapshot)) {
    throw new Error("--throughput reports must contain exact benchmark levels 100, 500, and 1000");
  }
  let liveReleaseProvenance;
  try {
    liveReleaseProvenance = await fetchLiveReleaseProvenance({ fetchImpl, now, env });
  } catch (error) {
    liveReleaseProvenance = {
      verified: false,
      production_base_url: productionLaunchBaseUrl,
      error_code: "LIVE_RELEASE_PROVENANCE_UNAVAILABLE",
      error: String(error?.message || error).slice(0, 500)
    };
  }
  let writerJourneyAttestation;
  try {
    writerJourneyAttestation = await verifyWriterJourneyAttestation({
      evidenceBytes: writerJourneySnapshot.bytes,
      liveMainGitSha: liveReleaseProvenance.main_git_sha,
      runCommand
    });
  } catch (error) {
    writerJourneyAttestation = {
      verified: false,
      error_code: "WRITER_JOURNEY_ATTESTATION_UNVERIFIED",
      error: String(error?.message || error).slice(0, 500)
    };
  }
  let releasePacketAttestation;
  try {
    releasePacketAttestation = await verifyLaunchReleasePacketAttestation({
      packetBytes: releasePacketSnapshot.bytes,
      liveMainGitSha: liveReleaseProvenance.main_git_sha,
      runCommand
    });
  } catch (error) {
    releasePacketAttestation = {
      verified: false,
      error_code: "RELEASE_PACKET_ATTESTATION_UNVERIFIED",
      error: String(error?.message || error).slice(0, 500)
    };
  }
  const releasePacketAssessment = assessLaunchReleasePacket({
    packet: releasePacketSnapshot.value,
    reportDigests: releaseReportDigests({
      accuracyBytes: accuracySnapshot.bytes,
      throughputBytes: orderedThroughputSnapshots.map((snapshot) => snapshot.bytes),
      reliabilityBytes: reliabilitySnapshot.bytes,
      writerJourneyBytes: writerJourneySnapshot.bytes
    }),
    liveReleaseProvenance,
    attestationVerification: releasePacketAttestation,
    writerJourneyReport: writerJourneySnapshot.value,
    maximumAgeMs: launchGateThresholds.maximum_writer_journey_age_ms
  });
  const report = assessLaunchBenchmark({
    accuracyReport: accuracySnapshot.value,
    throughputReports: orderedThroughputSnapshots.map((snapshot) => snapshot.value),
    reliabilityReport: reliabilitySnapshot.value,
    writerJourneyReport: writerJourneySnapshot.value,
    liveReleaseProvenance,
    writerJourneyAttestation,
    releasePacketAssessment,
    thresholds: launchGateThresholds,
    now
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(outPath.replace(/\.json$/i, ".md"), markdown(report));
  console.log(JSON.stringify({
    output: outPath,
    launch_verdict: report.launch_verdict,
    launch_ready: report.launch_ready,
    release_packet_verdict: report.release_evidence?.verdict || "INCONCLUSIVE",
    failed_dimensions: report.failed_dimensions,
    inconclusive_dimensions: report.inconclusive_dimensions,
    next_bottleneck: report.next_bottleneck
  }, null, 2));
  return report.launch_ready ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Launch gate assessment failed: ${error.message}`);
    process.exitCode = 2;
  });
}
