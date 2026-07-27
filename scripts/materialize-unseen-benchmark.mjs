#!/usr/bin/env node
// Turn the unseen-product benchmark into a dataset the smoke harness can run.
//
//   node scripts/materialize-unseen-benchmark.mjs \
//     --input artifacts/smoke/unseen-products.json \
//     --out artifacts/smoke/unseen20.json
//
// build-unseen-product-benchmark.mjs collects listings and their checklist
// ground truth but leaves images as remote URLs. The harness uploads from disk,
// so the images have to be fetched first.
//
// eBay serves several sizes per listing; the largest is the only one worth
// keeping, because recognition depends on reading serial numbers and finish
// wording off the card and a 225px thumbnail carries neither.
//
// Sealed labels are written in the same shape the reviewed benchmarks use, so
// the same scorer applies. The label here is a title composed from the
// checklist identity rather than a lister's title -- these cards have no
// reviewed title, which is the entire point of the set. Composition is
// deliberately plain: year, product, set, player, card number. It is a
// statement of identity, not a claim about ideal SEM ordering, and it should be
// scored for whether those facts are present rather than for arrangement.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// eBay image URLs end in a size token: s-l225.jpg, s-l1600.jpg.
export function largestImage(urls = []) {
  const scored = urls.map((url) => {
    const match = String(url).match(/s-l(\d+)\./);
    return { url, size: match ? Number(match[1]) : 0 };
  }).sort((left, right) => right.size - left.size);
  return scored[0]?.url || null;
}

export function checklistTitle(truth = {}) {
  const product = cleanText(truth.product).replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, "").replace(/\s+/g, " ").trim();
  const set = cleanText(truth.set_or_insert);
  return [
    cleanText(truth.season_year),
    product,
    set && set.toLowerCase() !== "base" ? set : "",
    cleanText(truth.player),
    truth.card_number ? `#${cleanText(truth.card_number)}` : ""
  ].filter(Boolean).join(" ");
}

export async function main(argv = process.argv.slice(2)) {
  const inputPath = argValue(argv, "--input", "artifacts/smoke/unseen-products.json");
  const outPath = argValue(argv, "--out", "artifacts/smoke/unseen20.json");
  const imageDir = argValue(argv, "--image-dir", "artifacts/smoke/unseen-images");
  const labelsPath = outPath.replace(/\.json$/, "-labels.jsonl");

  const doc = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  await mkdir(resolve(imageDir), { recursive: true });

  const items = [];
  const labels = [];
  let fetched = 0;
  let skipped = 0;

  for (const card of doc.cards || []) {
    const url = largestImage(card.image_urls);
    if (!url) { skipped += 1; continue; }
    const id = createHash("sha256").update(String(card.item_id)).digest("hex").slice(0, 20);
    const assetId = `unseen_${id}`;
    const localPath = resolve(imageDir, `${assetId}.jpg`);

    try {
      const response = await fetch(url);
      if (!response.ok) { skipped += 1; continue; }
      await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
      fetched += 1;
    } catch { skipped += 1; continue; }

    const key = `unseen_${id}`;
    items.push({
      asset_id: assetId,
      physical_card_id: assetId,
      source_feedback_id: null,
      category: "collectible_card",
      review_status: "BLIND_EVALUATION_ONLY",
      canonical_title: "",
      source_titles: {},
      sealed_eval_label_ref: { path: resolve(labelsPath), key },
      source_record: {
        source: "unseen_product_benchmark",
        item_id: card.item_id,
        product_line: `${card.identity_ground_truth.season_year} ${card.identity_ground_truth.product}`
      },
      images: [{
        image_id: `${assetId}_front`,
        role: "front_original",
        local_path: localPath,
        content_type: "image/jpeg"
      }]
    });
    labels.push({
      key,
      reviewed_title: checklistTitle(card.identity_ground_truth),
      label_type: "MANUFACTURER_CHECKLIST_IDENTITY",
      identity_ground_truth: card.identity_ground_truth,
      policy: {
        reviewed_title_is_ground_truth: true,
        field_ground_truth: true,
        model_prompt_visible: false,
        load_after_predictions_frozen: true
      }
    });
  }

  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify({
    schema_version: "unseen-product-dataset-v1",
    generated_at: new Date().toISOString(),
    item_count: items.length,
    sealed_labels_path: resolve(labelsPath),
    accuracy_policy: {
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_is_field_ground_truth: true,
      title_visible_during_recognition: false,
      predictions_frozen_before_scoring: true
    },
    intake_policy: { image_only: true, inventory_exhaustive: false, reviewed_titles_in_dataset: false },
    items
  }, null, 2)}\n`, "utf8");
  await writeFile(resolve(labelsPath), `${labels.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");

  console.log(`fetched ${fetched} images, skipped ${skipped}`);
  console.log(`  dataset -> ${outPath}`);
  console.log(`  labels  -> ${labelsPath}`);
  for (const label of labels.slice(0, 5)) console.log(`    ${label.reviewed_title}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
