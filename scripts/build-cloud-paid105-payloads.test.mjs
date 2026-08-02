import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCloudPaid105Payloads } from "./build-cloud-paid105-payloads.mjs";

const directory = await mkdtemp(join(tmpdir(), "lynca-cloud-payload-test-"));
const datasetPath = join(directory, "dataset.json");
const assetIdsPath = join(directory, "ids.json");
const items = [1, 2].map((number) => ({
  asset_id: `asset-${number}`,
  images: [
    { bucket: "bucket", object_path: `${number}/front.jpg`, role: "front_original" },
    ...(number === 1 ? [] : [
      { bucket: "bucket", object_path: `${number}/back.jpg`, role: "back_original" }
    ])
  ]
}));
await Promise.all([
  writeFile(datasetPath, JSON.stringify({ items })),
  writeFile(assetIdsPath, JSON.stringify(items.map((item) => item.asset_id)))
]);

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`;
let signingCalls = 0;
let headCalls = 0;
const result = await buildCloudPaid105Payloads({
  datasetPath,
  assetIdsPath,
  outDirectory: join(directory, "out"),
  expectedCards: 2,
  serviceKey: "test-service-key",
  fetchImpl: async (url, options) => {
    if (options?.method === "POST") {
      signingCalls += 1;
      const object = String(url).split("/object/sign/")[1];
      return new Response(JSON.stringify({ signedURL: `/object/sign/${object}?token=${token}` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (options?.method === "HEAD") {
      headCalls += 1;
      return new Response(null, { status: 200 });
    }
    throw new Error("unexpected_fetch");
  }
});
assert.equal(result.manifest.cards, 2);
assert.equal(result.manifest.images, 3);
assert.equal(result.manifest.provider_calls, 0);
assert.equal(signingCalls, 3);
assert.equal(headCalls, 3);
assert.equal(JSON.parse(await readFile(result.controlPath, "utf8")).assets.length, 2);
assert.equal(JSON.parse(await readFile(result.treatmentPath, "utf8")).assets.length, 2);
assert.equal(result.manifest.control_request_sha256, "a1958fad777b504cf9bf216eeb13f21fed310ec00a5a4acfd0d9dddcdbdcf90a");
assert.equal(result.manifest.treatment_request_sha256, "6598ad4025185aff18a94ab3c1e36f13578c299c886ccae0ca13672ce97feda6");

process.stdout.write("cloud paid105 payload builder: ok\n");
