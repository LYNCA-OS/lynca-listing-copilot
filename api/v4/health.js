import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { v4DeploymentInfo } from "../../lib/listing/v4/prewarm.mjs";
import { checkV4Tables } from "../../lib/listing/v4/session/session-store.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { visionProviderIds } from "../../lib/listing/providers/provider-contract.mjs";
import { openAiProviderPoolStatus } from "../../lib/listing/providers/openai-key-pool.mjs";
import { providerCatalog } from "../../lib/listing/providers/provider-registry.mjs";
import { vectorIndexReady, vectorRetrievalConfig } from "../../lib/listing/retrieval/vector-feature-flags.mjs";
import {
  v4JobLeaseHeartbeatEnabled,
  v4JobLeaseHeartbeatIntervalMs,
  v4QueueConfigured,
  checkV4QueueRpcReady,
  v4WorkerClaimLimit,
  v4WorkerLeaseSeconds
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { isV4WorkerSecretConfigured } from "../../lib/listing/v4/jobs/worker-auth.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  const tables = await checkV4Tables();
  const assetLifecycleTableNames = new Set(["listing_assets", "listing_image_verifications"]);
  const coreTablesOk = tables.configured && Object.entries(tables.tables || {})
    .filter(([table]) => !assetLifecycleTableNames.has(table))
    .every(([, status]) => status.ok);
  const provider = providerCatalog(process.env)[visionProviderIds.OPENAI_LEGACY] || {};
  const vector = vectorRetrievalConfig(process.env);
  const indexReady = vectorIndexReady(process.env);
  const queueConfigured = v4QueueConfigured(process.env);
  const workerSecretConfigured = isV4WorkerSecretConfigured(process.env);
  const providerReady = provider.enabled === true && provider.configured === true;
  const queueRpcReadyProbe = queueConfigured
    ? await checkV4QueueRpcReady({ env: process.env, fetchImpl: globalThis.fetch })
    : { ready: false, reason: "queue_not_configured" };
  const queueRpcReady = queueRpcReadyProbe.ready === true;
  const queueRpcSignatureReady = queueRpcReadyProbe.signature_ready === true;
  const queueRpcDependenciesReady = queueRpcReadyProbe.dependencies_ready === true;
  const queueRpcLegacyPrincipalReady = queueRpcReadyProbe.legacy_principal_ready === true;
  const queueConfiguredAndWorkerReady = queueConfigured && workerSecretConfigured;
  const queueReady = queueConfiguredAndWorkerReady && queueRpcReady;
  const assetLifecycleReady = tables.asset_lifecycle?.ready === true;
  const queueLeaseSeconds = v4WorkerLeaseSeconds(process.env);
  const infrastructureReady = coreTablesOk && providerReady;
  const runtimeContractReady = infrastructureReady && queueReady && assetLifecycleReady;
  const ready = runtimeContractReady;
  const notReadyReasons = [
    ...(!coreTablesOk ? ["v4_tables_not_ready"] : []),
    ...(!providerReady ? ["vision_provider_not_ready"] : []),
    ...(!assetLifecycleReady ? ["asset_lifecycle_not_ready"] : []),
    ...(!queueConfiguredAndWorkerReady ? ["production_queue_not_ready"] : []),
    ...(!queueRpcSignatureReady ? ["queue_rpc_signature_not_ready"] : []),
    ...(!queueRpcDependenciesReady ? ["queue_rpc_dependencies_not_ready"] : []),
    ...(!queueRpcLegacyPrincipalReady ? ["queue_legacy_principal_not_ready"] : []),
    ...(!queueRpcReady ? ["queue_rpc_not_ready"] : [])
  ];
  sendJson(res, 200, withV4Version({
    ok: true,
    service: "lynca-listing-copilot-v4",
    branch_target: "main",
    deployment: v4DeploymentInfo(),
    default_provider: visionProviderIds.OPENAI_LEGACY,
    default_model: provider.model_id || null,
    provider_runtime: {
      provider_id: provider.id || visionProviderIds.OPENAI_LEGACY,
      model_id: provider.model_id || null,
      role: provider.role || "primary",
      enabled: provider.enabled === true,
      configured: provider.configured === true
    },
    env_default_provider: process.env.DEFAULT_VISION_PROVIDER || null,
    openai_pool: openAiProviderPoolStatus(process.env),
    vector_index_ready: indexReady,
    vector_runtime: {
      index_ready: indexReady,
      default_request_enabled: vector.enabled === true,
      default_mode: vector.mode,
      request_override_supported: indexReady,
      model_id: vector.modelId,
      model_revision: vector.modelRevision,
      preprocessing_version: vector.preprocessingVersion
    },
    production_queue: {
      configured: queueConfigured,
      worker_secret_configured: workerSecretConfigured,
      queue_rpc_signature_ready: queueRpcSignatureReady,
      queue_rpc_dependencies_ready: queueRpcDependenciesReady,
      queue_rpc_legacy_principal_ready: queueRpcLegacyPrincipalReady,
      queue_rpc_ready: queueRpcReady,
      queue_rpc_error: queueRpcReady
        ? null
        : {
          reason: queueRpcReadyProbe?.reason || null,
          signature_error: queueRpcReadyProbe?.signature_error || null,
          dependency_error: queueRpcReadyProbe?.dependency_error || null,
          legacy_principal_error: queueRpcReadyProbe?.legacy_principal_error || null
        },
      worker_claim_limit: v4WorkerClaimLimit(process.env),
      lease_seconds: queueLeaseSeconds,
      lease_heartbeat_enabled: v4JobLeaseHeartbeatEnabled(process.env),
      lease_heartbeat_interval_ms: v4JobLeaseHeartbeatIntervalMs({ leaseSeconds: queueLeaseSeconds, env: process.env })
    },
    supabase: tables,
    observability: {
      pipeline_ledger_schema: "pipeline-node-ledger-v1",
      end_to_end_ledger_schema: "pipeline-end-to-end-node-ledger-v1",
      exposed_by_job_status: true
    },
    readiness_layers: {
      infrastructure_ready: infrastructureReady,
      queue_contract_ready: queueReady,
      asset_lifecycle_ready: assetLifecycleReady,
      runtime_contract_ready: runtimeContractReady,
      writer_journey: {
        ready: null,
        status: "NOT_PROBED_BY_HEALTH",
        proof_required: "sealed_launch_gate_artifact"
      }
    },
    ready_scope: "runtime_contract_only",
    launch_ready: false,
    ready,
    not_ready_reasons: notReadyReasons
  }));
}
