import assert from "node:assert/strict";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  activeWriterProjectionContract
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";

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

const founderBetaWebReceipt = Object.freeze({
  schema_version: "founder-beta-web-receipt-v2",
  semantic_state_sha256: "1".repeat(64)
});
const tcgFieldSourceAuthorityReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: [],
  fields: positive,
  originalImageCount: 1,
  semanticStateSha256: founderBetaWebReceipt.semantic_state_sha256,
  founderBetaWebReceipt,
  sourceExecution: {
    operationPayloadSha256: "a".repeat(64),
    originalImageFingerprints: [`sha256:${"b".repeat(64)}`],
    recognitionImageFingerprints: [`sha256:${"c".repeat(64)}`],
    providerClientRequestId: "lynca-exact-parallel-attempt-1",
    providerResponseId: "resp_exact_parallel_1",
    tenantId: "tenant-exact-parallel",
    recognitionSessionId: "session-exact-parallel"
  }
});
const tcgGrammarContextClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: positive,
  fieldSourceAuthorityReceipt: tcgFieldSourceAuthorityReceipt
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

// Activation keeps the Standard Composer tuple atomic while the v4 parser
// requires its sealed source-authority receipts. Legacy feature switches cannot
// select a second writer; the v2/eBay ablation remains covered directly above.
{
  const payload = JSON.stringify(positive);
  const writer = activeWriterProjectionContract();
  const tcgContext = {
    tcgFieldSourceAuthorityReceipt,
    tcgGrammarContextClaimReceipt
  };
  const baseline = finishCanonicalTitle(payload, {
    exactParallelColorCompaction: false,
    writerContract: writer,
    ...tcgContext
  });
  const candidate = finishCanonicalTitle(payload, {
    exactParallelColorCompaction: true,
    writerContract: writer,
    ...tcgContext
  });
  const active = finishCanonicalTitle(payload, tcgContext);
  assert.equal(JSON.stringify(candidate.fields), JSON.stringify(baseline.fields));
  assert.equal(JSON.stringify(active.fields), JSON.stringify(candidate.fields));
  assert.equal(candidate.title, baseline.title);
  assert.equal(active.title, candidate.title);
  assert.equal(candidate.composer_version, writer.standard.composer_version);
  assert.equal(baseline.composer_version, writer.standard.composer_version);
  assert.equal(active.composer_version, writer.standard.composer_version);
  assert.equal(active.marketplace_profile_version,
    writer.standard.marketplace_profile_version);
  assert.equal(active.canonical_naming_publishable, true);
  assert.ok(active.canonical_naming_trace);
}

process.stdout.write("exact parallel color compaction: ok\n");
