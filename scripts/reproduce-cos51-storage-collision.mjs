#!/usr/bin/env node
// COS-51's failure path, reproduced deliberately against a live instance.
//
// The three unticked boxes on COS-51 all need a card to FAIL, and a failure
// cannot be forced on production without corrupting real state. This runs
// entirely inside a throwaway tenant, so the state it corrupts is state that
// exists to be corrupted:
//
//   tenant_staging_cos51 / user_staging_cos51
//
// It is API-level, not browser-level, which is the point: no login page, no
// operator credentials, no HAR that could carry a password. The session is
// minted at RUN TIME from your own `METAVERSE_AUTH_SECRET` for the synthetic
// staging principal only. It never touches the real account.
//
//   METAVERSE_AUTH_SECRET=... \
//   COS51_BASE_URL=https://listing.lyncafei.team \
//   node scripts/reproduce-cos51-storage-collision.mjs
//
// Nothing outside the staging tenant is read or written. Nothing is deleted
// afterwards either, and that is not an oversight: original images are
// immutable by contract and the API has no way to unmake one. Cleanup is a
// tenant-level operation, which is the reason for the throwaway tenant --
// `scripts/cleanup-cos51-staging-tenant.sql` removes everything at once.
//
// What it proves, in the order the decision states it:
//
//   1. a second signing request for the same asset+image collides, and the
//      endpoint answers 409 with the full recovery contract rather than an
//      opaque `storage_signing_failed` -- the shape that used to send the
//      browser back to the same immutable path forever;
//   2. matching bytes VERIFY and are reused, with no overwrite;
//   3. mismatched bytes classify as INPUT_REBIND rather than being verified
//      into place, because the same path with different content would bind
//      someone else's image behind this card's title.

import crypto from "node:crypto";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";

const STAGING_TENANT = "tenant_staging_cos51";
const STAGING_USER = "user_staging_cos51";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    process.stderr.write(`${name} is required\n`);
    process.exit(2);
  }
  return value;
};

const baseUrl = String(process.env.COS51_BASE_URL || "").trim().replace(/\/+$/, "");
if (!/^https?:\/\//.test(baseUrl)) {
  process.stderr.write("COS51_BASE_URL must be an http(s) origin\n");
  process.exit(2);
}
const secret = required("METAVERSE_AUTH_SECRET");

// A session for the SYNTHETIC staging principal. Never the operator account:
// this run deliberately breaks things, and it must not be able to break them
// anywhere a real listing lives.
const token = createListingSessionToken(
  { user_id: STAGING_USER, tenant_id: STAGING_TENANT, session_version: 1 },
  secret
);
const cookie = `${cookieName}=${token}`;

const jpeg = Buffer.concat([
  Buffer.from("ffd8ffe000104a464946000101000001", "hex"),
  crypto.randomBytes(1_984)
]);
const jpegSha256 = crypto.createHash("sha256").update(jpeg).digest("hex");
const otherJpeg = Buffer.concat([
  Buffer.from("ffd8ffe000104a464946000101000001", "hex"),
  crypto.randomBytes(1_984)
]);
const otherSha256 = crypto.createHash("sha256").update(otherJpeg).digest("hex");

