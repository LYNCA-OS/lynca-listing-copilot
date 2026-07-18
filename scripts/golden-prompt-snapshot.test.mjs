// Golden prompt snapshot — R1 monolith-retirement guard (docs/REFORM_PLAN.md).
// The provider prompt is accuracy-load-bearing: any extraction step that
// changes a single character of it must fail here and be reviewed explicitly.
//
// To intentionally update the snapshot after a REVIEWED prompt change:
//   UPDATE_GOLDEN_PROMPT=1 node scripts/golden-prompt-snapshot.test.mjs

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { __listingCopilotTitleTestHooks } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";

const { buildInitialProviderPrompt } = __listingCopilotTitleTestHooks;
assert.equal(typeof buildInitialProviderPrompt, "function");

const fixedPayload = {
  asset_id: "golden_snapshot_asset",
  category: "collectible_card",
  captureProfileId: "golden_snapshot_profile",
  provider: "openai_legacy",
  provider_options: {
    enable_catalog_assist: true,
    enable_vector_retrieval: true,
    vector_retrieval_mode: "assist"
  },
  images: [
    { id: "img_1", storageRole: "front_original", dataUrl: "data:image/jpeg;base64,QUJD" },
    { id: "img_2", storageRole: "back_original", dataUrl: "data:image/jpeg;base64,REVG" }
  ]
};

function normalize(prompt) {
  return String(prompt)
    // volatile bits that may legitimately vary run-to-run
    .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, "<iso-ts>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");
}

const prompt = normalize(await buildInitialProviderPrompt({ ...fixedPayload }, 80));
assert.ok(prompt.length > 500, "prompt suspiciously short");

const snapshotPath = "scripts/fixtures/golden-initial-provider-prompt.txt";
if (process.env.UPDATE_GOLDEN_PROMPT === "1") {
  await writeFile(snapshotPath, prompt, "utf8");
  console.log(`golden prompt snapshot UPDATED (${prompt.length} chars)`);
} else {
  let expected;
  try {
    expected = await readFile(snapshotPath, "utf8");
  } catch {
    await writeFile(snapshotPath, prompt, "utf8");
    console.log(`golden prompt snapshot CREATED (${prompt.length} chars)`);
    process.exit(0);
  }
  if (expected !== prompt) {
    const firstDiff = [...expected].findIndex((ch, i) => prompt[i] !== ch);
    assert.fail(
      `provider prompt drifted from golden snapshot at char ${firstDiff}:\n`
      + `  expected …${expected.slice(Math.max(0, firstDiff - 60), firstDiff + 60)}…\n`
      + `  actual   …${prompt.slice(Math.max(0, firstDiff - 60), firstDiff + 60)}…\n`
      + `If the change is intentional and reviewed, rerun with UPDATE_GOLDEN_PROMPT=1.`
    );
  }
  console.log("golden-prompt-snapshot.test.mjs OK");
}
