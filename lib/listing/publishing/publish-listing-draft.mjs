import crypto from "node:crypto";
import { assertApprovedListingDraft } from "./listing-draft.mjs";
import { normalizeDestinationContext } from "./publisher-contract.mjs";
import { createPublisherRegistry } from "./publisher-registry.mjs";
import { defaultMemoryPublishAuditStore } from "./publish-audit-store.mjs";
import { publishJobStatuses, PublishingProviderError } from "./publisher-contract.mjs";

function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function idempotencyKeyForDraft(listingDraft, destinationContext = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(stableString({
    destination: destinationContext.destination,
    asset_id: listingDraft.asset_id,
    review_id: listingDraft.review_id,
    final_title: listingDraft.final_title
  }));
  return hash.digest("hex");
}

function maxAttemptsFromEnv(env = process.env, fallback = 2) {
  const parsed = Number(env.PUBLISH_MAX_ATTEMPTS);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(5, Math.round(parsed));
}

function requestSnapshot(listingDraft, destinationContext) {
  return {
    listing_draft: listingDraft,
    destination_context: destinationContext
  };
}

function responseSnapshot(response, error = null) {
  if (error) {
    return {
      error: {
        message: error.message,
        code: error.code || "publisher_error",
        retryable: error.retryable === true,
        destination: error.destination || null
      }
    };
  }

  return response || {};
}

export async function publishListingDraft(listingDraftInput, destinationContextInput = {}, {
  auditStore = defaultMemoryPublishAuditStore,
  publisherRegistry = createPublisherRegistry(),
  env = process.env,
  idempotencyKey = null
} = {}) {
  const listingDraft = assertApprovedListingDraft(listingDraftInput);
  const destinationContext = normalizeDestinationContext(destinationContextInput);
  const key = idempotencyKey || destinationContextInput.idempotency_key || destinationContextInput.idempotencyKey || idempotencyKeyForDraft(listingDraft, destinationContext);
  const existing = await auditStore.findByIdempotencyKey(key);

  if (existing && existing.status === publishJobStatuses.PUBLISHED) {
    return {
      status: publishJobStatuses.SKIPPED_DUPLICATE,
      duplicate: true,
      idempotency_key: key,
      audit_job: existing,
      response: existing.response_snapshot || null
    };
  }

  const publisher = publisherRegistry.get(destinationContext);
  if (!publisher) {
    throw new PublishingProviderError("Publish destination is not configured.", {
      destination: destinationContext.destination,
      retryable: false,
      code: "destination_not_configured"
    });
  }

  const job = existing || await auditStore.createJob({
    asset_id: listingDraft.asset_id,
    review_id: listingDraft.review_id,
    destination: destinationContext.destination,
    idempotency_key: key,
    status: publishJobStatuses.PENDING,
    request_snapshot: requestSnapshot(listingDraft, destinationContext),
    response_snapshot: null,
    attempts: 0
  });
  const maxAttempts = maxAttemptsFromEnv(env);
  let lastError = null;
  let publishedResponse = null;
  let attempts = Number(job.attempts || 0);

  while (attempts < maxAttempts) {
    attempts += 1;

    try {
      publishedResponse = await publisher.publish({
        listingDraft,
        destinationContext,
        idempotencyKey: key
      });
      const updated = await auditStore.updateJob(job.id, {
        status: publishJobStatuses.PUBLISHED,
        response_snapshot: responseSnapshot(publishedResponse),
        attempts
      });

      return {
        status: publishJobStatuses.PUBLISHED,
        duplicate: false,
        idempotency_key: key,
        audit_job: updated,
        response: publishedResponse
      };
    } catch (error) {
      lastError = error;
      await auditStore.updateJob(job.id, {
        status: publishJobStatuses.FAILED,
        response_snapshot: responseSnapshot(null, error),
        attempts
      });

      if (error.retryable !== true) break;
    }
  }

  const finalJob = await auditStore.updateJob(job.id, {
    status: publishJobStatuses.FAILED,
    response_snapshot: responseSnapshot(null, lastError),
    attempts
  });

  throw new PublishingProviderError(lastError?.message || "Publishing failed.", {
    destination: destinationContext.destination,
    retryable: false,
    code: lastError?.code || "publish_failed"
  });
}
