import assert from "node:assert/strict";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  main,
  prepareHostedVisionProbePayload,
  VISION_URL_MAX_BATCH_SIZE
} from "./prepare-hosted-vision-probe-payload.mjs";

const tempDirectory = await mkdtemp(join(tmpdir(), "lynca-hosted-vision-payload-"));
const assetsPath = join(tempDirectory, "assets.json");
const outPath = join(tempDirectory, "payload.json");
const env = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_SECRET_KEY: "sb_secret_test_only"
};

await writeFile(assetsPath, JSON.stringify({
  items: [
    {
      asset_id: "asset-1",
      images: [
        { role: "front_original", bucket: "private-images", object_path: "cards/one front.jpg" },
        { role: "back_original", bucket: "private-images", object_path: "cards/one-back.jpg" },
        { role: "image_2_original", bucket: "private-images", object_path: "cards/ignored-third.jpg" }
      ]
    },
    {
      asset_id: "asset-2",
      images: [
        { role: "serial_crop", bucket: "private-images", object_path: "cards/ignored-crop.jpg" },
        { role: "front_original", bucket: "private-images", object_path: "cards/two-front.jpg" },
        { role: "back_original", bucket: "private-images", object_path: "cards/two-back.jpg" }
      ]
    },
    {
      asset_id: "asset-not-selected",
      images: [{ role: "front_original", bucket: "private-images", object_path: "cards/not-selected.jpg" }]
    }
  ]
}));

let active = 0;
let maxActive = 0;
const signingCalls = [];
let stdout = "";
await main([
  "--assets", assetsPath,
  "--out", outPath,
  "--limit", "2",
  "--concurrency", String(VISION_URL_MAX_BATCH_SIZE),
  "--signing-concurrency", "2",
  "--model", "gpt-5.6-luna",
  "--effort", "none"
], env, {
  stdout: { write: (value) => { stdout += value; } },
  fetchImpl: async (input, init) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    signingCalls.push({ input: String(input), init });
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    const path = new URL(input).pathname.replace(/^\/storage\/v1/, "");
    return new Response(JSON.stringify({ signedURL: `${path}?token=private-test-token` }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});

assert.equal(maxActive, 2, "signing requests must honor the independent signing concurrency");
assert.equal(signingCalls.length, 4, "only two original images per selected asset are signed");
assert.equal(signingCalls.every(({ input }) => input.startsWith(`${env.SUPABASE_URL}/storage/v1/object/sign/`)), true);
assert.equal(signingCalls.some(({ input }) => input.includes("ignored")), false);
assert.equal(signingCalls[0].input.includes("one%20front.jpg"), true, "storage paths are URL encoded");
for (const { init } of signingCalls) {
  assert.equal(init.method, "POST");
  assert.equal(init.headers.apikey, env.SUPABASE_SECRET_KEY);
  assert.equal(init.headers.authorization, undefined, "modern secret keys are not sent as bearer JWTs");
  assert.deepEqual(JSON.parse(init.body), { expiresIn: 3600 });
  assert.ok(init.signal instanceof AbortSignal);
}

const payload = JSON.parse(await readFile(outPath, "utf8"));
assert.deepEqual(Object.keys(payload), ["mode", "concurrency", "model", "effort", "image_detail", "assets"]);
assert.equal(payload.mode, "vision_url");
assert.equal(payload.concurrency, VISION_URL_MAX_BATCH_SIZE);
assert.equal(payload.model, "gpt-5.6-luna");
assert.equal(payload.effort, "none");
assert.equal(payload.image_detail, "high");
assert.deepEqual(payload.assets.map((asset) => asset.asset_id), ["asset-1", "asset-2"]);
assert.equal(payload.assets.every((asset) => asset.image_urls.length === 2), true);
assert.equal(payload.assets.flatMap((asset) => asset.image_urls).every((url) => (
  url.startsWith(`${env.SUPABASE_URL}/storage/v1/object/sign/`) && url.includes("token=private-test-token")
)), true);
assert.equal(stdout.includes("http"), false, "CLI logs must not reveal signed URLs");
assert.deepEqual(JSON.parse(stdout), {
  ok: true,
  mode: "vision_url",
  concurrency: VISION_URL_MAX_BATCH_SIZE,
  asset_count: 2,
  image_count: 4
});
if (process.platform !== "win32") {
  assert.equal((await stat(outPath)).mode & 0o777, 0o600, "signed payload must be owner-readable only");
}

const canonicalOutPath = join(tempDirectory, "canonical-payload.json");
const canonicalSummary = await prepareHostedVisionProbePayload({
  assetsPath,
  outPath: canonicalOutPath,
  limit: 2,
  concurrency: 80,
  signingConcurrency: 2,
  mode: "vision_canonical",
  env,
  fetchImpl: async (input) => {
    const path = new URL(input).pathname.replace(/^\/storage\/v1/, "");
    return new Response(JSON.stringify({ signedURL: `${path}?token=canonical-private-token` }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});
const canonicalPayload = JSON.parse(await readFile(canonicalOutPath, "utf8"));
assert.deepEqual(canonicalSummary, {
  ok: true, mode: "vision_canonical", concurrency: 80, asset_count: 2, image_count: 4
});
assert.equal(canonicalPayload.mode, "vision_canonical");
assert.equal(canonicalPayload.concurrency, 80);
assert.equal(canonicalPayload.request_template.model, "gpt-5.6-luna");
assert.equal(canonicalPayload.request_template.reasoning.effort, "none");
assert.equal(canonicalPayload.request_template.text.format.name, "canonical_card_fields");
assert.equal(canonicalPayload.request_template.text.format.strict, true);
assert.equal(canonicalPayload.request_template.input[0].content.length, 1);
assert.equal(canonicalPayload.request_template.input[0].content[0].type, "input_text");
assert.equal(JSON.stringify(canonicalPayload.request_template).includes("input_image"), false);
if (process.platform !== "win32") {
  assert.equal((await stat(canonicalOutPath)).mode & 0o777, 0o600);
}

await assert.rejects(
  prepareHostedVisionProbePayload({
    assetsPath,
    outPath: join(tempDirectory, "canonical-wrong-model.json"),
    mode: "vision_canonical",
    model: "wrong-model",
    env,
    fetchImpl: async () => { throw new Error("must not run"); }
  }),
  /canonical_mode_requires_luna_none/
);

const failedOutPath = join(tempDirectory, "failed-payload.json");
let failureCalls = 0;
await assert.rejects(
  prepareHostedVisionProbePayload({
    assetsPath,
    outPath: failedOutPath,
    limit: 2,
    signingConcurrency: 1,
    env,
    fetchImpl: async () => {
      failureCalls += 1;
      if (failureCalls === 2) return new Response("denied", { status: 403 });
      return new Response(JSON.stringify({ signedURL: "/object/sign/private-images/cards/ok.jpg?token=ok" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  }),
  /supabase_signing_request_failed/
);
assert.equal(failureCalls, 2, "fail-closed signing stops scheduling new requests after a failure");
await assert.rejects(access(failedOutPath), { code: "ENOENT" }, "a failed signing pass must not emit a payload");

await assert.rejects(
  prepareHostedVisionProbePayload({
    assetsPath,
    outPath: join(tempDirectory, "too-many.json"),
    limit: VISION_URL_MAX_BATCH_SIZE + 1,
    env,
    fetchImpl: async () => {
      throw new Error("must not run");
    }
  }),
  new RegExp(`limit_must_be_an_integer_between_1_and_${VISION_URL_MAX_BATCH_SIZE}`)
);

console.log("hosted vision probe payload preparation tests passed");
