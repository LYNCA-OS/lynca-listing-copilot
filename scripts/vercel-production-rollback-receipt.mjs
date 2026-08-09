#!/usr/bin/env node

import { isAbsolute } from "node:path";
import { open, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  fetchVercelProtectedHealth,
  vercelApiJson
} from "./fetch-vercel-protected-health.mjs";

const CANONICAL_PRODUCTION_ORIGIN = "https://listing.lyncafei.team";
const CANONICAL_PROJECT_NAME = "lynca-listing-copilot";
const CANONICAL_GIT_ORG = "LYNCA-OS";
const CANONICAL_GIT_REPO = "lynca-listing-copilot";
const CANONICAL_GIT_PRODUCTION_BRANCH = "main";
const RECEIPT_SCHEMA = "vercel-production-rollback-receipt-v1";
const CANONICAL_DEPLOYMENT_RECEIPT_SCHEMA =
  "vercel-production-canonical-deployment-receipt-v1";
const REQUEST_TIMEOUT_MS = 30_000;
const RECEIPT_KEYS = Object.freeze([
  "canonical_origin",
  "captured_at",
  "deployment_id",
  "deployment_url",
  "git_sha",
  "project_id",
  "ready_state",
  "schema_version",
  "target",
  "team_id"
].sort());

function required(env, name, pattern) {
  const value = String(env?.[name] || "").trim();
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`vercel_rollback_receipt_invalid_${name.toLowerCase()}`);
  }
  return value;
}

function deploymentHostname(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(value)) {
    throw new Error("vercel_rollback_receipt_invalid_deployment_url");
  }
  return value;
}

function deploymentId(raw) {
  const value = String(raw || "").trim();
  if (!/^dpl_[A-Za-z0-9]+$/.test(value)) {
    throw new Error("vercel_rollback_receipt_invalid_deployment_id");
  }
  return value;
}

function gitSha(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error("vercel_rollback_receipt_invalid_git_sha");
  }
  return value;
}

function identity(env) {
  return {
    token: required(env, "VERCEL_TOKEN", /^\S{20,}$/),
    teamId: required(env, "VERCEL_ORG_ID", /^team_[A-Za-z0-9]+$/),
    projectId: required(env, "VERCEL_PROJECT_ID", /^prj_[A-Za-z0-9]+$/)
  };
}

