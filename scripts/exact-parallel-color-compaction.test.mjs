import assert from "node:assert/strict";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const card = (overrides = {}) => ({
  year: "", ip: "", language: "", manufacturer: "", product: "", set: "",
  subjects: [], team: "", card_name: "", release_variant: "",
  surface_color: "", parallel_family: "", parallel_exact: "", print_finish: "",
  descriptive_rarity: "", card_number: "", serial: "", components: [], grade: "",
  grammar: "standard", lot_count: "", unreadable: [], low_confidence: [],
  ...overrides
});

const positive = card({
  year: "2018",
  manufacturer: "Topps",
  product: "Topps Silver Pack",
  subjects: ["Shohei Ohtani"],
  card_name: "1983 Chrome Promo",
  surface_color: "Blue",
  parallel_family: "Refractor",
  parallel_exact: "Blue Refractor",
  print_finish: "Blue Refractor",
  serial: "018/150",
  components: ["RC"],
  grade: "PSA 10"
});

{
  const frozen = JSON.stringify(positive);
  const baseline = composeFromCanonicalFields(positive, {
    features: { exact_parallel_color_compaction: false }
  });
  const candidate = composeFromCanonicalFields(positive);

  assert.ok(baseline.dropped.includes("print_finish"));
  assert.ok(!candidate.dropped.includes("print_finish"));
  assert.match(candidate.title, /\bBlue\b/);
  assert.ok(!candidate.title.includes("Blue Refractor"), "only the exact colour token is the compact display");
  assert.deepEqual(candidate.dropped.filter((name) => !baseline.dropped.includes(name)), []);
  assert.equal(candidate.truncated, false);
  assert.ok(candidate.length <= 80);
  assert.ok(candidate.normalization_reasons.includes("print_finish:exact_parallel_color_compacted"));
  assert.equal(baseline.title_render_source, "csm_marketplace_composer_v1");
  assert.equal(candidate.title_render_source, "csm_marketplace_composer_v2");
  assert.equal(JSON.stringify(positive), frozen, "Composer must not mutate canonical fields");
}

// `Red` is not a token inside `Infrared`: substring matches cannot create a
// colour claim.
{
  const fields = { ...positive, surface_color: "Red", parallel_exact: "Infrared Refractor" };
  const baseline = composeFromCanonicalFields(fields, {
    features: { exact_parallel_color_compaction: false }
  });
  const candidate = composeFromCanonicalFields(fields);
  assert.equal(candidate.title, baseline.title);
  assert.ok(!candidate.normalization_reasons.includes("print_finish:exact_parallel_color_compacted"));
}

// The mechanism is a recovery, not a blanket abbreviation. A finish that
// already survives remains complete.
{
  const fields = card({
    manufacturer: "Topps", subjects: ["Shohei Ohtani"],
    surface_color: "Blue", parallel_exact: "Blue Refractor", print_finish: "Blue Refractor"
  });
  const baseline = composeFromCanonicalFields(fields, {
    features: { exact_parallel_color_compaction: false }
  });
  const candidate = composeFromCanonicalFields(fields);
  assert.equal(candidate.title, baseline.title);
  assert.match(candidate.title, /Blue Refractor/);
}

// High-priority content that still requires fallback truncation is not made to
// look safe merely because a colour fits somewhere in the cut title.
{
  const fields = card({
    subjects: ["A".repeat(96)],
    surface_color: "Blue", parallel_exact: "Blue Refractor", print_finish: "Blue Refractor"
  });
  const baseline = composeFromCanonicalFields(fields, {
    features: { exact_parallel_color_compaction: false }
  });
  const candidate = composeFromCanonicalFields(fields);
  assert.equal(baseline.truncated, true);
  assert.equal(candidate.title, baseline.title);
  assert.ok(!candidate.normalization_reasons.includes("print_finish:exact_parallel_color_compacted"));
}

// The real runtime finisher exposes the ablation while returning byte-identical
// canonical fields on both arms.
{
  const payload = JSON.stringify(positive);
  const baseline = finishCanonicalTitle(payload, {
    exactParallelColorCompaction: false
  });
  const candidate = finishCanonicalTitle(payload);
  assert.notEqual(candidate.title, baseline.title);
  assert.equal(JSON.stringify(candidate.fields), JSON.stringify(baseline.fields));
  assert.equal(JSON.stringify(candidate.fields), JSON.stringify(finishCanonicalTitle(payload).fields));
}

process.stdout.write("exact parallel color compaction: ok\n");
