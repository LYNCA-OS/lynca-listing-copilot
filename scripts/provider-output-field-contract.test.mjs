import assert from "node:assert/strict";
import {
  assertProviderOutputFieldContract,
  providerFieldsByClass,
  providerOutputFieldContract,
  providerOutputFieldNames,
  providerReadFieldNamesByType,
  readOnlyProviderResponseProfile
} from "../lib/listing/providers/provider-output-field-contract.mjs";
import {
  buildInitialProviderPrompt,
  providerReadOnlyOutputShape,
  readOnlyProviderContractEnabled
} from "../lib/listing/pipeline/provider-prompt.mjs";
import { openAiReadOnlyProviderResponseSchema } from "../lib/listing/providers/openai-emergency-provider.mjs";
import {
  attachForwardEnumerationCandidates,
  mergeForwardEnumerationApplicationEvidence
} from "../lib/listing/catalog/forward-enumeration-adapter.mjs";

assert.equal(assertProviderOutputFieldContract(providerOutputFieldNames), true);
assert.equal(readOnlyProviderResponseProfile, "read_only_sparse_v4");

const all = [
  ...providerFieldsByClass("READ"),
  ...providerFieldsByClass("DERIVED"),
  ...providerFieldsByClass("DROP")
];
assert.equal(new Set(all).size, Object.keys(providerOutputFieldContract).length);
assert.deepEqual(providerFieldsByClass("DERIVED").sort(), [
  "brand",
  "card_type",
  "numbered_to",
  "numerical_rarity",
  "parallel",
  "parallel_exact",
  "parallel_family",
  "product",
  "serial_number",
  "team"
]);
assert.ok(providerReadFieldNamesByType("string").includes("year"));
assert.ok(!providerReadFieldNamesByType("string").includes("product"));
assert.ok(!providerReadFieldNamesByType("string").includes("serial_number"));

const payload = {
  images: [{ name: "front.jpg" }, { name: "back.jpg" }],
  provider_options: {
    v4_title_stage_target: "L2_ASSISTED_DRAFT",
    v4_compact_l2_prompt: true,
    v4_read_only_provider_contract: true
  }
};
assert.equal(readOnlyProviderContractEnabled(payload, {}), true);
const prompt = await buildInitialProviderPrompt(payload, 80);
assert.match(prompt, /card-surface reader/);
assert.match(prompt, /Do not output product line, team/);
assert.doesNotMatch(JSON.stringify(providerReadOnlyOutputShape()), /product|team|parallel|serial_number/);
const schema = openAiReadOnlyProviderResponseSchema();
assert.deepEqual(schema.required, ["r", "v", "e", "u"]);
assert.ok(!schema.properties.v.properties.s.items.properties.f.enum.includes("product"));
assert.ok(!schema.properties.v.properties.s.items.properties.f.enum.includes("serial_number"));
assert.ok(schema.properties.v.properties.s.items.properties.f.enum.includes("year"));
assert.equal(schema.properties.v.properties.b.items.properties.v.const, true);
assert.equal(schema.properties.v.properties.n.items.properties.v.minimum, 2);
assert.equal(schema.properties.c, undefined);

const forward = attachForwardEnumerationCandidates({
  raw_provider_fields: { year: "2023", manufacturer: "Panini", set: "Paragon" }
}, {
  snapshot_version: "test-v1",
  set_product_years: { paragon: ["2023|Panini Phoenix"] }
}, { shadow: false });
const mergedApplication = mergeForwardEnumerationApplicationEvidence(forward, {
  identity_evidence_items: [{ field: "year", value: "2023", source: "CARD_FRONT_PRINTED_TEXT" }]
});
assert.equal(mergedApplication.identity_evidence_items.length, 2);
assert.equal(mergedApplication.identity_evidence_items[1].field, "product");
assert.equal(mergedApplication.identity_evidence_items[1].value, "Panini Phoenix");
assert.equal(mergedApplication.forward_enumeration_identity_evidence_count, 1);

console.log("provider output field contract tests passed");