export async function verifyVercelProductionWriterAuthority({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const ids = identity(env);
  const project = await vercelApiJson(fetchImpl, {
    token: ids.token,
    teamId: ids.teamId,
    pathname: `/v9/projects/${encodeURIComponent(ids.projectId)}`
  });
  const canonicalHostname = new URL(CANONICAL_PRODUCTION_ORIGIN).hostname;
  const domain = await vercelApiJson(fetchImpl, {
    token: ids.token,
    teamId: ids.teamId,
    pathname: `/v9/projects/${encodeURIComponent(ids.projectId)}`
      + `/domains/${encodeURIComponent(canonicalHostname)}`
  });
  const hooks = project?.link?.deployHooks;
  if (project?.id !== ids.projectId
    || project?.accountId !== ids.teamId
    || project?.name !== CANONICAL_PROJECT_NAME
    || project?.autoAssignCustomDomains !== false
    || project?.link?.type !== "github"
    || project?.link?.org !== CANONICAL_GIT_ORG
    || project?.link?.repo !== CANONICAL_GIT_REPO
    || project?.link?.productionBranch !== CANONICAL_GIT_PRODUCTION_BRANCH
    || !Array.isArray(hooks)
    || hooks.length !== 0
    || domain?.name !== canonicalHostname
    || domain?.projectId !== ids.projectId
    || domain?.verified !== true
    || domain?.gitBranch !== null
    || domain?.customEnvironmentId !== null
    || domain?.redirect !== null
    || domain?.redirectStatusCode !== null) {
    throw new Error("vercel_rollback_receipt_writer_authority_mismatch");
  }
  return Object.freeze({
    project_id: ids.projectId,
    team_id: ids.teamId,
    auto_assign_custom_domains: false,
    canonical_domain_git_branch: null,
    deploy_hook_count: 0,
    git_production_branch: CANONICAL_GIT_PRODUCTION_BRANCH
  });
}

async function canonicalAlias(fetchImpl, { token, teamId, projectId }) {
  const canonicalHostname = new URL(CANONICAL_PRODUCTION_ORIGIN).hostname;
  const alias = await vercelApiJson(fetchImpl, {
    token,
    teamId,
    pathname: `/v4/aliases/${encodeURIComponent(canonicalHostname)}`
      + `?projectId=${encodeURIComponent(projectId)}`
  });
  const id = deploymentId(alias?.deploymentId);
  const nestedId = deploymentId(alias?.deployment?.id);
  const hostname = deploymentHostname(alias?.deployment?.url);
  if (alias?.alias !== canonicalHostname
    || alias?.projectId !== projectId
    || id !== nestedId
    || alias?.deletedAt != null
    || alias?.redirect != null) {
    throw new Error("vercel_rollback_receipt_canonical_alias_identity_mismatch");
  }
  return { deploymentId: id, deploymentHostname: hostname };
}

async function readyDeployment(fetchImpl, {
  token,
  teamId,
  projectId,
  expectedDeploymentId,
  expectedDeploymentHostname
}) {
  const deployment = await vercelApiJson(fetchImpl, {
    token,
    teamId,
    pathname: `/v13/deployments/${encodeURIComponent(expectedDeploymentId)}`
  });
  const hostname = deploymentHostname(deployment?.url);
  if (deployment?.id !== expectedDeploymentId
    || deployment?.projectId !== projectId
    || deployment?.ownerId !== teamId
    || hostname !== expectedDeploymentHostname
    || deployment?.readyState !== "READY"
    || deployment?.target !== "production") {
    throw new Error("vercel_rollback_receipt_deployment_identity_mismatch");
  }
  return deployment;
}

async function jsonRequest(fetchImpl, url) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response?.ok) {
    throw new Error(`vercel_rollback_receipt_health_failed_${Number(response?.status) || "unknown"}`);
  }
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new Error("vercel_rollback_receipt_health_invalid_json");
  }
}

function assertHealth(health, expectedSha) {
  if (health?.ready !== true
    || health?.deployment?.git_commit_sha !== expectedSha
    || health?.deployment?.environment !== "production") {
    throw new Error("vercel_rollback_receipt_health_identity_mismatch");
  }
}

async function exactDeploymentHealth(fetchImpl, env, deploymentUrl, expectedSha = "") {
  const health = await fetchVercelProtectedHealth({
    env: { ...env, DEPLOYMENT_URL: deploymentUrl },
    fetchImpl
  });
  const sha = gitSha(health?.deployment?.git_commit_sha);
  if (expectedSha && sha !== expectedSha) {
    throw new Error("vercel_rollback_receipt_health_identity_mismatch");
  }
  assertHealth(health, sha);
  return { health, sha };
}

function validateReceipt(value, env = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(RECEIPT_KEYS)) {
    throw new Error("vercel_rollback_receipt_shape_invalid");
  }
  const expectedTeamId = required(env, "VERCEL_ORG_ID", /^team_[A-Za-z0-9]+$/);
  const expectedProjectId = required(env, "VERCEL_PROJECT_ID", /^prj_[A-Za-z0-9]+$/);
  const id = deploymentId(value.deployment_id);
  const hostname = deploymentHostname(new URL(value.deployment_url).hostname);
  if (value.schema_version !== RECEIPT_SCHEMA
    || value.canonical_origin !== CANONICAL_PRODUCTION_ORIGIN
    || value.team_id !== expectedTeamId
    || value.project_id !== expectedProjectId
    || value.deployment_url !== `https://${hostname}`
    || value.ready_state !== "READY"
    || value.target !== "production"
    || !Number.isFinite(Date.parse(value.captured_at))) {
    throw new Error("vercel_rollback_receipt_identity_invalid");
  }
  return Object.freeze({
    ...value,
    deployment_id: id,
    deployment_url: `https://${hostname}`,
    git_sha: gitSha(value.git_sha)
  });
}

