export class RecognitionWorkerError extends Error {
  constructor(message, {
    code = "recognition_worker_error",
    status = 500,
    retryable = false,
    details = null
  } = {}) {
    super(message);
    this.name = "RecognitionWorkerError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function recognitionUnavailable(reason) {
  return new RecognitionWorkerError(`Recognition worker unavailable: ${reason}`, {
    code: "recognition_worker_unavailable",
    status: 503,
    retryable: false,
    details: { reason }
  });
}

export function recognitionContractError(errors) {
  return new RecognitionWorkerError("Recognition worker contract validation failed.", {
    code: "recognition_contract_error",
    status: 422,
    retryable: false,
    details: { errors }
  });
}

export function safeRecognitionError(error) {
  if (error instanceof RecognitionWorkerError) {
    return {
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      message: error.message,
      details: error.details
    };
  }

  return {
    code: "recognition_worker_error",
    status: 500,
    retryable: false,
    message: String(error?.message || error || "Recognition worker error.")
  };
}
