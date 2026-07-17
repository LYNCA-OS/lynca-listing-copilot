function cleanText(value) {
  return String(value ?? "").trim();
}

function identityError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function resolveSignedPublicV4Principal(session = {}) {
  const tenantId = cleanText(session?.tenant_id);
  const userId = cleanText(session?.user_id || session?.user);
  const operatorId = cleanText(session?.operator_id || userId);
  if (!tenantId || !userId || !operatorId) {
    throw identityError("v4_signed_principal_incomplete");
  }
  return {
    tenantId,
    userId,
    operatorId,
    source: "SIGNED_AUTH_PRINCIPAL"
  };
}

export function sessionIdForV4Request({
  workerAuthorized = false,
  requestedSessionId = "",
  createSessionId
} = {}) {
  if (workerAuthorized) {
    const sessionId = cleanText(requestedSessionId);
    if (!sessionId) throw identityError("v4_worker_session_id_required");
    return sessionId;
  }
  if (typeof createSessionId !== "function") throw identityError("v4_session_id_factory_required");
  return cleanText(createSessionId());
}

export async function resolveV4WorkerSessionIdentity({
  sessionId = "",
  claimedTenantId = "",
  claimedOperatorId = "",
  claimedAssetId = "",
  readSession
} = {}) {
  const normalizedSessionId = cleanText(sessionId);
  const normalizedTenantId = cleanText(claimedTenantId);
  const normalizedOperatorId = cleanText(claimedOperatorId);
  const normalizedAssetId = cleanText(claimedAssetId);
  if (!normalizedSessionId || !normalizedTenantId || !normalizedOperatorId || !normalizedAssetId) {
    throw identityError("v4_worker_origin_identity_required");
  }
  if (typeof readSession !== "function") throw identityError("v4_worker_session_reader_required");

  const result = await readSession({
    sessionId: normalizedSessionId,
    tenantId: normalizedTenantId,
    operatorId: normalizedOperatorId
  });
  if (!result?.ok) throw identityError("v4_worker_session_identity_unavailable");

  const session = result.session;
  const storedTenantId = cleanText(session?.tenant_id);
  const storedOperatorId = cleanText(session?.operator_id);
  const storedUserId = cleanText(session?.user_id || session?.operator_id);
  const storedAssetId = cleanText(session?.asset_id);
  if (!session
      || !storedTenantId
      || !storedOperatorId
      || !storedUserId
      || !storedAssetId
      || storedTenantId !== normalizedTenantId
      || storedOperatorId !== normalizedOperatorId
      || storedAssetId !== normalizedAssetId) {
    throw identityError("v4_worker_session_identity_mismatch");
  }

  return {
    tenantId: storedTenantId,
    operatorId: storedOperatorId,
    userId: storedUserId,
    assetId: storedAssetId,
    requestSummary: session?.request_summary && typeof session.request_summary === "object"
      ? { ...session.request_summary }
      : {},
    source: "PERSISTED_RECOGNITION_SESSION"
  };
}

export function scopeV4RecognitionPayloadFromFencedJob(job = {}) {
  const jobId = cleanText(job.id);
  const workerId = cleanText(job.lease_owner);
  const sessionId = cleanText(job.recognition_session_id);
  const tenantId = cleanText(job.tenant_id);
  const operatorId = cleanText(job.operator_id);
  const status = cleanText(job.status).toUpperCase();
  const leaseExpiry = Date.parse(cleanText(job.lease_expires_at));
  if (!jobId
      || !workerId
      || !sessionId
      || !tenantId
      || !operatorId
      || status !== "RUNNING"
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= Date.now()) {
    throw identityError("v4_worker_fenced_job_identity_invalid");
  }

  const basePayload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? { ...job.payload }
    : {};
  for (const key of [
    "id",
    "job_id", "jobId",
    "session_id", "sessionId",
    "recognitionSessionId",
    "tenant_id", "tenantId", "workspace_id", "workspaceId",
    "operator_id", "operatorId", "user_id", "userId",
    "created_by_user_id", "createdByUserId",
    "assigned_to_user_id", "assignedToUserId",
    "assetId",
    "lease_owner", "lease_expires_at",
    // A browser/queue-selected bundle identity never crosses the service-role
    // boundary. The worker rebuilds it only after fencing the job and matching
    // the persisted session's tenant + asset identity.
    "preingestion_bundle_id", "preingestionBundleId", "preingestion_bundle", "preingestionBundle",
    "preingestion_bundle_used", "preingestionBundleUsed",
    "preingestion_bundle_status", "preingestionBundleStatus",
    "preingestion_summary", "preingestionSummary",
    "preingestion_initial_evidence", "preingestionInitialEvidence",
    "preingestion_evidence_patches", "preingestionEvidencePatches"
  ]) {
    delete basePayload[key];
  }
  const jobType = cleanText(job.job_type || basePayload.job_type).toUpperCase();
  const fastScoutDraft = jobType === "FAST_SCOUT_DRAFT";
  const providerId = cleanText(basePayload.provider_id || job.provider_id || "openai_legacy");
  return {
    ...basePayload,
    recognition_session_id: sessionId,
    asset_id: cleanText(job.asset_id || basePayload.asset_id || basePayload.assetId) || undefined,
    tenant_id: tenantId,
    operator_id: operatorId,
    user_id: operatorId,
    created_by_user_id: operatorId,
    assigned_to_user_id: operatorId,
    v4_origin_tenant_id: tenantId,
    v4_origin_operator_id: operatorId,
    provider: cleanText(basePayload.provider || providerId) || "openai_legacy",
    provider_id: providerId,
    vision_provider: cleanText(basePayload.vision_provider || providerId) || "openai_legacy",
    v4_queue_job_id: jobId,
    v4_queue_worker_id: workerId,
    v4_queue_job_type: jobType,
    v4_queue_lane: cleanText(job.lane || basePayload.lane),
    openai_preferred_key_slot: Number(job.queue_tags?.provider_key_slot || 0) || null,
    provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
    ...(fastScoutDraft
      ? {
        v4_worker_synchronous: false,
        v4_force_l2_direct: false,
        disable_fast_scout_l1: false,
        v4_queue_l1_only: true
      }
      : {
        v4_worker_synchronous: true,
        v4_force_l2_direct: true,
        disable_fast_scout_l1: true
      })
  };
}
