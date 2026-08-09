#!/usr/bin/env node

// Zero-network authorization receipt builder. It can run only after the
// immutable Preview dry-run receipt has been durably checkpointed.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeJsonAtomic } from "../experiments/vercel-capacity-probe/cloud-io.mjs";
import { assertCompactV4PreflightReceipt } from
  "../experiments/vercel-capacity-probe/run-cloud-residual-compact-v4.mjs";
import { sha256 } from "../experiments/vercel-capacity-probe/request-contract.mjs";

const arg = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};
const load = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

export function buildCompactV4Authorization({ prereg, payload, manifest, labelRefReceipt,
  deploymentReceipt, checkpoint }) {
  assertCompactV4PreflightReceipt(checkpoint);
  if (checkpoint?.schema_version !== "cloud-residual-compact-v4-run-contract-v1"
      || checkpoint.state !== "PREFLIGHT_COMPLETE" || checkpoint.preflight_provider_calls !== 0
      || !/^[0-9a-f]{64}$/.test(String(checkpoint.preflight_receipt_sha256 || ""))
      || checkpoint.provider_attempts !== 0 || checkpoint.provider_calls !== 0
      || checkpoint.provider_retries !== 0
      || checkpoint.prereg_sha256 !== sha256(JSON.stringify(prereg))
      || checkpoint.payload_sha256 !== sha256(JSON.stringify(payload))
      || checkpoint.materialization_byte_receipts_sha256
        !== payload.materialization_byte_receipts_sha256
      || checkpoint.physical_manifest_sha256 !== sha256(JSON.stringify(manifest))
      || checkpoint.label_ref_receipt_sha256 !== sha256(JSON.stringify(labelRefReceipt))
      || checkpoint.deployment_receipt_sha256 !== sha256(JSON.stringify(deploymentReceipt))
      || checkpoint.max_provider_attempts !== 105 || checkpoint.concurrency !== 1
      || checkpoint.retries !== 0 || labelRefReceipt.sealed_label_bytes_read !== false) {
    throw new Error("compact_v4_authorization_preflight_invalid");
  }
  return {
    schema_version: "model-residual-compact-v4-paid105-authorization-v1",
    execution_surface: "vercel_preview_only",
    authorized: true,
    approval_ref: "user-explicit-approval-2026-08-09-reuse-existing-key",
    prereg_sha256: checkpoint.prereg_sha256,
    payload_sha256: checkpoint.payload_sha256,
    physical_manifest_sha256: checkpoint.physical_manifest_sha256,
    label_ref_receipt_sha256: checkpoint.label_ref_receipt_sha256,
    sealed_labels_sha256: labelRefReceipt.sealed_labels_sha256,
    deployment_receipt_sha256: checkpoint.deployment_receipt_sha256,
    materialization_byte_receipts_sha256:
      checkpoint.materialization_byte_receipts_sha256,
    preflight_receipt_sha256: checkpoint.preflight_receipt_sha256,
    run_id: checkpoint.run_id,
    run_fingerprint: checkpoint.run_fingerprint,
    max_provider_attempts: 105,
    zero_call_title_fidelity: "35/35",
    zero_call_field_fidelity: "35/35"
  };
}

export async function main(argv = process.argv.slice(2)) {
  const required = ["--prereg", "--payload", "--assets-manifest", "--label-ref-receipt",
    "--deployment-receipt", "--checkpoint", "--out"];
  if (required.some((name) => !arg(argv, name))) {
    throw new Error("compact_v4_authorization_required_path_missing");
  }
  const authorization = buildCompactV4Authorization({
    prereg: await load(arg(argv, "--prereg")),
    payload: await load(arg(argv, "--payload")),
    manifest: await load(arg(argv, "--assets-manifest")),
    labelRefReceipt: await load(arg(argv, "--label-ref-receipt")),
    deploymentReceipt: await load(arg(argv, "--deployment-receipt")),
    checkpoint: await load(arg(argv, "--checkpoint"))
  });
  await writeJsonAtomic(resolve(arg(argv, "--out")), authorization);
  return authorization;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((authorization) => process.stdout.write(`${JSON.stringify({
    authorized: authorization.authorized, run_fingerprint: authorization.run_fingerprint,
    max_provider_attempts: authorization.max_provider_attempts })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