async function readReceipt(receiptPath, env) {
  if (!isAbsolute(receiptPath)) {
    throw new Error("vercel_rollback_receipt_path_must_be_absolute");
  }
  const mode = (await stat(receiptPath)).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error("vercel_rollback_receipt_permissions_invalid");
  }
  let value;
  try {
    value = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch {
    throw new Error("vercel_rollback_receipt_json_invalid");
  }
  return validateReceipt(value, env);
}

export async function readVercelProductionRollbackReceipt({
  env = process.env,
  receiptPath
} = {}) {
  return readReceipt(receiptPath, env);
}

async function writeReceipt(outputPath, receipt) {
  if (!isAbsolute(outputPath)) {
    throw new Error("vercel_rollback_receipt_path_must_be_absolute");
  }
  const file = await open(outputPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
  } finally {
    await file.close();
  }
  if (((await stat(outputPath)).mode & 0o777) !== 0o600) {
    throw new Error("vercel_rollback_receipt_permissions_invalid");
  }
}

function sameAlias(left, right) {
  return left.deploymentId === right.deploymentId
    && left.deploymentHostname === right.deploymentHostname;
}

export async function captureVercelProductionRollbackReceipt({
  env = process.env,
  fetchImpl = fetch,
  outputPath,
  now = () => new Date()
} = {}) {
  const ids = identity(env);
  await verifyVercelProductionWriterAuthority({ env, fetchImpl });
  const before = await canonicalAlias(fetchImpl, ids);
  await readyDeployment(fetchImpl, {
    ...ids,
    expectedDeploymentId: before.deploymentId,
    expectedDeploymentHostname: before.deploymentHostname
  });
  const deploymentUrl = `https://${before.deploymentHostname}`;
  const { sha } = await exactDeploymentHealth(fetchImpl, env, deploymentUrl);
  const canonicalHealth = await jsonRequest(fetchImpl, `${CANONICAL_PRODUCTION_ORIGIN}/api/health`);
  assertHealth(canonicalHealth, sha);
  const after = await canonicalAlias(fetchImpl, ids);
  if (!sameAlias(before, after)) {
    throw new Error("vercel_rollback_receipt_canonical_alias_changed_during_capture");
  }
  const receipt = validateReceipt({
    schema_version: RECEIPT_SCHEMA,
    canonical_origin: CANONICAL_PRODUCTION_ORIGIN,
    team_id: ids.teamId,
    project_id: ids.projectId,
    deployment_id: before.deploymentId,
    deployment_url: deploymentUrl,
    git_sha: sha,
    ready_state: "READY",
    target: "production",
    captured_at: now().toISOString()
  }, env);
  await writeReceipt(outputPath, receipt);
  return receipt;
}

export async function verifySavedVercelProductionDeployment({
  env = process.env,
  fetchImpl = fetch,
  receiptPath
} = {}) {
  const receipt = await readReceipt(receiptPath, env);
  const ids = identity(env);
  const hostname = new URL(receipt.deployment_url).hostname;
  await readyDeployment(fetchImpl, {
    ...ids,
    expectedDeploymentId: receipt.deployment_id,
    expectedDeploymentHostname: hostname
  });
  await exactDeploymentHealth(fetchImpl, env, receipt.deployment_url, receipt.git_sha);
  return receipt;
}

