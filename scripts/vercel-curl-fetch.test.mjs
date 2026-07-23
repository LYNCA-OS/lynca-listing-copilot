import assert from "node:assert/strict";

const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return { ok: true, status: 200 };
};

try {
  const { vercelCurlFetchForDeployment } = await import(`./evaluate-cloud-listing-api.mjs?external-fetch-test=${Date.now()}`);
  const fetchImpl = vercelCurlFetchForDeployment("https://preview.example.vercel.app");
  const response = await fetchImpl("https://storage.supabase.test/object/sign/path?token=secret", {
    method: "PUT",
    body: "bytes"
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    url: "https://storage.supabase.test/object/sign/path?token=secret",
    init: { method: "PUT", body: "bytes" }
  }]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("vercel curl external-origin routing tests passed");
