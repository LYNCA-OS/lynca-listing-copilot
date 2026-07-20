import assert from "node:assert/strict";
import {
  compactV4L2RecognitionPrompt,
  fastInitialRecognitionPrompt
} from "../lib/listing/pipeline/provider-prompt.mjs";

const payload = {
  assetId: "fact_prompt_test",
  mode: "pair",
  images: [{ name: "front.jpg" }, { name: "back.jpg" }],
  provider_options: {
    v4_title_stage_target: "L2_ASSISTED_DRAFT",
    v4_compact_l2_prompt: true,
    v4_ultra_fast_l2: false,
    v4_ultra_sparse_transport: false
  }
};

const legacyPrompt = fastInitialRecognitionPrompt(payload, 80);
const factPrompt = compactV4L2RecognitionPrompt(payload, 80);

assert.ok(factPrompt.length < legacyPrompt.length * 0.45, "fact prompt must remove at least 55% of the legacy prompt");
assert.match(factPrompt, /literal card-fact reader/);
assert.match(factPrompt, /Do not compose, imitate, or optimize a marketplace title/);
assert.match(factPrompt, /title wording and word order are never instructions/);
assert.match(factPrompt, /Main subject is mandatory whenever a name is readable/);
assert.match(factPrompt, /Ignore seller mats, table backgrounds, sleeves, stands, watermarks/);
assert.match(factPrompt, /Limited numbering is mandatory high-value evidence/);
assert.match(factPrompt, /An uncertain optional finish, code or rarity must never erase readable core facts/);
assert.match(factPrompt, /never default a reflective card to Silver/);
assert.match(factPrompt, /Base color is required when visible/);
assert.match(factPrompt, /manufacturer\/brand means the card publisher/);
assert.match(factPrompt, /Final omission audit/);
assert.match(factPrompt, /never explanations such as 'not visible'/);
assert.match(factPrompt, /Do not turn sparkle, shine, crystal/);
assert.match(factPrompt, /Lot: two or more separate physical card\/slab rectangles/);
assert.doesNotMatch(factPrompt, /Linear SEM|SEM fields|Runtime title limit downstream/);
assert.doesNotMatch(factPrompt, /L2 job: confirm, correct, and complete L1/);
assert.doesNotMatch(factPrompt, /This is mandatory for GPT-5-mini/);
assert.ok(factPrompt.length < 9000, "fact prompt must remain materially smaller than the legacy prompt");

console.log(JSON.stringify({
  legacy_chars: legacyPrompt.length,
  fact_prompt_chars: factPrompt.length,
  reduction_rate: Number((1 - factPrompt.length / legacyPrompt.length).toFixed(4))
}));