export async function verifyCanonicalVercelProductionReceipt({
  env = process.env,
  fetchImpl = fetch,
  receiptPath
} = {}) {
  const receipt = await readReceipt(receiptPath, env);
  const ids = identity(env);
  const before = await canonicalAlias(fetchImpl, ids);
  const expectedAlias = {
    deploymentId: receipt.deployment_id,
    deploymentHostname: new URL(receipt.deployment_url).hostname
  };
  if (!sameAlias(before, expectedAlias)) {
    throw new Error("vercel_rollback_receipt_canonical_alias_not_restored");
  }
  await verifySavedVercelProductionDeployment({ env, fetchImpl, receiptPath });
  const canonicalHealth = await jsonRequest(fetchImpl, `${CANONICAL_PRODUCTION_ORIGIN}/api/health`);
  assertHealth(canonicalHealth, receipt.git_sha);
  const after = await canonicalAlias(fetchImpl, ids);
  if (!sameAlias(after, expectedAlias)) {
    throw new Error("vercel_rollback_receipt_canonical_alias_changed_during_verification");
  }
  return receipt;
}

export async function verifyCanonicalVercelProductionDeployment({
  env = process.env,
  fetchImpl = fetch,
  deploymentUrl
} = {}) {
  const ids = identity(env);
  const hostname = deploymentHostname(new URL(String(deploymentUrl || "")).hostname);
  if (String(deploymentUrl || "") !== `https://${hostname}`) {
    throw new Error("vercel_rollback_receipt_invalid_deployment_url");
  }
  const before = await canonicalAlias(fetchImpl, ids);
  if (before.deploymentHostname !== hostname) {
    throw new Error("vercel_rollback_receipt_canonical_alias_not_expected_deployment");
  }
  await readyDeployment(fetchImpl, {
    ...ids,
    expectedDeploymentId: before.deploymentId,
    expectedDeploymentHostname: hostname
  });
  const after = await canonicalAlias(fetchImpl, ids);
  if (!sameAlias(before, after)) {
    throw new Error("vercel_rollback_receipt_canonical_alias_changed_during_verification");
  }
  return Object.freeze({
    deployment_id: before.deploymentId,
    deployment_url: `https://${hostname}`
  });
}

export async function writeCanonicalVercelProductionDeploymentReceipt({
  env = process.env,
  fetchImpl = fetch,
  deploymentUrl,
  outputPath,
  now = () => new Date()
} = {}) {
  const ids = identity(env);
  const verified = await verifyCanonicalVercelProductionDeployment({
    env,
    fetchImpl,
    deploymentUrl
  });
  const receipt = Object.freeze({
    schema_version: CANONICAL_DEPLOYMENT_RECEIPT_SCHEMA,
    canonical_origin: CANONICAL_PRODUCTION_ORIGIN,
    team_id: ids.teamId,
    project_id: ids.projectId,
    deployment_id: verified.deployment_id,
    deployment_url: verified.deployment_url,
    verified_at: now().toISOString()
  });
  await writeReceipt(outputPath, receipt);
  return receipt;
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === "--verify-writer-authority") {
    await verifyVercelProductionWriterAuthority();
    return;
  }
  if (argv.length !== 2 || ![
    "--out",
    "--verify-deployment",
    "--verify-canonical",
    "--verify-canonical-deployment",
    "--deployment-url",
    "--git-sha"
  ].includes(argv[0])) {
    if (argv.length === 4
        && argv[0] === "--canonical-deployment-receipt"
        && argv[2] === "--out") {
      await writeCanonicalVercelProductionDeploymentReceipt({
        deploymentUrl: argv[1],
        outputPath: argv[3]
      });
      return;
    }
    throw new Error("vercel_rollback_receipt_invalid_arguments");
  }
  const [mode, path] = argv;
  if (mode === "--out") {
    await captureVercelProductionRollbackReceipt({ outputPath: path });
    return;
  }
  if (mode === "--verify-deployment") {
    await verifySavedVercelProductionDeployment({ receiptPath: path });
    return;
  }
  if (mode === "--verify-canonical") {
    await verifyCanonicalVercelProductionReceipt({ receiptPath: path });
    return;
  }
  if (mode === "--verify-canonical-deployment") {
    await verifyCanonicalVercelProductionDeployment({ deploymentUrl: path });
    return;
  }
  const receipt = await readReceipt(path, process.env);
  process.stdout.write(`${mode === "--deployment-url" ? receipt.deployment_url : receipt.git_sha}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
