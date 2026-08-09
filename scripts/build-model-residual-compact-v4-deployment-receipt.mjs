#!/usr/bin/env node

// Zero-network receipt builder. The caller captures GET /api/accuracy from the
// exact immutable Preview; this script binds it to the verified capacity-lab
// Vercel link, Singapore region, and deployed source SHA.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { cleanCommittedSourceState, writeJsonAtomic } from
  "../experiments/vercel-capacity-probe/cloud-io.mjs";

const arg = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};

export function buildCompactV4DeploymentReceipt({ readiness, deployment, sourceGitSha,
  project, activeContext, vercelConfig, sourceState }) {
  const origin = new URL(String(deployment || ""));
  const canonical = activeContext?.vercel?.capacity_lab;
  const orgId = activeContext?.vercel?.scope?.id;
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".vercel.app")
      || project?.projectName !== "lynca-capacity-lab"
      || project.projectId !== "prj_OnBhU4kHtWuOBCs3iGoYZsYfaWbg"
      || project.orgId !== "team_il17GLcdGsr5fows3jsKwMoA"
      || canonical?.project !== project.projectName || canonical?.project_id !== project.projectId
      || canonical?.deployment_target !== "preview" || orgId !== project.orgId
      || JSON.stringify(vercelConfig?.regions) !== JSON.stringify(["sin1"])
      || JSON.stringify(vercelConfig?.functions?.["api/accuracy.js"]?.regions)
        !== JSON.stringify(["sin1"])
      || readiness?.ready !== true || readiness.environment !== "preview"
      || readiness.region !== "sin1" || readiness.deployment_hostname !== origin.hostname
      || !String(readiness.deployment_id || "").trim()
      || readiness.release_git_sha !== sourceGitSha
      || sourceState?.clean !== true || sourceState.head_sha !== sourceGitSha
      || sourceState.status_porcelain_sha256 !== "e3b0c44298fc1c149afbf4c8996fb924"
        + "27ae41e4649b934ca495991b7852b855"
      || readiness.model !== "gpt-5.6-luna" || readiness.image_detail !== "high"
      || readiness.production_calls_allowed !== false || readiness.max_batch_size !== 1
      || readiness.max_concurrency !== 1 || readiness.openai_configured !== true
      || readiness.run_token_configured !== true || readiness.storage_host_configured !== true
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(sourceGitSha || ""))) {
    throw new Error("compact_v4_deployment_readiness_invalid");
  }
  for (const arm of ["compact_v4_control", "compact_v4_treatment"]) {
    if (!readiness.arm_request_specs?.[arm] || !readiness.frozen_request_contracts?.[arm]) {
      throw new Error(`compact_v4_deployment_arm_missing:${arm}`);
    }
  }
  return {
    schema_version: "residual-compact-v4-preview-deployment-receipt-v1",
    project_name: project.projectName,
    project_id: project.projectId,
    org_id: project.orgId,
    environment: readiness.environment,
    region: readiness.region,
    deployment_id: readiness.deployment_id,
    deployment_hostname: readiness.deployment_hostname,
    source_git_sha: sourceGitSha,
    source_tree_clean: true,
    source_status_sha256: sourceState.status_porcelain_sha256
  };
}

export async function main(argv = process.argv.slice(2)) {
  const required = ["--readiness", "--deployment", "--source-git-sha", "--out"];
  if (required.some((name) => !arg(argv, name))) {
    throw new Error("compact_v4_deployment_receipt_required_argument_missing");
  }
  const root = resolve(new URL("..", import.meta.url).pathname);
  const [readiness, project, activeContext, vercelConfig, sourceState] = await Promise.all([
    readFile(resolve(arg(argv, "--readiness")), "utf8").then(JSON.parse),
    readFile(resolve(root, "experiments/vercel-capacity-probe/.vercel/project.json"), "utf8")
      .then(JSON.parse),
    readFile(resolve(root, "docs/operations/active-service-context.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "experiments/vercel-capacity-probe/vercel.json"), "utf8").then(JSON.parse),
    cleanCommittedSourceState(root)
  ]);
  const receipt = buildCompactV4DeploymentReceipt({ readiness,
    deployment: arg(argv, "--deployment"), sourceGitSha: arg(argv, "--source-git-sha"),
    project, activeContext, vercelConfig, sourceState });
  await writeJsonAtomic(resolve(arg(argv, "--out")), receipt);
  return receipt;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({
    project: receipt.project_name, environment: receipt.environment,
    region: receipt.region, deployment_hostname: receipt.deployment_hostname })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
