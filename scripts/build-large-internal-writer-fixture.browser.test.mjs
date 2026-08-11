import assert from "node:assert/strict";
import {
  LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT,
  renderLargeInternalFixture
} from "./build-large-internal-writer-fixture.mjs";

// Browser integration is intentionally separate from the ordinary contract
// suite. It must run with the repository-pinned Chromium, or with an explicit
// review executor whose exact binary is captured by the returned receipt.
const executablePath = String(process.env.LARGE_FIXTURE_TEST_CHROMIUM_EXECUTABLE || "").trim();
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf1sAAAAASUVORK5CYII=",
  "base64"
);
const sources = [
  { role: "front_original", content_type: "image/png", buffer: onePixelPng },
  { role: "back_original", content_type: "image/png", buffer: onePixelPng }
];

const render = () => renderLargeInternalFixture({
  sources,
  ...(executablePath ? { chromiumExecutablePath: executablePath } : {})
});
const first = await render();
const second = await render();
const contract = LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT;

assert.equal(first.executor.determinism_scope, "EXECUTOR_BOUND");
assert.equal(first.executor.cross_browser_byte_stability_claimed, false);
assert.equal(first.executor.network_boundary,
  "PAGE_AND_APP_REQUESTS_BLOCKED_OUTER_SANDBOX_REQUIRED");
assert.match(first.executor.chromium_executable_sha256, /^[0-9a-f]{64}$/);
if (!executablePath) {
  assert.equal(first.executor.matches_playwright_default_executor, true,
    "pinned CI must run the Chromium revision selected by the locked Playwright package");
  assert.equal(first.executor.chromium_revision,
    first.executor.playwright_expected_chromium_revision);
  assert.equal(first.executor.chromium_version,
    first.executor.playwright_expected_chromium_version);
}
const executorFingerprint = (executor) => ({
  playwright_version: executor.playwright_version,
  chromium_revision: executor.chromium_revision,
  chromium_version: executor.chromium_version,
  chromium_executable_sha256: executor.chromium_executable_sha256,
  platform: executor.platform,
  arch: executor.arch,
  headless: executor.headless,
  launch_args: executor.launch_args
});
assert.deepEqual(executorFingerprint(first.executor), executorFingerprint(second.executor),
  "same-executor evidence must bind both renders to the identical binary and launch contract");
assert.deepEqual(
  first.originals.map(({ content_sha256 }) => content_sha256),
  second.originals.map(({ content_sha256 }) => content_sha256),
  "the same executor must reproduce identical original JPEG bytes"
);
assert.deepEqual(
  first.derived.map(({ content_sha256 }) => content_sha256),
  second.derived.map(({ content_sha256 }) => content_sha256),
  "the same executor must reproduce identical staged JPEG bytes"
);
assert.ok(first.totals.originalTotal > contract.original_total_min_bytes_exclusive);
assert.ok(first.originals.every((image) => (
  image.width === contract.output_width
  && image.height === contract.output_height
  && image.bytes <= contract.original_each_max_bytes
  && image.bytes <= contract.original_each_relay_max_bytes
  && image.placement.fit_mode === "contain"
  && image.placement.cropped === false
)));
assert.ok(first.derived.every((image, index) => (
  Math.max(image.width, image.height) === contract.staged_long_edge
  && image.bytes < first.originals[index].bytes
)));
assert.ok(first.totals.derivedTotal <= contract.derived_total_max_bytes);

console.log(JSON.stringify({
  ok: true,
  originals: first.originals.map(({ bytes, width, height, content_sha256 }) => ({
    bytes, width, height, content_sha256
  })),
  derived: first.derived.map(({ bytes, width, height, content_sha256 }) => ({
    bytes, width, height, content_sha256
  })),
  executor: first.executor
}));
