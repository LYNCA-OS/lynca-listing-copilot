export const publishDestinations = Object.freeze({
  MOCK_B_END: "mock_b_end"
});

export const publishJobStatuses = Object.freeze({
  PENDING: "PENDING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  SKIPPED_DUPLICATE: "SKIPPED_DUPLICATE"
});

export class PublishingProviderError extends Error {
  constructor(message, {
    destination = null,
    retryable = false,
    code = "publisher_error"
  } = {}) {
    super(message);
    this.name = "PublishingProviderError";
    this.destination = destination;
    this.retryable = retryable;
    this.code = code;
  }
}

export function normalizePublishDestination(value) {
  const normalized = String(value || publishDestinations.MOCK_B_END).trim().toLowerCase();
  return Object.values(publishDestinations).includes(normalized) ? normalized : "";
}

export function normalizeDestinationContext(input = {}) {
  const destination = normalizePublishDestination(input.destination || input.destination_id || input.destinationId);

  return {
    destination: destination || publishDestinations.MOCK_B_END,
    dry_run: input.dry_run !== false,
    external_account_id: String(input.external_account_id || input.externalAccountId || "").trim() || null,
    notes: String(input.notes || "").trim() || null
  };
}

export function assertKnownDestination(destinationContext = {}) {
  const destination = normalizePublishDestination(destinationContext.destination);
  if (!destination) {
    throw new PublishingProviderError("Unknown publish destination.", {
      destination: destinationContext.destination || null,
      retryable: false,
      code: "unknown_destination"
    });
  }

  return destination;
}
