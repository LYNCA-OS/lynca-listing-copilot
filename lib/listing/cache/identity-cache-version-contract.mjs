import crypto from "node:crypto";
import { candidateSelectionHeuristicVersion } from "../candidates/candidate-selection-pass.mjs";
import { retrievalApplicationSchemaVersion } from "../candidates/retrieval-application-layer.mjs";
import { SEM_STANDARD_VERSION } from "../csm/sem-definition.mjs";
import { rendererVersion } from "../renderer/module-renderer.mjs";
import {
  defaultProviderModels,
  providerModelOverrideFromOptions,
  providerPromptVersion,
  visionProviderIds
} from "../providers/provider-contract.mjs";
import { catalogSourceAuthorityPolicyVersion } from "../v4/policy/catalog-source-authority-policy.mjs";
import { providerTerminalPathPolicy } from "../v4/policy/provider-terminal-path-policy.mjs";

export const identityCacheContractVersion = "identity-result-cache-v3-global";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function providerOptions(payload = {}) {
  const options = payload.provider_options || payload.providerOptions || {};
  return options && typeof options === "object" && !Array.isArray(options) ? options : {};
}

function modelRevision(payload = {}, env = process.env) {
  const options = providerOptions(payload);
  return providerModelOverrideFromOptions(options)
    || clean(payload.openai_listing_model_override)
    || clean(payload.openaiListingModelOverride)
    || clean(payload.openai_model_override)
    || clean(payload.model_override)
    || clean(payload.modelOverride)
    || clean(payload.model)
    || clean(env.OPENAI_LISTING_MODEL)
    || defaultProviderModels[visionProviderIds.OPENAI_LEGACY];
}

function catalogSnapshotVersion(payload = {}, env = process.env) {
  const explicit = clean(
    payload.catalog_snapshot_version
    || payload.catalogSnapshotVersion
    || env.LISTING_CATALOG_SNAPSHOT_VERSION
  );
  if (explicit) return explicit;

  // The lookup revision is the existing operational catalog invalidation knob.
  // Deployment SHA makes checked-in catalog changes fail closed even when the
  // explicit snapshot variable has not been configured yet.
  const lookupRevision = clean(env.CATALOG_LOOKUP_CACHE_REVISION) || "v2";
  const deploymentRevision = clean(env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA) || "local-development";
  return `${lookupRevision}:${deploymentRevision}`;
}

export function buildIdentityCacheVersionVector(payload = {}, env = process.env) {
  const vector = Object.freeze({
    cache_contract_version: identityCacheContractVersion,
    model_revision: modelRevision(payload, env),
    prompt_revision: providerPromptVersion,
    sem_version: SEM_STANDARD_VERSION,
    candidate_policy_version: [
      candidateSelectionHeuristicVersion,
      retrievalApplicationSchemaVersion,
      catalogSourceAuthorityPolicyVersion,
      providerTerminalPathPolicy.policy_version
    ].join("+"),
    catalog_snapshot_version: catalogSnapshotVersion(payload, env),
    renderer_version: rendererVersion
  });
  return Object.freeze({
    vector,
    fingerprint: sha256(vector)
  });
}

export function identityCacheVersionMatches(record = {}, expected = {}) {
  const expectedFingerprint = clean(expected.fingerprint || expected.version_fingerprint);
  const recordFingerprint = clean(record.version_fingerprint);
  if (!expectedFingerprint || !recordFingerprint) return false;
  return expectedFingerprint === recordFingerprint;
}

export const __identityCacheVersionContractTestHooks = Object.freeze({
  stableJson,
  catalogSnapshotVersion,
  modelRevision
});
