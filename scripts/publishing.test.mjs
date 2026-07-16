import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-publish-draft.js";
import { PublishingApprovalError } from "../lib/listing/publishing/listing-draft.mjs";
import { createMockPublisher } from "../lib/listing/publishing/mock-publisher.mjs";
import { createMemoryPublishAuditStore } from "../lib/listing/publishing/publish-audit-store.mjs";
import { publishListingDraft } from "../lib/listing/publishing/publish-listing-draft.mjs";
import { publishJobStatuses } from "../lib/listing/publishing/publisher-contract.mjs";
import { createPublisherRegistry } from "../lib/listing/publishing/publisher-registry.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";

const approvedDraft = {
  asset_id: "asset-1",
  review_id: "review-1",
  final_title: "2025 Topps Chrome Cooper Flagg RC PSA 10",
  resolved_fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    card_grade: "10",
    grade_company: "PSA"
  },
  modules: {
    subject: {
      text: "Cooper Flagg"
    }
  },
  review_status: "APPROVED",
  approved_by: "operator-a",
  approved_at: "2026-06-22T00:00:00.000Z",
  publish_status: "READY"
};

await assert.rejects(
  () => publishListingDraft({
    ...approvedDraft,
    review_status: "PENDING_REVIEW"
  }, {}, {
    auditStore: createMemoryPublishAuditStore()
  }),
  PublishingApprovalError
);

const store = createMemoryPublishAuditStore();
const publisher = createMockPublisher();
const registry = createPublisherRegistry({
  overrides: {
    mock_b_end: publisher
  }
});
const firstPublish = await publishListingDraft(approvedDraft, {
  destination: "mock_b_end",
  dry_run: true
}, {
  auditStore: store,
  publisherRegistry: registry,
  idempotencyKey: "stable-key"
});
assert.equal(firstPublish.status, publishJobStatuses.PUBLISHED);
assert.equal(firstPublish.audit_job.status, publishJobStatuses.PUBLISHED);
assert.equal(firstPublish.audit_job.attempts, 1);
assert.equal(firstPublish.response.dry_run, true);
assert.equal(publisher.calls(), 1);

const duplicatePublish = await publishListingDraft(approvedDraft, {
  destination: "mock_b_end",
  dry_run: true
}, {
  auditStore: store,
  publisherRegistry: registry,
  idempotencyKey: "stable-key"
});
assert.equal(duplicatePublish.status, publishJobStatuses.SKIPPED_DUPLICATE);
assert.equal(duplicatePublish.duplicate, true);
assert.equal(publisher.calls(), 1);

const retryStore = createMemoryPublishAuditStore();
const retryPublisher = createMockPublisher({ failuresBeforeSuccess: 1 });
const retryResult = await publishListingDraft(approvedDraft, {
  destination: "mock_b_end"
}, {
  auditStore: retryStore,
  publisherRegistry: createPublisherRegistry({
    overrides: {
      mock_b_end: retryPublisher
    }
  }),
  env: {
    PUBLISH_MAX_ATTEMPTS: "2"
  },
  idempotencyKey: "retry-key"
});
assert.equal(retryResult.status, publishJobStatuses.PUBLISHED);
assert.equal(retryResult.audit_job.attempts, 2);
assert.equal(retryPublisher.calls(), 2);

const failedStore = createMemoryPublishAuditStore();
const failedPublisher = createMockPublisher({ failuresBeforeSuccess: 3 });
await assert.rejects(
  () => publishListingDraft(approvedDraft, {
    destination: "mock_b_end"
  }, {
    auditStore: failedStore,
    publisherRegistry: createPublisherRegistry({
      overrides: {
        mock_b_end: failedPublisher
      }
    }),
    env: {
      PUBLISH_MAX_ATTEMPTS: "2"
    },
    idempotencyKey: "failed-key"
  }),
  /Mock publisher transient failure/
);
assert.equal(failedStore.all()[0].status, publishJobStatuses.FAILED);
assert.equal(failedStore.all()[0].attempts, 2);

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

async function callApi(payload) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };
  const promise = handler(req, res);
  req.emit("data", JSON.stringify(payload));
  req.emit("end");
  await promise;

  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

const blockedApi = await callApi({
  listing_draft: {
    ...approvedDraft,
    review_status: "PENDING_REVIEW"
  }
});
assert.equal(blockedApi.statusCode, 403);
assert.equal(blockedApi.body.code, "approval_required");

const publishedApi = await callApi({
  listing_draft: {
    ...approvedDraft,
    asset_id: "asset-api",
    review_id: "review-api"
  },
  destination_context: {
    destination: "mock_b_end"
  },
  idempotency_key: "api-key"
});
assert.equal(publishedApi.statusCode, 200);
assert.equal(publishedApi.body.ok, true);
assert.equal(publishedApi.body.status, publishJobStatuses.PUBLISHED);
assert.equal(publishedApi.body.audit_durable, false);

console.log("publishing tests passed");
