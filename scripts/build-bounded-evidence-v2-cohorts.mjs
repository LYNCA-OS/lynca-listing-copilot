#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const valueFor = (argv, name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rows = (body) => body.toString("utf8").split("\n").filter(Boolean).map(JSON.parse);

export const PRODUCT_MECHANISM_ASSET_IDS = Object.freeze([
  "reviewed_blind_8945fde9c65cb1b9f3a8",
  "reviewed_blind_7059d3b39d01402f0e61",
  "reviewed_blind_7c93444e09007eaec82f",
  "reviewed_blind_7815e1aeda1f8e00dd4e",
  "reviewed_blind_a4051a222e9be2cf8149",
  "reviewed_blind_a8a73b44f77bf6e823e2"
]);
export const CONFIRMATORY_SELECTION_SALT = "bounded-evidence-v2-confirmatory-2026-08-01-v1";

export function deriveBoundedEvidenceV2Cohorts(
  canonicalRows,
  auditedRows,
  datasetItems,
  { mechanismIds = PRODUCT_MECHANISM_ASSET_IDS } = {}
) {
  const canonical150 = [...new Set(canonicalRows
    .filter(({ arm }) => arm === "thin_canonical")
    .map(({ asset_id }) => asset_id))];
  const audited100 = new Set(auditedRows
    .filter(({ arm }) => arm === "thin_canonical_high")
    .map(({ asset_id }) => asset_id));
  if (canonical150.length !== 150) throw new Error(`canonical_v3_population_not_150:${canonical150.length}`);
  const overlap100 = canonical150.filter((id) => audited100.has(id));
  const screen50 = canonical150.filter((id) => !audited100.has(id));
  if (audited100.size !== 100 || overlap100.length !== 100 || screen50.length !== 50) {
    throw new Error(`bounded_evidence_cohort_shape_invalid:${audited100.size}/${overlap100.length}/${screen50.length}`);
  }
  const dataset255 = (datasetItems || []).map(({ asset_id }) => asset_id);
  if (dataset255.length !== 255 || new Set(dataset255).size !== dataset255.length) {
    throw new Error(`reviewed_dataset_population_not_255:${dataset255.length}/${new Set(dataset255).size}`);
  }
  const datasetSet = new Set(dataset255);
  const missingCanonical = canonical150.filter((id) => !datasetSet.has(id));
  if (missingCanonical.length) throw new Error(`canonical_v3_missing_from_dataset:${missingCanonical[0]}`);
  // Fixed before any bounded-evidence-v2 outcome exists and without labels:
  // salted SHA-256 order breaks upload/writer/time ordering while remaining
  // exactly reproducible from public inputs.
  const outside105 = dataset255.filter((id) => !new Set(canonical150).has(id))
    .sort((left, right) => sha256(`${CONFIRMATORY_SELECTION_SALT}\u0000${left}`)
      .localeCompare(sha256(`${CONFIRMATORY_SELECTION_SALT}\u0000${right}`)));
  const confirmatory50 = outside105.slice(0, 50);
  const reserve55 = outside105.slice(50);
  if (confirmatory50.length !== 50) throw new Error(`confirmatory_population_not_50:${confirmatory50.length}`);
  if (reserve55.length !== 55) throw new Error(`confirmatory_reserve_not_55:${reserve55.length}`);
  if (!Array.isArray(mechanismIds) || mechanismIds.length !== 6
      || new Set(mechanismIds).size !== mechanismIds.length
      || mechanismIds.some((id) => !new Set(canonical150).has(id))) {
    throw new Error("product_mechanism6_invalid");
  }
  return Object.freeze({
    screen50,
    audited100: overlap100,
    development150: canonical150,
    mechanism6: [...mechanismIds],
    confirmatory50,
    reserve55
  });
}

async function main(argv = process.argv.slice(2)) {
  const canonicalPath = resolve(valueFor(
    argv,
    "--canonical-v3",
    "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl"
  ));
  const auditedPath = resolve(valueFor(
    argv,
    "--high100",
    "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl"
  ));
  const outDir = resolve(valueFor(argv, "--out-dir", "artifacts/bounded-evidence-v2-cohorts"));
  const datasetPath = resolve(valueFor(
    argv,
    "--dataset",
    "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json"
  ));
  const [canonicalBody, auditedBody, datasetBody] = await Promise.all([
    readFile(canonicalPath), readFile(auditedPath), readFile(datasetPath)
  ]);
  const dataset = JSON.parse(datasetBody);
  const cohorts = deriveBoundedEvidenceV2Cohorts(
    rows(canonicalBody), rows(auditedBody), dataset.items || []
  );
  await mkdir(outDir, { recursive: true });
  const files = {
    screen50: "screen-50.asset-ids.json",
    audited100: "audited-100.asset-ids.json",
    development150: "development-150.asset-ids.json",
    mechanism6: "product-mechanism-6.asset-ids.json",
    confirmatory50: "confirmatory-50.asset-ids.json",
    reserve55: "confirmatory-reserve-55.asset-ids.json"
  };
  for (const [name, filename] of Object.entries(files)) {
    await writeFile(resolve(outDir, filename), `${JSON.stringify(cohorts[name], null, 2)}\n`);
  }
  const manifest = {
    schema_version: "bounded-evidence-v2-cohort-manifest-v2",
    source_sha256: {
      canonical_v3: sha256(canonicalBody),
      high100: sha256(auditedBody),
      reviewed_dataset_255: sha256(datasetBody)
    },
    relationship: {
      canonical_v3: 150,
      audited_overlap: 100,
      development_screen: 50,
      outside_canonical_v3: 105,
      confirmatory_validation: 50,
      confirmatory_reserve: 55,
      product_mechanism_probe: 6
    },
    cohorts: Object.fromEntries(Object.entries(files).map(([name, filename]) => [name, {
      file: filename,
      count: cohorts[name].length,
      asset_ids_sha256: sha256(`${JSON.stringify(cohorts[name], null, 2)}\n`),
      selection_role: {
        screen50: "development_screen",
        audited100: "audited_development",
        development150: "development_population",
        mechanism6: "mechanism_probe_known_wins",
        confirmatory50: "confirmatory_validation",
        reserve55: "confirmatory_reserve"
      }[name],
      selection_method: {
        screen50: "canonical150_minus_audited100_already_used_for_hypothesis_selection",
        audited100: "canonical150_intersection_high100",
        development150: "ordered_canonical_v3_population",
        mechanism6: "six_preidentified_product_extension_wins_mechanism_only",
        confirmatory50: "sha256_public_salt_order_first50_outside_canonical150_without_labels",
        reserve55: "sha256_public_salt_order_remaining55_outside_canonical150_without_labels"
      }[name],
      ...(["confirmatory50", "reserve55"].includes(name)
        ? { selection_salt: CONFIRMATORY_SELECTION_SALT }
        : {})
    }]))
  };
  await writeFile(resolve(outDir, "cohort-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
