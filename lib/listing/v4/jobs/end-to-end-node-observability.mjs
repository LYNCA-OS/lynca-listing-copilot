const activeJobStatuses = new Set(["QUEUED", "RETRYING", "RUNNING"]);

function timestampOrderValid(...values) {
  const parsed = values.map((value) => Date.parse(value || "")).filter(Number.isFinite);
  return parsed.every((value, index) => index === 0 || value >= parsed[index - 1]);
}

function jobStillActive(job = {}) {
  return activeJobStatuses.has(String(job.status || "").toUpperCase());
}

export function buildEndToEndNodeLedger({ session = null, job = {}, timing = {}, display = {} } = {}) {
  const base = session?.provider_result_summary?.pipeline_node_ledger;
  const baseNodes = Array.isArray(base?.nodes) ? base.nodes.map((node) => ({ ...node })) : [];
  const queueStatus = job.started_at ? "COMPLETED" : (jobStillActive(job) ? "RUNNING" : "NOT_RUN");
  const workerStatus = job.completed_at
    ? (String(job.status || "").toUpperCase() === "FAILED" ? "FAILED" : "COMPLETED")
    : (job.started_at ? "RUNNING" : "NOT_RUN");
  const writerReady = display.can_writer_start === true;
  const persistenceStatus = String(session?.provider_result_summary?.noncritical_persistence_status || "").toUpperCase();
  const persistenceSummary = session?.provider_result_summary?.noncritical_persistence_summary || {};
  const persistenceTerminal = ["COMPLETED", "PARTIAL", "FAILED"].includes(persistenceStatus);
  const lifecycleNodes = [
    {
      node_id: "job_enqueue",
      category: "orchestration",
      status: job.created_at ? "COMPLETED" : "NOT_RUN",
      expected: true,
      duration_ms: null,
      attempts: 1,
      input_count: 1,
      output_count: job.id ? 1 : 0,
      error_code: null,
      skip_reason: null,
      metrics: { lane: job.lane || null, job_type: job.job_type || null }
    },
    {
      node_id: "scheduler_queue",
      category: "orchestration",
      status: queueStatus,
      expected: true,
      duration_ms: timing.scheduler_queue_wait_ms,
      attempts: 1,
      input_count: 1,
      output_count: job.started_at ? 1 : 0,
      error_code: null,
      skip_reason: null,
      metrics: {
        paired_l1_wait_ms: timing.paired_l1_wait_ms,
        total_created_to_worker_start_ms: timing.total_created_to_worker_start_ms
      }
    },
    {
      node_id: "worker_execution",
      category: "orchestration",
      status: workerStatus,
      expected: true,
      duration_ms: timing.worker_processing_ms,
      attempts: Number(job.attempt_count || 0),
      input_count: job.started_at ? 1 : 0,
      output_count: job.completed_at ? 1 : 0,
      error_code: workerStatus === "FAILED" ? (job.error?.code || "V4_JOB_FAILED") : null,
      skip_reason: null,
      metrics: {
        max_attempts: Number(job.max_attempts || 0),
        provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
        provider_key_slot: Number(job.queue_tags?.provider_key_slot || 0) || null
      }
    },
    {
      node_id: "writer_ready",
      category: "output",
      status: writerReady ? "COMPLETED" : (workerStatus === "FAILED" ? "FAILED" : "RUNNING"),
      expected: true,
      duration_ms: timing.time_to_l2_ready_ms,
      attempts: 1,
      input_count: job.completed_at ? 1 : 0,
      output_count: writerReady ? 1 : 0,
      error_code: workerStatus === "FAILED" ? (job.error?.code || "WRITER_TITLE_UNAVAILABLE") : null,
      skip_reason: null,
      metrics: { l2_status: session?.l2_status || null }
    },
    {
      node_id: "production_observability_persistence",
      category: "learning",
      status: persistenceStatus === "COMPLETED"
        ? "COMPLETED"
        : persistenceStatus === "PARTIAL" || persistenceStatus === "FAILED"
          ? "FAILED"
          : "RUNNING",
      expected: true,
      duration_ms: Number(persistenceSummary.latency_ms || 0) || null,
      attempts: 1,
      input_count: writerReady ? 1 : 0,
      output_count: Number(persistenceSummary.saved_count || 0),
      error_code: persistenceStatus === "FAILED"
        ? "OBSERVABILITY_PERSISTENCE_FAILED"
        : persistenceStatus === "PARTIAL"
          ? "OBSERVABILITY_PERSISTENCE_PARTIAL"
          : null,
      skip_reason: null,
      metrics: {
        persistence_status: persistenceStatus || "DEFERRED",
        saved_count: Number(persistenceSummary.saved_count || 0),
        failed_count: Number(persistenceSummary.failed_count || 0),
        artifact_count: Number(persistenceSummary.artifact_count || 0),
        artifacts: persistenceSummary.artifacts || {}
      }
    }
  ];
  const nodes = [...lifecycleNodes, ...baseNodes];
  // The session becomes writer-ready inside the worker request. The queue row
  // is acknowledged only after that request returns, so completion follows L2.
  const lifecycleOrderValid = timestampOrderValid(job.created_at, job.started_at, session?.l2_ready_at, job.completed_at);
  const writerStateMatches = writerReady === Boolean(session?.l2_status === "READY" && (session?.l2_title || session?.final_title));
  const checks = [
    ...(Array.isArray(base?.reconciliation?.checks) ? base.reconciliation.checks.map((item) => ({ ...item })) : []),
    {
      check_id: "v4_job_lifecycle_timestamp_order",
      status: lifecycleOrderValid ? "PASS" : "FAIL",
      severity: "ERROR",
      expected: "created <= started <= writer_ready <= completed",
      actual: lifecycleOrderValid ? "ordered" : "out_of_order",
      detail: null
    },
    {
      check_id: "writer_ready_state_consistency",
      status: writerStateMatches ? "PASS" : "FAIL",
      severity: "ERROR",
      expected: writerReady,
      actual: Boolean(session?.l2_status === "READY" && (session?.l2_title || session?.final_title)),
      detail: null
    },
    ...(job.completed_at && writerReady ? [{
      check_id: "production_observability_persistence_terminal",
      status: persistenceTerminal ? "PASS" : "FAIL",
      severity: "ERROR",
      expected: "COMPLETED, PARTIAL, or FAILED",
      actual: persistenceStatus || "MISSING",
      detail: persistenceTerminal ? null : "writer-ready job completed without a durable persistence terminal state"
    }] : []),
    ...(persistenceTerminal ? [{
      check_id: "production_observability_persistence",
      status: persistenceStatus === "COMPLETED" ? "PASS" : "FAIL",
      severity: "ERROR",
      expected: "COMPLETED",
      actual: persistenceStatus,
      detail: persistenceStatus === "COMPLETED" ? null : `${Number(persistenceSummary.failed_count || 0)} artifacts failed`
    }] : [])
  ];
  const anomalies = checks.filter((item) => item.status === "FAIL");
  const missingRequired = nodes.filter((node) => node.expected && node.status === "NOT_RUN");
  const statusCounts = nodes.reduce((counts, node) => {
    counts[node.status] = (counts[node.status] || 0) + 1;
    return counts;
  }, {});
  return {
    schema_version: "pipeline-end-to-end-node-ledger-v1",
    request_context: {
      ...(base?.request_context || {}),
      job_id: job.id || null,
      batch_id: job.batch_id || null
    },
    coverage: {
      declared_node_count: nodes.length,
      observed_node_count: nodes.filter((node) => !["NOT_RUN", "SKIPPED"].includes(node.status)).length,
      expected_node_count: nodes.filter((node) => node.expected).length,
      missing_required_node_count: missingRequired.length,
      missing_required_node_ids: missingRequired.map((node) => node.node_id),
      status_counts: statusCounts
    },
    nodes,
    spans: Array.isArray(base?.spans) ? base.spans : [],
    field_flow: base?.field_flow || null,
    reconciliation: {
      check_count: checks.length,
      pass_count: checks.filter((item) => item.status === "PASS").length,
      anomaly_count: anomalies.length,
      error_count: anomalies.filter((item) => item.severity === "ERROR").length,
      warning_count: anomalies.filter((item) => item.severity === "WARNING").length,
      checks,
      anomalies
    }
  };
}
