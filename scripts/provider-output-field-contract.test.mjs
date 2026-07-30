import assert from "node:assert/strict";
import crypto from "node:crypto";
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
import { sourceIdentityForVerifiedImage } from "../lib/listing/evidence/current-image-manifest.mjs";

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
const observationContext = {
  tenant_id: "tenant_a",
  asset_id: "asset-provider-contract",
  image_generation_id: "asset-provider-contract",
  images: ["front", "back"].map((id, index) => ({
    id,
    image_id: id,
    objectPath: "tenants/tenant_a/listing-assets/2026-07-30/asset-provider-contract/" + id + ".jpg",
    contentSha256: String(index + 1).repeat(64),
    storageVerified: true,
    tenantId: "tenant_a",
    assetId: "asset-provider-contract",
    imageGenerationId: "asset-provider-contract"
  }))
};
const verifiedSource = (imageId) => sourceIdentityForVerifiedImage(
  observationContext.images,
  observationContext.images.find((image) => image.id === imageId)
);
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
  raw_provider_fields: { year: "2023", manufacturer: "Panini", set: "Paragon" },
  raw_provider_field_evidence: [
    {
      field: "year",
      value: "2023",
      source_type: "CARD_BACK_PRINTED_TEXT",
      ...verifiedSource("back"),
      visible_text: "2023"
    },
    {
      field: "manufacturer",
      value: "Panini",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      ...verifiedSource("front"),
      visible_text: "Panini"
    },
    {
      field: "set",
      value: "Paragon",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      ...verifiedSource("front"),
      visible_text: "Paragon"
    }
  ]
}, {
  snapshot_version: "test-v1",
  set_product_years: { paragon: ["2023|Panini Phoenix"] }
}, { shadow: false, observationContext });
const mergedApplication = mergeForwardEnumerationApplicationEvidence(forward, {
  identity_evidence_items: [{ field: "year", value: "2023", source: "CARD_FRONT_PRINTED_TEXT" }]
});
assert.equal(mergedApplication.identity_evidence_items.length, 2);
assert.equal(mergedApplication.identity_evidence_items[1].field, "product");
assert.equal(mergedApplication.identity_evidence_items[1].value, "Panini Phoenix");
assert.equal(mergedApplication.forward_enumeration_identity_evidence_count, 1);

const forgedForwardPacket = structuredClone(forward);
forgedForwardPacket.forward_enumeration_candidate_packet.trace.find((row) => row.field === "product").value = "Forged Product";
const forgedPacketMerge = mergeForwardEnumerationApplicationEvidence(forgedForwardPacket, {
  identity_evidence_items: []
});
assert.equal(forgedPacketMerge.forward_enumeration_identity_evidence_count, 0);
assert.equal(forgedPacketMerge.forward_enumeration_validation_status, "REJECTED");

function replaceValue(value, from, to) {
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, from, to));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, replaceValue(item, from, to)]));
  }
  return value === from ? to : value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

const selfSignedForgery = structuredClone(forward);
selfSignedForgery.forward_enumeration_candidate_packet = replaceValue(
  selfSignedForgery.forward_enumeration_candidate_packet,
  "Panini Phoenix",
  "Forged Product"
);
selfSignedForgery.retrieval_application.forward_enumeration_identity_evidence_items = replaceValue(
  selfSignedForgery.retrieval_application.forward_enumeration_identity_evidence_items,
  "Panini Phoenix",
  "Forged Product"
);
const selfSignedIntegrity = selfSignedForgery.retrieval_application.forward_enumeration_integrity;
const selfSignedPayload = {
  adapter_version: selfSignedIntegrity.adapter_version,
  authority_id: selfSignedIntegrity.authority_id,
  observation_manifest_fingerprint: selfSignedIntegrity.observation_manifest_fingerprint,
  observation_provenance: selfSignedForgery.forward_enumeration_observation_provenance,
  candidate_packet: selfSignedForgery.forward_enumeration_candidate_packet,
  identity_evidence_items:
    selfSignedForgery.retrieval_application.forward_enumeration_identity_evidence_items
};
selfSignedIntegrity.packet_content_sha256 = `sha256:${crypto.createHash("sha256")
  .update(JSON.stringify(canonical(selfSignedPayload))).digest("hex")}`;
const selfSignedForgeryMerge = mergeForwardEnumerationApplicationEvidence(selfSignedForgery, {
  identity_evidence_items: []
});
assert.equal(selfSignedForgeryMerge.forward_enumeration_validation_status, "REJECTED");
assert.equal(
  selfSignedForgeryMerge.forward_enumeration_validation_reason,
  "CANDIDATE_PACKET_AUTHORITY_MISMATCH"
);

const staleGeneration = structuredClone(forward);
staleGeneration.forward_enumeration_observation_provenance[0].image_generation_id = "asset-old-generation";
const staleGenerationMerge = mergeForwardEnumerationApplicationEvidence(staleGeneration, {
  identity_evidence_items: []
});
assert.equal(staleGenerationMerge.forward_enumeration_identity_evidence_count, 0);
assert.equal(staleGenerationMerge.forward_enumeration_validation_reason, "OBSERVATION_PROVENANCE_INVALID");

const identityGap = attachForwardEnumerationCandidates({
  raw_provider_fields: { year: "2023", manufacturer: "Panini", set: "Paragon" },
  raw_provider_field_evidence: [{
    field: "year",
    value: "2023",
    source_type: "CARD_BACK_PRINTED_TEXT",
    source_image_id: "back",
    visible_text: "2023"
  }]
}, {
  snapshot_version: "test-v1",
  set_product_years: { paragon: ["2023|Panini Phoenix"] }
}, { shadow: false, observationContext });
assert.equal(identityGap.forward_enumeration_shadow.observation_field_count, 0);
assert.equal(identityGap.retrieval_application.forward_enumeration_identity_evidence_items.length, 0);

const emptyImageContext = attachForwardEnumerationCandidates({
  raw_provider_fields: { year: "2023" },
  raw_provider_field_evidence: []
}, { snapshot_version: "test-v1" }, {
  shadow: false,
  observationContext: {
    tenant_id: "tenant_a",
    asset_id: "asset-provider-contract",
    image_generation_id: "asset-provider-contract",
    images: [{}]
  }
});
assert.equal(emptyImageContext.forward_enumeration_shadow.observation_context_status, "UNKNOWN");
assert.equal(
  mergeForwardEnumerationApplicationEvidence(emptyImageContext, {}).forward_enumeration_identity_evidence_count,
  0
);

console.log("provider output field contract tests passed");
