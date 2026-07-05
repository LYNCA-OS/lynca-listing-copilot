import { publishDestinations, PublishingProviderError } from "./publisher-contract.mjs";

function stableExternalId(idempotencyKey) {
  return `mock_${String(idempotencyKey || "").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80)}`;
}

export function createMockPublisher({
  failuresBeforeSuccess = 0
} = {}) {
  let calls = 0;

  return {
    id: publishDestinations.MOCK_B_END,
    configured: true,
    async publish({
      listingDraft,
      destinationContext,
      idempotencyKey
    }) {
      calls += 1;

      if (calls <= failuresBeforeSuccess) {
        throw new PublishingProviderError("Mock publisher transient failure.", {
          destination: publishDestinations.MOCK_B_END,
          retryable: true,
          code: "mock_transient_failure"
        });
      }

      return {
        destination: publishDestinations.MOCK_B_END,
        external_id: stableExternalId(idempotencyKey),
        dry_run: destinationContext.dry_run !== false,
        submitted_at: new Date().toISOString(),
        request_echo: {
          asset_id: listingDraft.asset_id,
          review_id: listingDraft.review_id,
          final_title: listingDraft.final_title,
          resolved_fields: listingDraft.resolved_fields,
          modules: listingDraft.modules
        }
      };
    },
    calls() {
      return calls;
    }
  };
}
