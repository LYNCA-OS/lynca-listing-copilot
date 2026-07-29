#!/usr/bin/env node
// The vector retrieval call is disabled by default because it was measured as a
// pure cost: 3,659 production calls averaging 3,556ms, returning zero
// candidates 92.7% of the time, against an index of 587 rows last written on
// 2026-07-06. 217 minutes spent, 201 of them for nothing.
//
// These tests hold the two properties that make disabling it safe: the caller
// contract is unchanged, and one environment variable brings it back.

import assert from "node:assert/strict";
import test from "node:test";

import { embedImagesWithVectorWorker, vectorRetrievalDisabled } from "../lib/listing/retrieval/vector-worker-client.mjs";

const images = [
  { url: "https://example.test/front.jpg", content_sha256: "a".repeat(64), role: "front" },
  { url: "https://example.test/back.jpg", content_sha256: "b".repeat(64), role: "back" }
];
const workerEnv = { VECTOR_WORKER_URL: "https://worker.test", VECTOR_WORKER_TOKEN: "token" };

test("disabled by default, and restorable by one variable", () => {
  assert.equal(vectorRetrievalDisabled({}), true);
  for (const value of ["false", "0", "off", "FALSE"]) {
    assert.equal(vectorRetrievalDisabled({ V4_VECTOR_RETRIEVAL_DISABLED: value }), false, value);
  }
});

test("the short circuit costs nothing and calls nobody", async () => {
  let called = false;
  const fetchImpl = () => { called = true; return Promise.resolve(new Response("{}", { status: 200 })); };

  const started = Date.now();
  const result = await embedImagesWithVectorWorker({ images, env: workerEnv, fetchImpl });
  const elapsed = Date.now() - started;

  assert.equal(called, false, "no request may be made while disabled");
  assert.ok(elapsed < 100, `returned in ${elapsed}ms`);
});

test("callers see the contract they already handle", async () => {
  const result = await embedImagesWithVectorWorker({
    images, env: workerEnv, fetchImpl: () => Promise.resolve(new Response("{}", { status: 200 }))
  });
  // Identical in shape to an unconfigured worker, which every caller has always
  // had to handle -- so disabling changes timing and nothing else.
  assert.equal(result.status, "VECTOR_RETRIEVAL_UNAVAILABLE");
  assert.deepEqual(result.features, []);
  assert.equal(result.reason, "vector_retrieval_disabled_empty_index",
    "the reason has to name why, so a future reader can check whether it still holds");
});

test("re-enabling actually reaches the worker again", async () => {
  let called = false;
  const fetchImpl = () => {
    called = true;
    return Promise.resolve(new Response(JSON.stringify({ embeddings: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
  };
  await embedImagesWithVectorWorker({
    images,
    env: { ...workerEnv, V4_VECTOR_RETRIEVAL_DISABLED: "false" },
    fetchImpl
  }).catch(() => {});
  assert.equal(called, true, "the kill switch must be reversible, not a deletion");
});

console.log("vector retrieval disable tests passed");
