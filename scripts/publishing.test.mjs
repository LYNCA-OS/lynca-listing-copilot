import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/listing-publish-draft.js";
import { createListingSessionToken } from "../lib/listing-session.mjs";
import { PublishingApprovalError } from "../lib/listing/publishing/listing-draft.mjs";
import { createMockPublisher } from "../lib/listing/publishing/mock-publisher.mjs";
import { createMemoryPublishAuditStore } from "../lib/listing/publishing/publish-audit-store.mjs";
import { publishListingDraft } from "../lib/listing/publishing/publish-listing-draft.mjs";
import { publishJobStatuses } from "../lib/listing/publishing/publisher-contract.mjs";
import { createPublisherRegistry } from "../lib/listing/publishing/publisher-registry.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

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

function sessionCookie() {
  const token = createListingSessionToken({
    user_id: "user_alpha",
    tenant_id: "tenant_alpha",
    email: "owner@example.test",
    session_version: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `lynca_metaverse_session=${token}`;
}

async function callApi(payload, { authenticated = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    const table = parsed.pathname.split("/").at(-1);
    calls.push({ table, method: options.method || "GET" });
    if (table === "tenant_members") {
      return {
        ok: true,
        status: 200,
        json: async () => [{
          tenant_id: "tenant_alpha",
          user_id: "user_alpha",
          role: "OWNER",
          status: "ACTIVE",
          disabled_at: null,
          user: {
            id: "user_alpha",
            email: "owner@example.test",
            status: "ACTIVE",
            session_version: 1,
            disabled_at: null,
            auth_user_id: "auth_alpha"
          },
          tenant: {
            id: "tenant_alpha",
            name: "Tenant Alpha",
            plan: "pilot",
            status: "ACTIVE",
            disabled_at: null
          }
        }],
        text: async () => "[]"
      };
    }
    return { ok: true, status: 201, json: async () => [], text: async () => "[]" };
  };
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = authenticated ? { cookie: sessionCookie() } : {};
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
    body: JSON.parse(res.body),
    calls
  };
}

const unauthenticatedApi = await callApi({ listing_draft: approvedDraft }, { authenticated: false });
assert.equal(unauthenticatedApi.statusCode, 401);
assert.equal(unauthenticatedApi.body.code, "AUTH_REQUIRED");
assert.equal(unauthenticatedApi.calls.filter((call) => !["request_logs", "error_logs"].includes(call.table)).length, 0);

const blockedApi = await callApi({
  listing_draft: {
    ...approvedDraft,
    review_status: "PENDING_REVIEW"
  }
});
assert.equal(blockedApi.statusCode, 410);
assert.equal(blockedApi.body.code, "tenant_aware_publishing_required");
assert.deepEqual(blockedApi.calls
  .filter((call) => !["request_logs", "error_logs"].includes(call.table))
  .map((call) => call.table), ["tenant_members"]);

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
assert.equal(publishedApi.statusCode, 410);
assert.equal(publishedApi.body.ok, false);
assert.equal(publishedApi.body.code, "tenant_aware_publishing_required");

console.log("publishing tests passed");
