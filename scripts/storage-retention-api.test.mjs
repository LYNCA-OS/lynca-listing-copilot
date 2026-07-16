import assert from "node:assert/strict";
import handler from "../api/listing-storage-retention-cleanup.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function makeRequest({ method = "GET", url = "/api/listing-storage-retention-cleanup", headers = {} } = {}) {
  return {
    method,
    url,
    headers: {
      host: "localhost",
      ...headers
    }
  };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value);
    }
  };
}

function resetEnv() {
  process.env = {
    ...originalEnv,
    CRON_SECRET: "test-cron-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    LISTING_IMAGE_BUCKET: "listing-card-images",
    LISTING_IMAGE_RETENTION_DAYS: "30",
    LISTING_IMAGE_RETENTION_DELETE_BATCH_SIZE: "2"
  };
}

function responsePayload(rows) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(rows)
  };
}

function makeRetentionFetch(calls) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body
    });

    if (init.method === "DELETE") {
      return responsePayload([]);
    }

    if (body?.prefix === "listing-assets") {
      return responsePayload([
        { name: "2000-01-01" },
        { name: "2999-01-01" },
        { name: "not-a-date" }
      ]);
    }

    if (body?.prefix === "listing-assets/2000-01-01") {
      return responsePayload([{ name: "asset-old" }]);
    }

    if (body?.prefix === "listing-assets/2000-01-01/asset-old") {
      return responsePayload([
        {
          name: "front_original-front.jpg",
          id: "object-1",
          metadata: { size: 1000 },
          created_at: "2000-01-01T00:00:00.000Z"
        },
        {
          name: "serial_crop-serial.png",
          id: "object-2",
          metadata: { size: 500 },
          created_at: "2000-01-01T00:00:00.000Z"
        }
      ]);
    }

    throw new Error(`Unexpected storage prefix ${body?.prefix}`);
  };
}

try {
  resetEnv();

  let res = makeResponse();
  await handler(makeRequest(), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body), {
    ok: false,
    message: "Unauthorized"
  });

  res = makeResponse();
  await handler(makeRequest({
    method: "PUT",
    headers: {
      authorization: "Bearer test-cron-secret"
    }
  }), res);
  assert.equal(res.statusCode, 405);

  let calls = [];
  globalThis.fetch = makeRetentionFetch(calls);
  res = makeResponse();
  await handler(makeRequest({
    headers: {
      authorization: "Bearer test-cron-secret"
    }
  }), res);
  assert.equal(res.statusCode, 200);
  const applied = JSON.parse(res.body);
  assert.equal(applied.ok, true);
  assert.equal(applied.dry_run, false);
  assert.equal(applied.deleted_count, 2);
  assert.deepEqual(applied.expired_prefixes, ["listing-assets/2000-01-01"]);
  assert.equal(JSON.stringify(applied).includes("test-cron-secret"), false);
  assert.equal(JSON.stringify(applied).includes("test-service-role"), false);
  assert.equal(JSON.stringify(applied).includes("front_original-front.jpg"), false);
  const deleteCall = calls.find((call) => call.method === "DELETE");
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall.body.prefixes, [
    "listing-assets/2000-01-01/asset-old/front_original-front.jpg",
    "listing-assets/2000-01-01/asset-old/serial_crop-serial.png"
  ]);

  calls = [];
  globalThis.fetch = makeRetentionFetch(calls);
  res = makeResponse();
  await handler(makeRequest({
    url: "/api/listing-storage-retention-cleanup?dry_run=true",
    headers: {
      authorization: "Bearer test-cron-secret"
    }
  }), res);
  assert.equal(res.statusCode, 200);
  const dryRun = JSON.parse(res.body);
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.deleted_count, 0);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);

  console.log("storage retention api tests passed");
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
}