async function api(path, body, { method = "POST" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 400) }; }
  return { status: response.status, payload };
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `\n      ${detail}`}\n`);
};

const signBody = (assetId, imageId, sha256) => ({
  assetId,
  imageId,
  role: "front_original",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  size: jpeg.length,
  width: 1200,
  height: 900,
  signatureHex: jpeg.subarray(0, 16).toString("hex"),
  contentSha256: sha256
});

let assetId = null;
try {
  const health = await api("/api/health", undefined, { method: "GET" });
  if (health.status !== 200) {
    process.stderr.write(`health check failed: ${health.status}\n`);
    process.exit(1);
  }

  const created = await api("/api/listing-asset-create", {
    clientAssetRef: `cos51-collision-${Date.now()}`
  });
  // `/api/listing-asset-create` answers 201 and spreads the asset at the top
  // level, so the id is `payload.id` -- not nested under `asset`.
  assetId = created.payload?.id || created.payload?.asset_id || created.payload?.asset?.id;
  if (!assetId) {
    process.stderr.write(`could not create a staging asset: ${created.status} ${JSON.stringify(created.payload).slice(0, 300)}\n`);
    process.exit(1);
  }
  process.stdout.write(`staging asset ${assetId} in ${STAGING_TENANT}\n\n`);

  // 1. First signing succeeds and the object is written.
  const first = await api("/api/listing-image-upload-url", signBody(assetId, "front-1", jpegSha256));
  record("first signing succeeds", first.status === 200 && first.payload?.ok === true,
    `${first.status} ${JSON.stringify(first.payload).slice(0, 200)}`);
  const upload = first.payload?.upload || first.payload?.uploads?.[0];
  if (upload?.signed_url || upload?.url) {
    const put = await fetch(upload.signed_url || upload.url, {
      method: "PUT", headers: { "content-type": "image/jpeg" }, body: jpeg
    });
    record("the object is actually written", put.ok, `PUT ${put.status}`);
  }

  // 2. THE REPRODUCTION. Same asset, same image identity, same deterministic
  //    path. This is what a retry did on card 5 of the 20-card batch.
  const second = await api("/api/listing-image-upload-url", signBody(assetId, "front-1", jpegSha256));
  record("a repeat signing answers 409, not 503 or an opaque failure", second.status === 409,
    `got ${second.status}`);
  record("code is STORAGE_OBJECT_ALREADY_EXISTS",
    second.payload?.code === "STORAGE_OBJECT_ALREADY_EXISTS", JSON.stringify(second.payload?.code));
  record("recovery_action is VERIFY_EXISTING_OR_INPUT_REBIND",
    second.payload?.recovery_action === "VERIFY_EXISTING_OR_INPUT_REBIND",
    JSON.stringify(second.payload?.recovery_action));
  record("retryable is true", second.payload?.retryable === true, JSON.stringify(second.payload?.retryable));
  const objectPath = second.payload?.object_path || second.payload?.collisions?.[0]?.object_path || null;
  record("a canonical tenant-scoped object_path is returned",
    typeof objectPath === "string" && objectPath.startsWith(`tenants/${STAGING_TENANT}/`),
    JSON.stringify(objectPath));

  // 3. Matching bytes verify and are reused. No overwrite anywhere.
  if (objectPath) {
    const verified = await api("/api/listing-image-verify-existing", {
      assetId, imageId: "front-1", role: "front_original", fileName: "front.jpg",
      contentType: "image/jpeg", objectPath, contentSha256: jpegSha256
    });
    record("matching bytes verify and are reused",
      verified.status === 200 && verified.payload?.ok === true,
      `${verified.status} ${JSON.stringify(verified.payload).slice(0, 240)}`);

    // 4. Mismatched bytes must NOT verify. Same path, different content would
    //    bind another image behind this card's title; the contract calls that
    //    INPUT_REBIND and mints a successor generation instead.
    const mismatched = await api("/api/listing-image-verify-existing", {
      assetId, imageId: "front-1", role: "front_original", fileName: "front.jpg",
      contentType: "image/jpeg", objectPath, contentSha256: otherSha256
    });
    record("mismatched bytes are refused rather than verified into place",
      !(mismatched.status === 200 && mismatched.payload?.ok === true),
      `${mismatched.status} ${JSON.stringify(mismatched.payload).slice(0, 240)}`);
  }
} finally {
  // There is no asset-delete endpoint, deliberately: original images are
  // immutable and the API has no way to unmake one. Cleanup is therefore a
  // tenant-level operation, which is exactly why this runs in a throwaway
  // tenant rather than tidying up after itself inside a real one.
  if (assetId) {
    process.stdout.write([
      "",
      `staging asset ${assetId} remains in ${STAGING_TENANT}.`,
      "Nothing outside that tenant was touched. To remove everything this",
      "reproduction has ever created, drop the tenant's rows:",
      "",
      "  scripts/cleanup-cos51-staging-tenant.sql",
      ""
    ].join("\n"));
  }
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} 条通过\n`);
process.exitCode = failed.length ? 1 : 0;
