import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeIndependentIdentityImages } from "./materialize-independent-identity-images.mjs";

const temporary = await mkdtemp(join(tmpdir(), "independent-identity-images-"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2QAAAAASUVORK5CYII=", "base64");
const dataset = { items: [{ item_id: "one", images: [{ image_id: "front", bucket: "cards", object_path: "one/front.png" }] }] };
let signCalls = 0;
let fetchCalls = 0;
const signImpl = async () => {
  signCalls += 1;
  return "https://signed.invalid/one";
};
const fetchImpl = async () => {
  fetchCalls += 1;
  return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
};

try {
  const first = await materializeIndependentIdentityImages({ dataset, outputDirectory: temporary, signImpl, fetchImpl, concurrency: 2 });
  assert.equal(first.materialization_summary.downloaded_count, 1);
  assert.equal(first.items[0].images[0].width, 1);
  assert.equal(first.items[0].images[0].height, 1);
  const second = await materializeIndependentIdentityImages({ dataset, outputDirectory: temporary, signImpl, fetchImpl, concurrency: 2 });
  assert.equal(second.materialization_summary.reused_count, 1);
  assert.equal(signCalls, 1);
  assert.equal(fetchCalls, 1);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("independent identity image materialization tests passed");
