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
  const allTablesOk = tables.configured && Object.values(tables.tables || {}).every((table) => table.ok);
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
  const queueConfiguredAndWorkerReady = queueConfigured && workerSecretConfigured;
  const queueReady = queueConfiguredAndWorkerReady && queueRpcReady;
  const queueLeaseSeconds = v4WorkerLeaseSeconds(process.env);
  const ready = allTablesOk && providerReady && queueReady;
  const notReadyReasons = [
    ...(!allTablesOk ? ["v4_tables_not_ready"] : []),
    ...(!providerReady ? ["vision_provider_not_ready"] : []),
    ...(!queueConfiguredAndWorkerReady ? ["production_queue_not_ready"] : []),
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
      queue_rpc_ready: queueRpcReady,
      queue_rpc_error: queueRpcReady
        ? null
        : queueRpcReadyProbe?.error || queueRpcReadyProbe?.reason || null,
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
    ready,
    not_ready_reasons: notReadyReasons
  }));
}
