import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export const constraintModelSnapshot = Object.freeze({
  version: "constraint-model-v1-94b08531ca0f9fa3",
  source: "lynca-catalog-vocab/data/catalog/constraints.json",
  source_commit: "0aa353e5",
  source_sha256: "94b08531ca0f9fa3724d6a2b3f41615d7d0732d35798dd27bf919e7d95a58cbe",
  compressed_sha256: "3c63700e0506fc187e43deb3bec73fb8b7c1fd5f83269e51380f195592a5fa10",
  asset: new URL("../../../data/catalog/constraints/constraints-94b08531ca0f9fa3.json.gz", import.meta.url)
});

let cachedModelPromise = null;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadVerifiedModel() {
  const compressed = await readFile(constraintModelSnapshot.asset);
  if (sha256(compressed) !== constraintModelSnapshot.compressed_sha256) {
    throw new Error("CONSTRAINT_MODEL_COMPRESSED_HASH_MISMATCH");
  }
  const bytes = await gunzipAsync(compressed);
  if (sha256(bytes) !== constraintModelSnapshot.source_sha256) {
    throw new Error("CONSTRAINT_MODEL_SOURCE_HASH_MISMATCH");
  }
  const model = JSON.parse(bytes.toString("utf8"));
  return Object.freeze({
    ...model,
    schema_version: model.schema_version || constraintModelSnapshot.version,
    snapshot_version: constraintModelSnapshot.version,
    snapshot_source_sha256: constraintModelSnapshot.source_sha256
  });
}

export function loadConstraintModelSnapshot() {
  if (!cachedModelPromise) cachedModelPromise = loadVerifiedModel();
  return cachedModelPromise;
}

export function resetConstraintModelSnapshotForTest() {
  cachedModelPromise = null;
}
