#!/usr/bin/env node

// Build the fixed 150-card confirmation cohort for the gated accuracy bundle.
//
// The reviewed blind set has 255 cards. A fully unseen 150-card cohort is not
// possible after the 150-card development run, so this manifest makes the
// overlap explicit: all 105 cards outside development plus 45 deterministic
// cards from development. It is a fresh-response confirmation, not an
// independent-card claim, and it never reads sealed labels.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evalRoot = resolve(process.env.THIN_PATH_EVAL_ROOT || "/Users/paidaxin/lynca-eval-root");
const datasetPath = resolve(evalRoot, "data/eval/reviewed-title-blind/reviewed-title-image-only.json");
const developmentPath = resolve(root, "artifacts/bounded-evidence-v2/cohorts/development-150.asset-ids.json");
const outDir = resolve(root, "artifacts/accuracy-mechanism-confirmatory-2026-08-02");
const idsOut = resolve(outDir, "mixed-150.asset-ids.json");
const manifestOut = resolve(outDir, "mixed-150.cohort-manifest.json");
const salt = "accuracy-mechanism-confirmatory-2026-08-02-v1";

const hash = (value) => createHash("sha256").update(`${salt}:${value}`).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const development = JSON.parse(await readFile(developmentPath, "utf8"));
const developmentSet = new Set(development);
const all = dataset.items.map((item) => item.asset_id);
if (all.length !== 255 || new Set(all).size !== 255) throw new Error("reviewed_dataset_must_be_255_unique_cards");
if (development.length !== 150 || developmentSet.size !== 150) throw new Error("development_cohort_must_be_150_unique_cards");

const outside = all.filter((assetId) => !developmentSet.has(assetId));
if (outside.length !== 105) throw new Error(`outside_development_must_be_105:${outside.length}`);
const selectedDevelopment = [...development]
  .sort((left, right) => hash(left).localeCompare(hash(right)) || left.localeCompare(right))
  .slice(0, 45);
const selected = [...outside, ...selectedDevelopment];
if (selected.length !== 150 || new Set(selected).size !== 150) throw new Error("mixed_confirmation_cohort_must_be_150_unique_cards");

const payload = {
  schema_version: "accuracy-mechanism-confirmatory-cohort-v1",
  selection_role: "fresh_response_mixed_confirmation",
  claim_boundary: "not_independent_card_cohort",
  source: {
    dataset_path: datasetPath,
    dataset_count: all.length,
    development_cohort_path: developmentPath,
    development_count: development.length
  },
  salt,
  counts: { total: selected.length, outside_development: outside.length, development_overlap: selectedDevelopment.length },
  asset_ids_sha256: createHash("sha256").update(selected.join("\n")).digest("hex"),
  outside_development_asset_ids_sha256: createHash("sha256").update(outside.join("\n")).digest("hex"),
  development_overlap_asset_ids_sha256: createHash("sha256").update(selectedDevelopment.join("\n")).digest("hex")
};

await mkdir(dirname(idsOut), { recursive: true });
await writeFile(idsOut, json(selected));
await writeFile(manifestOut, json(payload));
console.log(JSON.stringify({ idsOut, manifestOut, ...payload }, null, 2));
