export const writerViewModelVersion = "writer-job-view-v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function writerActions(display = {}) {
  if (display.can_writer_start !== true) return [];
  return ["ACCEPT", "EDIT", "REJECT"];
}

function writerWarnings(display = {}) {
  if (display.writer_status === "REVIEW_REQUIRED") return ["CHECK_EVIDENCE"];
  if (display.writer_status === "FAILED") return ["RETRY_OR_REBIND"];
  return [];
}

function writerFailure(job = {}, display = {}, failure = null) {
  if (display.writer_status !== "FAILED" && cleanText(job.status).toUpperCase() !== "FAILED") return null;
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    return {
      code: cleanText(failure.code) || "RECOGNITION_FAILED",
      message: cleanText(failure.message) || "识别失败，请重新处理。",
      retryable: failure.retryable === true,
      recovery_action: cleanText(failure.recovery_action) || null
    };
  }
  return {
    code: "RECOGNITION_FAILED",
    message: "识别失败，请重新处理。",
    retryable: job.error?.retryable === true
  };
}

export function buildWriterViewModel({ job = {}, session = null, display = {}, timing = {}, failure = null } = {}) {
  const title = cleanText(display.writer_display_title || display.display_title);
  const status = cleanText(display.display_status || "PENDING") || "PENDING";
  return {
    schema_version: writerViewModelVersion,
    status,
    title: {
      value: title,
      editable: display.can_writer_start === true
    },
    actions: writerActions(display),
    warnings: writerWarnings(display),
    failure: writerFailure(job, display, failure),
    job: {
      id: cleanText(job.id) || null,
      status: cleanText(job.status) || "PENDING"
    },
    session: {
      id: cleanText(job.recognition_session_id || session?.id) || null,
      status: cleanText(session?.status) || null
    },
    timing: {
      time_to_ready_ms: timing.time_to_l2_ready_ms ?? null,
      queue_wait_ms: timing.worker_queue_wait_ms ?? null,
      processing_ms: timing.worker_processing_ms ?? null
    }
  };
}
