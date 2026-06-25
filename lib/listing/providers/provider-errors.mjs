export class ProviderError extends Error {
  constructor(message, {
    provider = null,
    code = "provider_error",
    status = null,
    retryable = false,
    details = null
  } = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isProviderError(error) {
  return error instanceof ProviderError;
}

export function providerHttpError(provider, status, message = "") {
  const code = status === 400
    ? "bad_request"
    : status === 401 || status === 403
      ? "auth_error"
      : status === 408
        ? "timeout"
        : status === 429
          ? "rate_limited"
          : status >= 500
            ? "upstream_error"
            : "http_error";

  return new ProviderError(
    `${provider} request failed: ${status}${message ? ` ${message}` : ""}`,
    {
      provider,
      status,
      code,
      retryable: status === 408 || status === 429 || status >= 500
    }
  );
}

export function providerUnavailable(provider, reason) {
  return new ProviderError(reason, {
    provider,
    code: "provider_unavailable",
    retryable: false
  });
}

export function providerInputUnsupported(provider, reason) {
  return new ProviderError(reason, {
    provider,
    code: "provider_input_unsupported",
    retryable: false
  });
}

export function providerSchemaError(provider, reason, details = null) {
  return new ProviderError(reason, {
    provider,
    code: "schema_validation_failed",
    retryable: false,
    details
  });
}

export function providerResponseFormatError(provider, reason, details = null) {
  return new ProviderError(reason, {
    provider,
    code: "response_format_invalid",
    retryable: true,
    details
  });
}

export function isProviderResponseFormatError(error) {
  return error instanceof ProviderError && error.code === "response_format_invalid";
}

export function safeProviderErrorMessage(error) {
  if (!error) return "Provider error.";

  const message = error.message || String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted_api_key]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted_api_key]")
    .replace(/([?&](?:api[_-]?key|key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|key)\s*[:=]\s*)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[redacted]")
    .slice(0, 520);
}
