#!/usr/bin/env node

// Materialize the fully outside-development subset of the reviewed blind set.
// It is the largest independent-card slice currently available (105 cards),
// so reports must not call it an independent 150-card confirmation.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evalRoot = resolve(process.env.THIN_PATH_EVAL_ROOT || "/Users/paidaxin/lynca-eval-root");
const datasetPath = resolve(evalRoot, "data/eval/reviewed-title-blind/reviewed-title-image-only.json");
const developmentPath = resolve(root, "artifacts/bounded-evidence-v2/cohorts/development-150.asset-ids.json");
const outPath = resolve(root, "artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json");

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const development = JSON.parse(await readFile(developmentPath, "utf8"));
const all = dataset.items.map((item) => item.asset_id);
const developmentSet = new Set(development);
const selected = all.filter((assetId) => !developmentSet.has(assetId));
if (all.length !== 255 || new Set(all).size !== 255) throw new Error("reviewed_dataset_must_be_255_unique_cards");
if (development.length !== 150 || developmentSet.size !== 150) throw new Error("development_cohort_must_be_150_unique_cards");
if (selected.length !== 105 || new Set(selected).size !== 105) {
  throw new Error(`outside_development_must_be_105_unique_cards:${selected.length}`);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(selected, null, 2)}\n`);
console.log(JSON.stringify({
  outPath,
  count: selected.length,
  asset_ids_sha256: createHash("sha256").update(selected.join("\n")).digest("hex"),
  claim_boundary: "independent_card_subset_not_full_150_confirmation"
}, null, 2));
