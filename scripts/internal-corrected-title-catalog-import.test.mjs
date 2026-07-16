import assert from "node:assert/strict";
import adminImportHandler from "../api/admin-import-corrected-title-catalog.js";
import { importCorrectedTitleCatalogV0 } from "./import-corrected-title-catalog-v0.mjs";

const feedbackRow = {
  id: "feedback-josh-hart",
  generated_title: "",
  corrected_title: "2025-26 Topps Finest Josh Hart Common Geometric Refractor",
  front_image_url: "",
  back_image_url: "",
  operator_id: "writer",
  created_at: "2026-07-14T00:00:00.000Z"
};

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
};

const posted = [];
const backfillFetch = async (url, options = {}) => {
  const requestUrl = String(url);
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : null;
  if (method === "POST") posted.push({ requestUrl, body });

  if (requestUrl.includes("/rest/v1/listing_title_feedback?")) {
    return new Response(JSON.stringify([feedbackRow]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_sources?") && method === "GET") {
    return new Response(JSON.stringify([{
      id: "source-josh-hart",
      source_metadata: { source_feedback_id: feedbackRow.id }
    }]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_cards?") && method === "GET") {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_products?") && method === "GET") {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_sets?") && method === "GET") {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  if (requestUrl.endsWith("/rest/v1/catalog_import_staging?on_conflict=source_id,source_row_key")) {
    return new Response(JSON.stringify([]), { status: 201 });
  }
  if (requestUrl.endsWith("/rest/v1/catalog_products")) {
    return new Response(JSON.stringify([{ id: "product-josh-hart", ...body }]), { status: 201 });
  }
  if (requestUrl.endsWith("/rest/v1/catalog_cards")) {
    return new Response(JSON.stringify([{ id: "card-josh-hart", ...body }]), { status: 201 });
  }
  throw new Error(`Unexpected request: ${method} ${requestUrl}`);
};

const backfill = await importCorrectedTitleCatalogV0({
  argv: ["--no-env-file", "--limit", "1000", "--offset", "0"],
  env,
  fetchImpl: backfillFetch
});
assert.equal(backfill.existing_source_count, 1);
assert.equal(backfill.inserted_source_count, 0);
assert.equal(backfill.inserted_product_count, 1);
assert.equal(backfill.inserted_card_count, 1);
assert.equal(backfill.backfilled_existing_source_card_count, 1);

const postedProduct = posted.find((request) => request.requestUrl.endsWith("/rest/v1/catalog_products"))?.body;
const postedCard = posted.find((request) => request.requestUrl.endsWith("/rest/v1/catalog_cards"))?.body;
assert.equal(postedProduct.source_status, "REVIEWED_INTERNAL");
assert.equal(postedProduct.review_status, "REVIEWED_INTERNAL");
assert.equal(postedCard.source_status, "REVIEWED_INTERNAL");
assert.equal(postedCard.review_status, "REVIEWED_INTERNAL");
assert.equal(postedCard.metadata.prompt_safe_internal_writer_title, true);
assert.equal(postedCard.metadata.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(postedCard.metadata.title_derived_fields_are_ground_truth, false);
assert.equal("serial_number" in postedCard, false);
assert.equal("grade_company" in postedCard, false);
assert.equal("cert_number" in postedCard, false);

let idempotentPostCount = 0;
const idempotentFetch = async (url, options = {}) => {
  const requestUrl = String(url);
  const method = options.method || "GET";
  if (method === "POST") idempotentPostCount += 1;
  if (requestUrl.includes("/rest/v1/listing_title_feedback?")) {
    return new Response(JSON.stringify([feedbackRow]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_sources?") && method === "GET") {
    return new Response(JSON.stringify([{
      id: "source-josh-hart",
      source_metadata: { source_feedback_id: feedbackRow.id }
    }]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_cards?") && method === "GET") {
    return new Response(JSON.stringify([{ id: "card-josh-hart", source_id: "source-josh-hart" }]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_products?") && method === "GET") {
    return new Response(JSON.stringify([{ id: "product-josh-hart", source_id: "source-josh-hart" }]), { status: 200 });
  }
  if (requestUrl.includes("/rest/v1/catalog_sets?") && method === "GET") {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  throw new Error(`Unexpected request: ${method} ${requestUrl}`);
};
const idempotent = await importCorrectedTitleCatalogV0({
  argv: ["--no-env-file", "--limit", "1000", "--offset", "0"],
  env,
  fetchImpl: idempotentFetch
});
assert.equal(idempotent.skipped_existing_card_count, 1);
assert.equal(idempotent.inserted_card_count, 0);
assert.equal(idempotentPostCount, 0, "an already imported source must not create duplicate catalog rows");

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value);
    }
  };
}

const unauthorizedRes = mockRes();
await adminImportHandler({ method: "POST", headers: {}, body: {} }, unauthorizedRes);
assert.equal(unauthorizedRes.statusCode, 401);
assert.equal(JSON.parse(unauthorizedRes.body).error, "unauthorized");

const previousEnv = {
  LYNCA_PLATFORM_ADMIN_SECRET: process.env.LYNCA_PLATFORM_ADMIN_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
};
const previousFetch = globalThis.fetch;
process.env.LYNCA_PLATFORM_ADMIN_SECRET = "test-import-token";
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
globalThis.fetch = async (url) => {
  assert.match(String(url), /\/rest\/v1\/listing_title_feedback\?/);
  return new Response(JSON.stringify([feedbackRow]), { status: 200 });
};
const dryRunRes = mockRes();
try {
  await adminImportHandler({
    method: "POST",
    headers: { "x-lynca-platform-admin-secret": "test-import-token" },
    body: { apply: false, limit: 10, offset: 0 }
  }, dryRunRes);
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
assert.equal(dryRunRes.statusCode, 200);
const dryRunPayload = JSON.parse(dryRunRes.body);
assert.equal(dryRunPayload.ok, true);
assert.equal(dryRunPayload.auth_mode, "platform_admin_secret");
assert.equal(dryRunPayload.apply, false);
assert.equal(dryRunPayload.report.dry_run, true);
assert.equal(dryRunPayload.report.inserted_card_count, 1);

console.log("internal corrected-title catalog import tests passed");
